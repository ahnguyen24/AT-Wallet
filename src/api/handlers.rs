use axum::{extract::State, Json, http::StatusCode, response::IntoResponse, http::HeaderMap};
use crate::security::{encryption::SecurityCore, totp, hashing};
use crate::wallet::engine::WalletEngine;
use crate::models::{User, WalletRecord};
use sqlx::{SqlitePool, Row};
use serde_json::{json, Value};
use std::sync::Arc;

pub struct AppState {
    pub db: SqlitePool,
}

// --- ALL REQUIRED STRUCTS ---
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
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(serde::Deserialize)]
pub struct CreateWalletRequest {
    pub user_id: String,
    pub password: String,
}

#[derive(serde::Deserialize)]
pub struct ActionRequest {
    pub user_id: String,
    pub password: String,
}

#[derive(serde::Deserialize)]
pub struct TransferRequest {
    pub sender_id: String,
    pub recipient: String,
    pub amount: f64,
    pub pin: String,
}

async fn record_security_log(pool: &SqlitePool, event: &str, severity: &str, details: &str) {
    let _ = sqlx::query("INSERT INTO security_logs (id, event_type, severity, details, timestamp) VALUES (?, ?, ?, ?, ?)")
        .bind(uuid::Uuid::new_v4().to_string()).bind(event).bind(severity).bind(details).bind(chrono::Utc::now()).execute(pool).await;
}

pub async fn register_user(State(state): State<Arc<AppState>>, Json(payload): Json<RegisterRequest>) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    // 1. Kiểm tra Email trùng lặp
    let email_exists: (i32,) = sqlx::query_as("SELECT COUNT(*) FROM users WHERE email = ?")
        .bind(&payload.email)
        .fetch_one(&state.db)
        .await
        .unwrap_or((0,));
    if email_exists.0 > 0 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Email này đã được sử dụng đăng ký tài khoản khác"}))));
    }

    // 2. Kiểm tra Số điện thoại trùng lặp
    let phone_exists: (i32,) = sqlx::query_as("SELECT COUNT(*) FROM users WHERE phone = ?")
        .bind(&payload.phone)
        .fetch_one(&state.db)
        .await
        .unwrap_or((0,));
    if phone_exists.0 > 0 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Số điện thoại này đã được sử dụng đăng ký tài khoản khác"}))));
    }

    // 3. Kiểm tra Số CCCD trùng lặp
    let cccd_exists: (i32,) = sqlx::query_as("SELECT COUNT(*) FROM users WHERE cccd = ?")
        .bind(&payload.cccd)
        .fetch_one(&state.db)
        .await
        .unwrap_or((0,));
    if cccd_exists.0 > 0 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Số CCCD này đã được sử dụng đăng ký tài khoản khác"}))));
    }

    let user_id = uuid::Uuid::new_v4().to_string();
    let salt = hex::encode(rand::random::<[u8; 16]>());
    let (totp_secret, _) = totp::generate_totp_secret(&payload.email);
    let password_hash = hashing::hash_payment_pin(&payload.password);
    let pin_hash = hashing::hash_payment_pin(&payload.pin);
    
    sqlx::query("INSERT INTO users (id, email, password_hash, master_salt, totp_secret, full_name, phone, cccd, pin_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(&user_id)
        .bind(&payload.email)
        .bind(&password_hash)
        .bind(&salt)
        .bind(&totp_secret)
        .bind(&payload.full_name)
        .bind(&payload.phone)
        .bind(&payload.cccd)
        .bind(&pin_hash)
        .execute(&state.db).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    
    // Gửi email chứa mã bí mật TOTP trong background task của tokio
    let email_recipient = payload.email.clone();
    let totp_secret_clone = totp_secret.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::security::email::send_totp_email_async(email_recipient, totp_secret_clone).await {
            println!("❌ Lỗi gửi email thiết lập TOTP: {}", e);
        } else {
            println!("📧 Đã gửi email thiết lập TOTP thành công đến người dùng.");
        }
    });

    Ok((StatusCode::CREATED, Json(json!({ "user_id": user_id, "totp_secret": totp_secret }))))
}

