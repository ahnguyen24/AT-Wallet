use axum::{
    extract::{State, Path}, 
    Json, 
    http::{StatusCode, HeaderMap}, 
    response::IntoResponse
};
use crate::security::{encryption::SecurityCore, totp, hashing, auth};
use crate::wallet::engine::WalletEngine;
use crate::models::{User, WalletRecord};
use crate::api::envelope::SecureEnvelope;
use sqlx::{SqlitePool, Row};
use serde_json::{json, Value};
use std::sync::Arc;

/// Global App State
pub struct AppState {
    pub db: SqlitePool,
}

// --- Data Transfer Objects (DTOs) ---
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

// --- PHASE 4 SECURITY HELPERS ---

/// Helper to record security events in the Audit Trail
async fn record_security_log(pool: &SqlitePool, event: &str, severity: &str, details: &str) {
    let id = uuid::Uuid::new_v4().to_string();
    
    // Changed 'let _ =' to a match block to print errors
    match sqlx::query(
        "INSERT INTO security_logs (id, event_type, severity, details, timestamp) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(id)
    .bind(event)
    .bind(severity)
    .bind(details)
    .bind(chrono::Utc::now())
    .execute(pool)
    .await {
        Ok(_) => println!("✔ [Audit Log] Recorded event: {}", event),
        Err(e) => println!("❌ [Audit Log Error] Failed to write to DB: {}", e),
    }
}

/// Validates the JWT from the Authorization header
fn authorize_request(headers: &HeaderMap) -> Result<String, (StatusCode, Json<Value>)> {
    let auth_header = headers.get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .ok_or((
            StatusCode::UNAUTHORIZED, 
            Json(json!({"error": "Missing or malformed session token"}))
        ))?;

    auth::verify_jwt(auth_header).map_err(|_| (
        StatusCode::UNAUTHORIZED, 
        Json(json!({"error": "Session expired. Please login again."}))
    ))
}

// --- API HANDLERS ---

pub async fn register_user(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RegisterRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let user_id = uuid::Uuid::new_v4().to_string();
    let salt = hex::encode(rand::random::<[u8; 16]>());
    let (totp_secret, _) = totp::generate_totp_secret(&payload.email);
    let password_hash = hashing::hash_payment_pin(&payload.password);

    sqlx::query("INSERT INTO users (id, email, password_hash, master_salt, totp_secret) VALUES (?, ?, ?, ?, ?)")
        .bind(&user_id).bind(&payload.email).bind(&password_hash).bind(&salt).bind(&totp_secret)
        .execute(&state.db).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok((StatusCode::CREATED, Json(json!({ "user_id": user_id, "totp_secret": totp_secret }))))
}

// --- 1. LOGIN: Returns Address if exists ---
pub async fn login_user(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoginRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let user: Option<User> = sqlx::query_as("SELECT * FROM users WHERE email = ?").bind(&payload.email).fetch_optional(&state.db).await.unwrap_or(None);

    match user {
        Some(mut u) => {
            if u.is_locked { return Err((StatusCode::FORBIDDEN, Json(json!({"error": "BLOCK_ERROR"})))); }

            let salt_bytes = hex::decode(&u.master_salt).unwrap();
            let _ = SecurityCore::derive_master_key(&payload.password, &salt_bytes);
            
            if hashing::verify_payment_pin(&u.password_hash, &payload.password) && totp::verify_totp(&u.totp_secret, &payload.totp_token) {
                sqlx::query("UPDATE users SET failed_attempts = 0 WHERE id = ?").bind(&u.id).execute(&state.db).await.ok();
                let token = auth::create_jwt(&u.id);

                // Check if wallet already exists to return the address
                let wallet: Option<WalletRecord> = sqlx::query_as("SELECT * FROM wallets WHERE user_id = ?").bind(&u.id).fetch_optional(&state.db).await.unwrap_or(None);
                let address = wallet.map(|w| w.address).unwrap_or("".to_string());

                Ok((StatusCode::OK, Json(json!({ "user_id": u.id, "token": token, "address": address, "status": "success" }))))
            } else {
                u.failed_attempts += 1;
                let locked = u.failed_attempts >= 5;
                sqlx::query("UPDATE users SET failed_attempts = ?, is_locked = ? WHERE id = ?").bind(u.failed_attempts).bind(locked).bind(&u.id).execute(&state.db).await.ok();
                Err((StatusCode::UNAUTHORIZED, Json(json!({"error": "CREDENTIAL_ERROR"}))))
            }
        }
        None => {
            let _ = SecurityCore::derive_master_key(&payload.password, &vec![0u8; 16]);
            Err((StatusCode::UNAUTHORIZED, Json(json!({"error": "CREDENTIAL_ERROR"}))))
        }
    }
}

// --- 2. CREATE WALLET: Idempotent (Prevents duplicates) ---
pub async fn create_wallet(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<CreateWalletRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    authorize_request(&headers)?;

    // Check if wallet already exists
    let existing: Option<WalletRecord> = sqlx::query_as("SELECT * FROM wallets WHERE user_id = ?")
        .bind(&payload.user_id).fetch_optional(&state.db).await.unwrap_or(None);

    if let Some(w) = existing {
        return Ok((StatusCode::OK, Json(json!({ "address": w.address, "status": "existing" }))));
    }

    // Otherwise, generate new
    let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?").bind(&payload.user_id).fetch_one(&state.db).await.unwrap();
    let salt_bytes = hex::decode(&user.master_salt).unwrap();
    let master_key = SecurityCore::derive_master_key(&payload.password, &salt_bytes);

    let mnemonic = WalletEngine::generate_mnemonic();
    let address = WalletEngine::get_address_from_mnemonic(&mnemonic).await;
    let (ciphertext, nonce) = SecurityCore::encrypt(&mnemonic, &master_key);

    sqlx::query("INSERT INTO wallets (id, user_id, address, encrypted_seed, nonce, balance) VALUES (?, ?, ?, ?, ?, 1000000)")
        .bind(uuid::Uuid::new_v4().to_string()).bind(&payload.user_id).bind(&address).bind(&ciphertext).bind(hex::encode(nonce))
        .execute(&state.db).await.unwrap();

    Ok((StatusCode::OK, Json(json!({ "address": address, "status": "created" }))))
}

// --- 3. GET BALANCE: Reads from local Ledger ---
pub async fn get_balance_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<ActionRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    authorize_request(&headers)?;

    // Fetch balance column directly
    let row = sqlx::query("SELECT balance FROM wallets WHERE user_id = ?")
        .bind(&payload.user_id).fetch_one(&state.db).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let balance: i64 = row.get("balance");
    Ok((StatusCode::OK, Json(json!({ "balance": balance }))))
}

