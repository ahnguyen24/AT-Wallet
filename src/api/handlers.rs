use axum::{extract::{State, Path}, Json, http::StatusCode, response::IntoResponse};
use crate::security::{encryption::SecurityCore, totp};
use crate::wallet::engine::WalletEngine;
use crate::models::{User};
use crate::api::envelope::SecureEnvelope;
use crate::security::hashing;
use sqlx::{SqlitePool, Row};
use serde_json::{json, Value};
use std::sync::Arc;

/// Global App State
pub struct AppState {
    pub db: SqlitePool,
}

// --- Data Transfer Objects (DTOs) ---

#[derive(serde::Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
}

#[derive(serde::Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
    pub totp_token: String,
}

#[derive(serde::Deserialize)]
pub struct CreateWalletRequest {
    pub user_id: String,
    pub password: String,
}

#[derive(serde::Deserialize)]
pub struct TransferPayload {
    pub recipient: String,
    pub amount: u64,
}

// --- Security Logging Helper ---

async fn record_security_log(pool: &SqlitePool, event: &str, severity: &str, details: &str) {
    let _ = sqlx::query(
        "INSERT INTO security_logs (id, event_type, severity, details, timestamp) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(event)
    .bind(severity)
    .bind(details)
    .bind(chrono::Utc::now())
    .execute(pool)
    .await;
}

// --- API Handlers ---

/// 1. Register: Generates master salt and TOTP
pub async fn register_user(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RegisterRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let user_id = uuid::Uuid::new_v4().to_string();
    let salt = hex::encode(rand::random::<[u8; 16]>());
    let (totp_secret, _) = totp::generate_totp_secret(&payload.email);
    
    // Argon2id Hashing for Login Password
    let password_hash = hashing::hash_payment_pin(&payload.password); 

    sqlx::query("INSERT INTO users (id, email, password_hash, master_salt, totp_secret) VALUES (?, ?, ?, ?, ?)")
        .bind(&user_id)
        .bind(&payload.email)
        .bind(&password_hash)
        .bind(&salt)
        .bind(&totp_secret)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok((StatusCode::CREATED, Json(json!({ "user_id": user_id, "totp_secret": totp_secret }))))
}

/// 2. Login: Includes Timing-Attack protection and Account Lockout
pub async fn login_user(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoginRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> { // Explicit Json<Value> in error
    let user_option: Option<User> = sqlx::query_as("SELECT * FROM users WHERE email = ?")
        .bind(&payload.email)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let dummy_salt = vec![0u8; 16];

    match user_option {
        Some(mut u) => {
            if u.is_locked {
                return Err((StatusCode::FORBIDDEN, Json(json!({"error": "BLOCK_ERROR"}))));
            }

            // Security Work
            let salt_bytes = hex::decode(&u.master_salt).unwrap_or(dummy_salt);
            let _ = SecurityCore::derive_master_key(&payload.password, &salt_bytes);

            let is_pw_valid = hashing::verify_payment_pin(&u.password_hash, &payload.password);
            let is_totp_valid = totp::verify_totp(&u.totp_secret, &payload.totp_token);

            if is_pw_valid && is_totp_valid {
                sqlx::query("UPDATE users SET failed_attempts = 0 WHERE id = ?").bind(&u.id).execute(&state.db).await.ok();
                Ok((StatusCode::OK, Json(json!({ "user_id": u.id, "status": "success" }))))
            } else {
                u.failed_attempts += 1;
                let locked = u.failed_attempts >= 5;
                sqlx::query("UPDATE users SET failed_attempts = ?, is_locked = ? WHERE id = ?")
                    .bind(u.failed_attempts).bind(locked).bind(&u.id).execute(&state.db).await.ok();

                Err((StatusCode::UNAUTHORIZED, Json(json!({"error": "CREDENTIAL_ERROR"}))))
            }
        }
        None => {
            let _ = SecurityCore::derive_master_key(&payload.password, &dummy_salt);
            Err((StatusCode::UNAUTHORIZED, Json(json!({"error": "CREDENTIAL_ERROR"}))))
        }
    }
}

/// 3. Create Wallet: Mnemonic generation and AES-GCM Vaulting
pub async fn create_wallet(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateWalletRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?")
        .bind(&payload.user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, "User not found".to_string()))?;

    let salt_bytes = hex::decode(&user.master_salt).unwrap();
    let master_key = SecurityCore::derive_master_key(&payload.password, &salt_bytes);

    let mnemonic = WalletEngine::generate_mnemonic();
    let address = WalletEngine::get_address_from_mnemonic(&mnemonic).await;
    let (ciphertext, nonce) = SecurityCore::encrypt(&mnemonic, &master_key);

    sqlx::query("INSERT INTO wallets (id, user_id, address, encrypted_seed, nonce) VALUES (?, ?, ?, ?, ?)")
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&payload.user_id)
        .bind(&address)
        .bind(&ciphertext)
        .bind(hex::encode(nonce))
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok((StatusCode::OK, Json(json!({ "address": address, "status": "encrypted" }))))
}