pub async fn login_user(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoginRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let user: Option<User> = sqlx::query_as("SELECT * FROM users WHERE email = ?").bind(&payload.email).fetch_optional(&state.db).await.ok().flatten();
    let dummy_salt = vec![0u8; 16];
    match user {
        Some(mut u) => {
            if u.is_locked { return Err((StatusCode::FORBIDDEN, Json(json!({"error": "BLOCK_ERROR"})))); }
            let salt_bytes = hex::decode(&u.master_salt).unwrap_or(dummy_salt);
            let _key = SecurityCore::derive_master_key(&payload.password, &salt_bytes);
            if hashing::verify_payment_pin(&u.password_hash, &payload.password) {
                sqlx::query("UPDATE users SET failed_attempts = 0 WHERE id = ?").bind(&u.id).execute(&state.db).await.ok();
                Ok((StatusCode::OK, Json(json!({ "user_id": u.id, "status": "success" }))))
            } else {
                u.failed_attempts += 1;
                let locked = u.failed_attempts >= 5;
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
    Json(payload): Json<CreateWalletRequest>
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?").bind(&payload.user_id).fetch_one(&state.db).await
        .map_err(|_| (StatusCode::NOT_FOUND, Json(json!({"error": "User not found"}))))?;

    let salt_bytes = hex::decode(&user.master_salt).unwrap();
    let master_key = SecurityCore::derive_master_key(&payload.password, &salt_bytes);

    let mnemonic = WalletEngine::generate_mnemonic();
    let address = WalletEngine::get_address_from_mnemonic(&mnemonic).await;
    let (ciphertext, nonce) = SecurityCore::encrypt(&mnemonic, &master_key);

    sqlx::query("INSERT INTO wallets (id, user_id, address, encrypted_seed, nonce, balance) VALUES (?, ?, ?, ?, ?, 100.0)")
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&payload.user_id)
        .bind(&address)
        .bind(&ciphertext)
        .bind(hex::encode(nonce))
        .execute(&state.db).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok((StatusCode::OK, Json(json!({ "address": address, "status": "encrypted" }))))
}

pub async fn get_balance_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ActionRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?").bind(&payload.user_id).fetch_one(&state.db).await
        .map_err(|_| (StatusCode::NOT_FOUND, Json(json!({"error": "User not found"}))))?;

    if !hashing::verify_payment_pin(&user.password_hash, &payload.password) {
        return Err((StatusCode::UNAUTHORIZED, Json(json!({"error": "Mật khẩu không chính xác"}))));
    }

    let wallet_rec: Option<WalletRecord> = sqlx::query_as("SELECT * FROM wallets WHERE user_id = ?").bind(&payload.user_id).fetch_optional(&state.db).await.unwrap_or(None);

    match wallet_rec {
        Some(w) => Ok((StatusCode::OK, Json(json!({
            "balance": w.balance,
            "address": w.address,
            "full_name": user.full_name,
            "phone": user.phone,
            "cccd": user.cccd,
            "status": "Decryption Verified"
        })))),
        None => Err((StatusCode::NOT_FOUND, Json(json!({"error": "Wallet not found"}))))
    }
}

pub async fn simple_transfer(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<TransferRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    // 1. Lấy thông tin người gửi để kiểm tra PIN
    let sender: User = sqlx::query_as("SELECT * FROM users WHERE id = ?").bind(&payload.sender_id).fetch_one(&state.db).await
        .map_err(|_| (StatusCode::NOT_FOUND, Json(json!({"error": "Không tìm thấy người gửi"}))))?;

    // 2. Kiểm tra mã PIN giao dịch
    if !hashing::verify_payment_pin(&sender.pin_hash, &payload.pin) {
        return Err((StatusCode::UNAUTHORIZED, Json(json!({"error": "Mã PIN giao dịch không chính xác"}))));
    }

    // 3. Kiểm tra hạn mức giao dịch (tối đa 50 SOL)
    if payload.amount > 50.0 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Hạn mức tối đa là 50 SOL cho mỗi giao dịch"}))));
    }
    if payload.amount <= 0.0 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Số tiền gửi phải lớn hơn 0"}))));
    }

    // 4. Lấy ví người gửi
    let sender_wallet: WalletRecord = sqlx::query_as("SELECT * FROM wallets WHERE user_id = ?").bind(&payload.sender_id).fetch_one(&state.db).await
        .map_err(|_| (StatusCode::NOT_FOUND, Json(json!({"error": "Người gửi chưa kích hoạt ví"}))))?;

    if sender_wallet.balance < payload.amount {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Số dư không đủ để thực hiện giao dịch"}))));
    }

    // 5. Tìm ví người nhận (qua email hoặc địa chỉ ví)
    let recipient_wallet: WalletRecord = if payload.recipient.contains('@') {
        let rec_user: User = sqlx::query_as("SELECT * FROM users WHERE email = ?").bind(&payload.recipient).fetch_one(&state.db).await
            .map_err(|_| (StatusCode::NOT_FOUND, Json(json!({"error": "Không tìm thấy người nhận với email này"}))))?;
        
        sqlx::query_as("SELECT * FROM wallets WHERE user_id = ?").bind(&rec_user.id).fetch_one(&state.db).await
            .map_err(|_| (StatusCode::NOT_FOUND, Json(json!({"error": "Người nhận chưa kích hoạt ví"}))))?
    } else {
        sqlx::query_as("SELECT * FROM wallets WHERE address = ?").bind(&payload.recipient).fetch_one(&state.db).await
            .map_err(|_| (StatusCode::NOT_FOUND, Json(json!({"error": "Không tìm thấy ví người nhận với địa chỉ này"}))))?
    };

    if sender_wallet.id == recipient_wallet.id {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Không thể tự chuyển tiền cho chính mình"}))));
    }

    // 6. Thực hiện cập nhật số dư nguyên tử trong giao dịch SQLite
    let mut tx = state.db.begin().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    sqlx::query("UPDATE wallets SET balance = balance - ? WHERE id = ?")
        .bind(payload.amount)
        .bind(&sender_wallet.id)
        .execute(&mut *tx).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    sqlx::query("UPDATE wallets SET balance = balance + ? WHERE id = ?")
        .bind(payload.amount)
        .bind(&recipient_wallet.id)
        .execute(&mut *tx).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    tx.commit().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // 7. Ghi nhật ký bảo mật
    let details = format!(
        "Transfer: sender_id={}, sender_email={}, recipient_id={}, recipient_address={}, amount={} SOL",
        sender.id, sender.email, recipient_wallet.user_id, recipient_wallet.address, payload.amount
    );
    record_security_log(&state.db, "TRANSFER", "INFO", &details).await;

    Ok((StatusCode::OK, Json(json!({
        "status": "success",
        "message": format!("Đã chuyển thành công {} SOL tới {}", payload.amount, payload.recipient)
    }))))
}