// --- 4. TRANSFER: Double-Entry Bookkeeping Ledger ---
pub async fn secure_transfer(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(envelope): Json<SecureEnvelope>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let sender_id = authorize_request(&headers)?;

    // A. Replay Check
    let (count,): (i32,) = sqlx::query_as("SELECT COUNT(*) FROM used_nonces WHERE nonce = ?").bind(&envelope.nonce).fetch_one(&state.db).await.unwrap_or((0,));
    if count > 0 { return Err((StatusCode::CONFLICT, Json(json!({"error": "Replay"})))); }
    sqlx::query("INSERT INTO used_nonces (nonce, timestamp) VALUES (?, ?)").bind(&envelope.nonce).bind(envelope.timestamp).execute(&state.db).await.ok();

    // B. Parse Transfer Payload
    let tx: TransferPayload = serde_json::from_str(&envelope.payload).map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid payload"}))))?;

    // C. Get Sender Wallet
    let sender_wallet: WalletRecord = sqlx::query_as("SELECT * FROM wallets WHERE user_id = ?").bind(&sender_id).fetch_one(&state.db).await.unwrap();
    let mut sender_balance: i64 = sqlx::query("SELECT balance FROM wallets WHERE user_id = ?").bind(&sender_id).fetch_one(&state.db).await.unwrap().get("balance");

    if sender_balance < tx.amount as i64 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Insufficient funds"}))));
    }

    // D. DATABASE DOUBLE-ENTRY TRANSACTION (Debit/Credit)
    let mut db_tx = state.db.begin().await.unwrap();

    // Debit Sender
    sender_balance -= tx.amount as i64;
    sqlx::query("UPDATE wallets SET balance = ? WHERE user_id = ?").bind(sender_balance).bind(&sender_id).execute(&mut *db_tx).await.unwrap();

    // Credit Receiver
    let receiver_exists: Option<String> = sqlx::query("SELECT id FROM wallets WHERE address = ?").bind(&tx.recipient).fetch_optional(&mut *db_tx).await.unwrap().map(|row| row.get(0));
    
    if let Some(_) = receiver_exists {
        sqlx::query("UPDATE wallets SET balance = balance + ? WHERE address = ?").bind(tx.amount as i64).bind(&tx.recipient).execute(&mut *db_tx).await.unwrap();
    } else {
        // If receiver is off-chain/mock, the funds are sent into the Tangle (simulated void)
        println!("📡 Shimmer Network: Output created on-chain for external address.");
    }

    db_tx.commit().await.unwrap();

    Ok((StatusCode::OK, Json(json!({ "block_id": "0x_LIVE_LEDGER_TX_SUCCESS", "new_balance": sender_balance }))))
}

pub async fn get_logs(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    authorize_request(&headers)?;

    let rows = sqlx::query("SELECT * FROM security_logs ORDER BY timestamp DESC LIMIT 10").fetch_all(&state.db).await.unwrap();
    let logs: Vec<Value> = rows.into_iter().map(|row| json!({ 
        "event": row.get::<String, _>("event_type"), 
        "severity": row.get::<String, _>("severity"), 
        "details": row.get::<String, _>("details"), 
        "time": row.get::<chrono::DateTime<chrono::Utc>, _>("timestamp") 
    })).collect();
    
    Ok((StatusCode::OK, Json(logs)))
}

pub async fn init_db(pool: &SqlitePool) {
    sqlx::query("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, master_salt TEXT, totp_secret TEXT, failed_attempts INTEGER DEFAULT 0, is_locked BOOLEAN DEFAULT 0);").execute(pool).await.unwrap();
    
    // ADDED: balance INTEGER DEFAULT 1000000 (1 Million Glow starting balance)
    sqlx::query("CREATE TABLE IF NOT EXISTS wallets (
        id TEXT PRIMARY KEY, 
        user_id TEXT, 
        address TEXT UNIQUE, 
        encrypted_seed TEXT, 
        nonce TEXT, 
        balance INTEGER DEFAULT 1000000
    );").execute(pool).await.unwrap();

    sqlx::query("CREATE TABLE IF NOT EXISTS used_nonces (nonce TEXT PRIMARY KEY, timestamp INTEGER);").execute(pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS security_logs (id TEXT PRIMARY KEY, event_type TEXT, severity TEXT, details TEXT, timestamp DATETIME);").execute(pool).await.unwrap();
    
    println!("✔ Database Schema: Local Ledger Active.");
} 