/// 4. Balance: Real-time Shimmer network check
pub async fn get_balance_handler(
    Path(address): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match WalletEngine::get_balance(&address).await {
        Ok(balance) => Ok((StatusCode::OK, Json(json!({ "address": address, "balance": balance })))),
        Err(e) => Err((StatusCode::BAD_GATEWAY, e)),
    }
}

/// 5. Transfer: Validates Secure Envelope and records used nonces
pub async fn secure_transfer(
    State(state): State<Arc<AppState>>,
    Json(envelope): Json<SecureEnvelope>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // A. Freshness check
    let now = chrono::Utc::now().timestamp();
    if (now - envelope.timestamp).abs() > 30 {
        return Err((StatusCode::BAD_REQUEST, "Timestamp expired".to_string()));
    }

    // B. Anti-Replay check
    let (count,): (i32,) = sqlx::query_as("SELECT COUNT(*) FROM used_nonces WHERE nonce = ?")
        .bind(&envelope.nonce).fetch_one(&state.db).await.unwrap_or((0,));

    if count > 0 {
        record_security_log(&state.db, "REPLAY_ATTACK", "CRITICAL", &envelope.nonce).await;
        return Err((StatusCode::CONFLICT, "Replay detected".to_string()));
    }

    // C. Save Nonce
    sqlx::query("INSERT INTO used_nonces (nonce, timestamp) VALUES (?, ?)")
        .bind(&envelope.nonce).bind(envelope.timestamp).execute(&state.db).await.ok();

    // D. Execute Mock Transfer
    let payload: TransferPayload = serde_json::from_str(&envelope.payload)
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid payload".to_string()))?;

    let block_id = WalletEngine::send_transfer("mnemonic_placeholder", &payload.recipient, payload.amount).await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;

    Ok((StatusCode::OK, Json(json!({ "block_id": block_id, "status": "confirmed" }))))
}

/// --- Database Initializer ---
pub async fn init_db(pool: &sqlx::SqlitePool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE,
            password_hash TEXT, -- ADDED THIS
            master_salt TEXT,
            totp_secret TEXT,
            failed_attempts INTEGER DEFAULT 0,
            is_locked BOOLEAN DEFAULT 0
        );"
    ).execute(pool).await.unwrap();

    sqlx::query("CREATE TABLE IF NOT EXISTS wallets (id TEXT PRIMARY KEY, user_id TEXT, address TEXT, encrypted_seed TEXT, nonce TEXT, FOREIGN KEY(user_id) REFERENCES users(id));").execute(pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS used_nonces (nonce TEXT PRIMARY KEY, timestamp INTEGER);").execute(pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS security_logs (id TEXT PRIMARY KEY, event_type TEXT, severity TEXT, details TEXT, timestamp DATETIME);").execute(pool).await.unwrap();
}

pub async fn get_logs(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let logs: Vec<Value> = sqlx::query("SELECT * FROM security_logs ORDER BY timestamp DESC LIMIT 10")
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
        .into_iter()
        .map(|row: sqlx::sqlite::SqliteRow| {
            json!({
                "event": row.get::<String, _>("event_type"),
                "severity": row.get::<String, _>("severity"),
                "details": row.get::<String, _>("details"),
                "time": row.get::<String, _>("timestamp")
            })
        })
        .collect();

    Ok((StatusCode::OK, Json(logs)))
}