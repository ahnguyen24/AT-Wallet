use axum::{extract::State, Json, http::StatusCode};
use crate::security::{encryption::SecurityCore, totp};
use crate::wallet::engine::WalletEngine;
use crate::models::{User}; // Ensure this matches your src/models.rs
use sqlx::SqlitePool;
use serde_json::{json};
use std::sync::Arc;

pub struct AppState {
    pub db: SqlitePool,
}

#[derive(serde::Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
}

// 1. Registration Handler
pub async fn register_user(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RegisterRequest>,
) -> Result<impl axum::response::IntoResponse, (StatusCode, String)> {
    let user_id = uuid::Uuid::new_v4().to_string();
    let salt = hex::encode(rand::random::<[u8; 16]>());
    let (totp_secret, _) = totp::generate_totp_secret(&payload.email);

    sqlx::query("INSERT INTO users (id, email, master_salt, totp_secret) VALUES (?, ?, ?, ?)")
        .bind(&user_id)
        .bind(&payload.email)
        .bind(&salt)
        .bind(&totp_secret)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok((StatusCode::CREATED, Json(json!({ "user_id": user_id, "totp_secret": totp_secret }))))
}

#[derive(serde::Deserialize)]
pub struct CreateWalletRequest {
    pub user_id: String,
    pub password: String,
}

// 2. Wallet Creation Handler
pub async fn create_wallet(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateWalletRequest>,
) -> Result<impl axum::response::IntoResponse, (StatusCode, String)> {
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

    Ok((StatusCode::OK, Json(json!({ "address": address, "status": "securely_stored" }))))
}

// 3. DATABASE INITIALIZER (This must be marked 'pub')
pub async fn init_db(pool: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE,
            master_salt TEXT,
            totp_secret TEXT,
            failed_attempts INTEGER DEFAULT 0,
            is_locked BOOLEAN DEFAULT 0
        );"
    ).execute(pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS wallets (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            address TEXT,
            encrypted_seed TEXT,
            nonce TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );"
    ).execute(pool).await.unwrap();
    
    println!("✔ Database tables verified.");
}