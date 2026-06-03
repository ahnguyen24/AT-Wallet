use serde::{Deserialize, Serialize};

#[derive(Debug, sqlx::FromRow, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub password_hash: String,  // Argon2id for Login
    pub full_name: String,      // KYC Name
    pub phone: String,          // Unique Phone (10 digits)
    pub cccd: String,           // Unique National ID
    pub pin_hash: String,       // Argon2id for Transaction PIN (6 digits)
    pub master_salt: String,
    pub totp_secret: String,
    pub failed_attempts: i32,
    pub is_locked: bool,
}

#[derive(Debug, sqlx::FromRow, Serialize, Deserialize)]
pub struct WalletRecord {
    pub id: String,
    pub user_id: String,
    pub address: String,
    pub encrypted_seed: String,
    pub nonce: String,
    pub wallet_index: i32,      // 0, 1, or 2 (BIP-44 Index)
    pub balance: i64,
}