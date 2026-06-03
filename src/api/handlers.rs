use axum::{extract::State, Json, http::{StatusCode, HeaderMap}, response::IntoResponse};
use crate::security::{encryption::SecurityCore, totp, hashing, auth};
use crate::wallet::engine::WalletEngine;
use crate::models::{User, WalletRecord};
use crate::api::envelope::SecureEnvelope;
use sqlx::{SqlitePool, Row};
use serde_json::{json, Value};
use std::sync::Arc;

pub struct AppState {
    pub db: SqlitePool,
}

// --- DTOs ---
#[derive(serde::Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub full_name: String,
    pub phone: String,
    pub cccd: String,
    pub pin: String,
}

#[derive(serde::Deserialize)]
pub struct LoginRequest { pub email: String, pub password: String, pub totp_token: String }
#[derive(serde::Deserialize)]
pub struct CreateWalletRequest { pub user_id: String, pub password: String }
#[derive(serde::Deserialize)]
pub struct ActionRequest { pub user_id: String, pub password: String }

#[derive(serde::Deserialize)]
pub struct LookupPhoneRequest {
    pub phone: String,
}

#[derive(serde::Deserialize)]
pub struct TransferPayload {
    pub sender_id: String,
    pub recipient: String,
    pub amount: i64,
    pub pin: String,
    pub message: Option<String>,
}

// --- SECURE HELPERS ---

/// Helper to write to the security logs
async fn record_security_log(pool: &SqlitePool, event: &str, severity: &str, details: &str) {
    let id = uuid::Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO security_logs (id, event_type, severity, details, timestamp) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(id)
    .bind(event)
    .bind(severity)
    .bind(details)
    .bind(chrono::Utc::now())
    .execute(pool)
    .await;
}

/// JWT Session Gatekeeper
fn authorize_request(headers: &HeaderMap) -> Result<String, (StatusCode, Json<Value>)> {
    let auth_header = headers.get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .ok_or((StatusCode::UNAUTHORIZED, Json(json!({"error": "Missing token"}))))?;
    auth::verify_jwt(auth_header).map_err(|_| (StatusCode::UNAUTHORIZED, Json(json!({"error": "Invalid token"}))))
}

// --- HANDLERS ---

pub async fn register_user(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RegisterRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let user_id = uuid::Uuid::new_v4().to_string();
    let salt = hex::encode(rand::random::<[u8; 16]>());
    let (totp_secret, _) = totp::generate_totp_secret(&payload.email);
    
    let password_hash = hashing::hash_payment_pin(&payload.password);
    let pin_hash = hashing::hash_payment_pin(&payload.pin);

    sqlx::query("INSERT INTO users (id, email, password_hash, full_name, phone, cccd, pin_hash, master_salt, totp_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(&user_id).bind(&payload.email).bind(&password_hash).bind(&payload.full_name).bind(&payload.phone).bind(&payload.cccd).bind(&pin_hash).bind(&salt).bind(&totp_secret)
        .execute(&state.db).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok((StatusCode::CREATED, Json(json!({ "user_id": user_id, "totp_secret": totp_secret }))))
}

pub async fn login_user(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoginRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let user_res: Result<Option<User>, sqlx::Error> = sqlx::query_as("SELECT * FROM users WHERE email = ?")
        .bind(&payload.email)
        .fetch_optional(&state.db)
        .await;

    let user = match user_res {
        Ok(u) => u,
        Err(e) => {
            println!("❌ Database Error during Login Query: {}", e);
            return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))));
        }
    };

    let dummy_salt = vec![0u8; 16];

    match user {
        Some(mut u) => {
            if u.is_locked { 
                record_security_log(&state.db, "LOCKED_ACCESS_ATTEMPT", "HIGH", &u.email).await;
                return Err((StatusCode::FORBIDDEN, Json(json!({"error": "BLOCK_ERROR"})))); 
            }

            let salt_bytes = hex::decode(&u.master_salt).unwrap_or(dummy_salt);
            let _key = SecurityCore::derive_master_key(&payload.password, &salt_bytes);
            
            let is_pw_valid = hashing::verify_payment_pin(&u.password_hash, &payload.password);
            let is_totp_valid = totp::verify_totp(&u.totp_secret, &payload.totp_token);

            if is_pw_valid && is_totp_valid {
                sqlx::query("UPDATE users SET failed_attempts = 0 WHERE id = ?").bind(&u.id).execute(&state.db).await.ok();
                let token = auth::create_jwt(&u.id);

                let wallet: Option<WalletRecord> = sqlx::query_as("SELECT * FROM wallets WHERE user_id = ? AND wallet_index = 0").bind(&u.id).fetch_optional(&state.db).await.unwrap_or(None);
                let address = wallet.map(|w| w.address).unwrap_or("".to_string());

                Ok((StatusCode::OK, Json(json!({ 
                    "user_id": u.id, 
                    "token": token, 
                    "address": address, 
                    "full_name": u.full_name,
                    "phone": u.phone,
                    "cccd": u.cccd,
                    "status": "success" 
                }))))
            } else {
                u.failed_attempts += 1;
                let locked = u.failed_attempts >= 5;
                if locked { record_security_log(&state.db, "ACCOUNT_LOCKOUT", "CRITICAL", &u.email).await; }
                
                sqlx::query("UPDATE users SET failed_attempts = ?, is_locked = ? WHERE id = ?").bind(u.failed_attempts).bind(locked).bind(&u.id).execute(&state.db).await.ok();
                Err((StatusCode::UNAUTHORIZED, Json(json!({"error": "CREDENTIAL_ERROR"}))))
            }
        }
        None => {
            let _ = SecurityCore::derive_master_key(&payload.password, &dummy_salt);
            Err((StatusCode::UNAUTHORIZED, Json(json!({"error": "CREDENTIAL_ERROR"}))))
        }
    }
}

