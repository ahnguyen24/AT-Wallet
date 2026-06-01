use axum::{extract::State, Json, http::StatusCode, response::IntoResponse};
use crate::security::{encryption::SecurityCore, totp, hashing};
use crate::wallet::engine::WalletEngine;
use crate::models::{User, WalletRecord};
use crate::api::envelope::SecureEnvelope;
use sqlx::{SqlitePool, Row};
use serde_json::{json, Value};
use std::sync::Arc;

pub struct AppState {
    pub db: SqlitePool,
}

// --- ALL REQUIRED STRUCTS ---
#[derive(serde::Deserialize)]
pub struct RegisterRequest { pub email: String, pub password: String }

#[derive(serde::Deserialize)]
pub struct LoginRequest { pub email: String, pub password: String, pub totp_token: String }

#[derive(serde::Deserialize)]
pub struct CreateWalletRequest { pub user_id: String, pub password: String }

#[derive(serde::Deserialize)]
pub struct ActionRequest { pub user_id: String, pub password: String }

#[derive(serde::Deserialize)]
pub struct TransferPayload { pub recipient: String, pub amount: u64 }

async fn record_security_log(pool: &SqlitePool, event: &str, severity: &str, details: &str) {
    let _ = sqlx::query("INSERT INTO security_logs (id, event_type, severity, details, timestamp) VALUES (?, ?, ?, ?, ?)")
        .bind(uuid::Uuid::new_v4().to_string()).bind(event).bind(severity).bind(details).bind(chrono::Utc::now()).execute(pool).await;
}

pub async fn register_user(State(state): State<Arc<AppState>>, Json(payload): Json<RegisterRequest>) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let user_id = uuid::Uuid::new_v4().to_string();
    let salt = hex::encode(rand::random::<[u8; 16]>());
    let (totp_secret, _) = totp::generate_totp_secret(&payload.email);
    let password_hash = hashing::hash_payment_pin(&payload.password);
    sqlx::query("INSERT INTO users (id, email, password_hash, master_salt, totp_secret) VALUES (?, ?, ?, ?, ?)")
        .bind(&user_id).bind(&payload.email).bind(&password_hash).bind(&salt).bind(&totp_secret).execute(&state.db).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    Ok((StatusCode::CREATED, Json(json!({ "user_id": user_id, "totp_secret": totp_secret }))))
}

pub async fn login_user(State(state): State<Arc<AppState>>, Json(payload): Json<LoginRequest>) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let user: Option<User> = sqlx::query_as("SELECT * FROM users WHERE email = ?").bind(&payload.email).fetch_optional(&state.db).await.ok().flatten();
    let dummy_salt = vec![0u8; 16];
    match user {
        Some(mut u) => {
            if u.is_locked { return Err((StatusCode::FORBIDDEN, Json(json!({"error": "BLOCK_ERROR"})))); }
            let salt_bytes = hex::decode(&u.master_salt).unwrap_or(dummy_salt);
            let _key = SecurityCore::derive_master_key(&payload.password, &salt_bytes);
            if hashing::verify_payment_pin(&u.password_hash, &payload.password) && totp::verify_totp(&u.totp_secret, &payload.totp_token) {
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

    sqlx::query("INSERT INTO wallets (id, user_id, address, encrypted_seed, nonce) VALUES (?, ?, ?, ?, ?)")
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&payload.user_id)
        .bind(&address)
        .bind(&ciphertext) // This hex string now includes the Tag
        .bind(hex::encode(nonce))
        .execute(&state.db).await.unwrap();

    Ok((StatusCode::OK, Json(json!({ "address": address, "status": "encrypted" }))))
}

pub async fn get_balance_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ActionRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    // 1. Get DB Records
    let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?").bind(&payload.user_id).fetch_one(&state.db).await.unwrap();
    let wallet_rec: WalletRecord = sqlx::query_as("SELECT * FROM wallets WHERE user_id = ?").bind(&payload.user_id).fetch_one(&state.db).await.unwrap();

    // 2. Cryptographic Key Derivation (PBKDF2)
    let salt_bytes = hex::decode(&user.master_salt).unwrap();
    let master_key = SecurityCore::derive_master_key(&payload.password, &salt_bytes);
    
    // 3. AES-GCM Decryption
    let mnemonic = SecurityCore::decrypt(&wallet_rec.encrypted_seed, &master_key, &wallet_rec.nonce);

    // 4. Pass decrypted mnemonic to Wallet Engine
    match WalletEngine::get_balance(&mnemonic).await {
        Ok(balance) => Ok((StatusCode::OK, Json(json!({ "balance": balance, "status": "Decryption Verified" })))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))))
    }
}

pub async fn secure_transfer(
    State(state): State<Arc<AppState>>, 
    Json(envelope): Json<SecureEnvelope>
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    // Basic Replay Check
    let (count,): (i32,) = sqlx::query_as("SELECT COUNT(*) FROM used_nonces WHERE nonce = ?").bind(&envelope.nonce).fetch_one(&state.db).await.unwrap_or((0,));
    if count > 0 { return Err((StatusCode::CONFLICT, Json(json!({"error": "Replay attack detected"})))); }
    
    sqlx::query("INSERT INTO used_nonces (nonce, timestamp) VALUES (?, ?)").bind(&envelope.nonce).bind(envelope.timestamp).execute(&state.db).await.ok();

    Ok((StatusCode::OK, Json(json!({"status": "Transaction Authorized on Tangle"}))))
}

pub async fn get_logs(State(state): State<Arc<AppState>>) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let rows = sqlx::query("SELECT * FROM security_logs ORDER BY timestamp DESC LIMIT 10").fetch_all(&state.db).await.unwrap();
    let logs: Vec<Value> = rows.into_iter().map(|row| json!({ "event": row.get::<String, _>("event_type"), "severity": row.get::<String, _>("severity"), "details": row.get::<String, _>("details"), "time": row.get::<chrono::DateTime<chrono::Utc>, _>("timestamp") })).collect();
    Ok((StatusCode::OK, Json(logs)))
}

pub async fn init_db(pool: &SqlitePool) {
    // 1. Users Table
    sqlx::query("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, master_salt TEXT, totp_secret TEXT, failed_attempts INTEGER DEFAULT 0, is_locked BOOLEAN DEFAULT 0);").execute(pool).await.unwrap();
    
    // 2. Wallets Table (NO 'tag' column here)
    sqlx::query("CREATE TABLE IF NOT EXISTS wallets (id TEXT PRIMARY KEY, user_id TEXT, address TEXT, encrypted_seed TEXT, nonce TEXT, FOREIGN KEY(user_id) REFERENCES users(id));").execute(pool).await.unwrap();
    
    // 3. Nonces Table
    sqlx::query("CREATE TABLE IF NOT EXISTS used_nonces (nonce TEXT PRIMARY KEY, timestamp INTEGER);").execute(pool).await.unwrap();
    
    // 4. Logs Table
    sqlx::query("CREATE TABLE IF NOT EXISTS security_logs (id TEXT PRIMARY KEY, event_type TEXT, severity TEXT, details TEXT, timestamp DATETIME);").execute(pool).await.unwrap();
    
    println!("✔ Database Schema Aligned.");
}