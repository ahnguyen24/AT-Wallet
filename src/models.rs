use serde::{Deserialize, Serialize};
// Removed: use sqlx::FromRow; (already included in sqlx macros or unused)

#[derive(Debug, sqlx::FromRow, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub password_hash: String,
    pub master_salt: String,
    pub totp_secret: String,
    pub failed_attempts: i32,
    pub is_locked: bool,
    pub full_name: String,
    pub phone: String,
    pub cccd: String,
    pub pin_hash: String,
}

#[derive(Debug, sqlx::FromRow, Serialize, Deserialize)]
pub struct WalletRecord {
    pub id: String,
    pub user_id: String,
    pub address: String,
    pub encrypted_seed: String,
    pub nonce: String,
    pub balance: f64,
}