pub async fn create_wallet(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<CreateWalletRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    authorize_request(&headers)?;

    let existing: Option<WalletRecord> = sqlx::query_as("SELECT * FROM wallets WHERE user_id = ? AND wallet_index = 0")
        .bind(&payload.user_id).fetch_optional(&state.db).await.unwrap_or(None);

    if let Some(w) = existing {
        return Ok((StatusCode::OK, Json(json!({ "address": w.address, "status": "existing" }))));
    }

    let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?").bind(&payload.user_id).fetch_one(&state.db).await.unwrap();
    let salt_bytes = hex::decode(&user.master_salt).unwrap();
    let master_key = SecurityCore::derive_master_key(&payload.password, &salt_bytes);

    let mnemonic = WalletEngine::generate_mnemonic();
    let (ciphertext, nonce) = SecurityCore::encrypt(&mnemonic, &master_key);

    let mut primary_address = "".to_string();
    for index in 0..3 {
        let address = WalletEngine::get_address_from_mnemonic(&mnemonic, index as u32).await;
        if index == 0 { primary_address = address.clone(); }

        sqlx::query("INSERT INTO wallets (id, user_id, address, encrypted_seed, nonce, wallet_index, balance) VALUES (?, ?, ?, ?, ?, ?, 1000000)")
            .bind(uuid::Uuid::new_v4().to_string()).bind(&payload.user_id).bind(&address).bind(&ciphertext).bind(hex::encode(&nonce)).bind(index).execute(&state.db).await.unwrap();
    }

    Ok((StatusCode::OK, Json(json!({ "address": primary_address, "status": "created_3_wallets" }))))
}

pub async fn lookup_by_phone(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<LookupPhoneRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    authorize_request(&headers)?;

    let input = payload.phone.trim();
    if input.len() != 10 && input.len() != 12 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Số điện thoại/Mã định danh không hợp lệ"}))));
    }

    let target_phone = if input.len() == 12 { &input[0..10] } else { input };

    let user: Option<User> = sqlx::query_as("SELECT * FROM users WHERE phone = ?")
        .bind(target_phone).fetch_optional(&state.db).await.unwrap_or(None);

    match user {
        Some(u) => {
            Ok((StatusCode::OK, Json(json!({ "status": "success", "full_name": u.full_name }))))
        }
        None => Err((StatusCode::NOT_FOUND, Json(json!({"error": "Không tìm thấy người dùng"}))))
    }
}

pub async fn get_balance_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<ActionRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    authorize_request(&headers)?;

    let row = sqlx::query("SELECT balance, address FROM wallets WHERE user_id = ? AND wallet_index = 0")
        .bind(&payload.user_id).fetch_one(&state.db).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let balance: i64 = row.get("balance");
    let address: String = row.get("address");

    let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?").bind(&payload.user_id).fetch_one(&state.db).await.unwrap();

    Ok((StatusCode::OK, Json(json!({ 
        "balance": balance, 
        "address": address,
        "full_name": user.full_name,
        "phone": user.phone,
        "cccd": user.cccd
    }))))
}