pub async fn get_logs(State(state): State<Arc<AppState>>) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let rows = sqlx::query("SELECT * FROM security_logs ORDER BY timestamp DESC LIMIT 10").fetch_all(&state.db).await.unwrap();
    let logs: Vec<Value> = rows.into_iter().map(|row| json!({ "event": row.get::<String, _>("event_type"), "severity": row.get::<String, _>("severity"), "details": row.get::<String, _>("details"), "time": row.get::<chrono::DateTime<chrono::Utc>, _>("timestamp") })).collect();
    Ok((StatusCode::OK, Json(logs)))
}

pub async fn init_db(pool: &SqlitePool) {
    // 1. Tạo bảng mới nếu chưa tồn tại
    sqlx::query("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, master_salt TEXT, totp_secret TEXT, failed_attempts INTEGER DEFAULT 0, is_locked BOOLEAN DEFAULT 0, full_name TEXT, phone TEXT, cccd TEXT, pin_hash TEXT);").execute(pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS wallets (id TEXT PRIMARY KEY, user_id TEXT, address TEXT, encrypted_seed TEXT, nonce TEXT, balance REAL DEFAULT 100.0, FOREIGN KEY(user_id) REFERENCES users(id));").execute(pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS used_nonces (nonce TEXT PRIMARY KEY, timestamp INTEGER);").execute(pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS security_logs (id TEXT PRIMARY KEY, event_type TEXT, severity TEXT, details TEXT, timestamp DATETIME);").execute(pool).await.unwrap();

    // 2. Tự động di trú (migration) cho database đã tồn tại
    let _ = sqlx::query("ALTER TABLE users ADD COLUMN full_name TEXT;").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE users ADD COLUMN phone TEXT;").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE users ADD COLUMN cccd TEXT;").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE users ADD COLUMN pin_hash TEXT;").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE wallets ADD COLUMN balance REAL DEFAULT 100.0;").execute(pool).await;

    println!("✔ Database Schema Aligned.");
}