pub async fn secure_transfer(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(envelope): Json<SecureEnvelope>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let sender_id = authorize_request(&headers)?;

    let (count,): (i32,) = sqlx::query_as("SELECT COUNT(*) FROM used_nonces WHERE nonce = ?").bind(&envelope.nonce).fetch_one(&state.db).await.unwrap_or((0,));
    if count > 0 { 
        record_security_log(&state.db, "REPLAY_ATTACK", "CRITICAL", &envelope.nonce).await;
        return Err((StatusCode::CONFLICT, Json(json!({"error": "Replay"})))); 
    }
    sqlx::query("INSERT INTO used_nonces (nonce, timestamp) VALUES (?, ?)").bind(&envelope.nonce).bind(envelope.timestamp).execute(&state.db).await.ok();

    let tx: TransferPayload = serde_json::from_str(&envelope.payload)
        .map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid payload"}))))?;

    let sender: User = sqlx::query_as("SELECT * FROM users WHERE id = ?").bind(&sender_id).fetch_one(&state.db).await.unwrap();
    if !hashing::verify_payment_pin(&sender.pin_hash, &tx.pin) {
        return Err((StatusCode::UNAUTHORIZED, Json(json!({"error": "Mã PIN giao dịch không chính xác!"}))));
    }

    let recipient_input = tx.recipient.trim();
    let (target_phone, wallet_index) = if recipient_input.len() == 12 {
        let phone = &recipient_input[0..10];
        let idx_str = &recipient_input[10..12];
        let idx = idx_str.parse::<i32>().unwrap_or(0);
        (phone, idx)
    } else {
        (recipient_input, 0)
    };

    let recipient_user: Option<User> = sqlx::query_as("SELECT * FROM users WHERE phone = ?")
        .bind(target_phone).fetch_optional(&state.db).await.unwrap_or(None);

    let rec_u = match recipient_user {
        Some(u) => u,
        None => return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Người nhận chưa đăng ký tài khoản"}))))
    };

    let mut db_tx = state.db.begin().await.unwrap();

    let mut sender_balance: i64 = sqlx::query("SELECT balance FROM wallets WHERE user_id = ? AND wallet_index = 0")
        .bind(&sender_id).fetch_one(&mut *db_tx).await.unwrap().get("balance");

    if sender_balance < tx.amount {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Số dư không đủ"}))));
    }

    sender_balance -= tx.amount;
    sqlx::query("UPDATE wallets SET balance = ? WHERE user_id = ? AND wallet_index = 0")
        .bind(sender_balance).bind(&sender_id).execute(&mut *db_tx).await.unwrap();

    let receiver_wallet: Option<WalletRecord> = sqlx::query_as("SELECT * FROM wallets WHERE user_id = ? AND wallet_index = ?")
        .bind(&rec_u.id).bind(wallet_index).fetch_optional(&mut *db_tx).await.unwrap_or(None);

    match receiver_wallet {
        Some(w) => {
            let new_rec_bal = w.balance + tx.amount;
            sqlx::query("UPDATE wallets SET balance = ? WHERE id = ?").bind(new_rec_bal).bind(&w.id).execute(&mut *db_tx).await.unwrap();
        }
        None => {
            return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Ví người nhận chưa được khởi tạo"}))));
        }
    }

    db_tx.commit().await.unwrap();

    let log_details = format!(
        "sender_id='{}', sender_email='{}', sender_name='{}', recipient_wallet_id='{}', recipient_address='{}', recipient_name='{}', amount='{} SOL', message='{}'",
        sender.id, sender.email, sender.full_name, rec_u.id, "SimulatedAddress", rec_u.full_name, tx.amount, tx.message.clone().unwrap_or_else(|| "".to_string())
    );
    sqlx::query("INSERT INTO security_logs (id, event_type, severity, details, timestamp) VALUES (?, 'TRANSFER', 'LOW', ?, ?)")
        .bind(uuid::Uuid::new_v4().to_string()).bind(&log_details).bind(chrono::Utc::now()).execute(&state.db).await.ok();

    Ok((StatusCode::OK, Json(json!({ "block_id": "0x_LIVE_LEDGER_TX_SUCCESS", "new_balance": sender_balance }))))
}

pub async fn get_logs(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    authorize_request(&headers)?;
    let rows = sqlx::query("SELECT * FROM security_logs ORDER BY timestamp DESC LIMIT 10").fetch_all(&state.db).await.unwrap();
    let logs: Vec<Value> = rows.into_iter().map(|row| json!({ "event": row.get::<String, _>("event_type"), "severity": row.get::<String, _>("severity"), "details": row.get::<String, _>("details"), "time": row.get::<chrono::DateTime<chrono::Utc>, _>("timestamp") })).collect();
    Ok((StatusCode::OK, Json(logs)))
}

pub async fn init_db(pool: &SqlitePool) {
    sqlx::query("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, full_name TEXT, phone TEXT UNIQUE, cccd TEXT UNIQUE, pin_hash TEXT, master_salt TEXT, totp_secret TEXT, failed_attempts INTEGER DEFAULT 0, is_locked BOOLEAN DEFAULT 0);").execute(pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS wallets (id TEXT PRIMARY KEY, user_id TEXT, address TEXT, encrypted_seed TEXT, nonce TEXT, wallet_index INTEGER, balance INTEGER, FOREIGN KEY(user_id) REFERENCES users(id));").execute(pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS used_nonces (nonce TEXT PRIMARY KEY, timestamp INTEGER);").execute(pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS security_logs (id TEXT PRIMARY KEY, event_type TEXT, severity TEXT, details TEXT, timestamp DATETIME);").execute(pool).await.unwrap();
}