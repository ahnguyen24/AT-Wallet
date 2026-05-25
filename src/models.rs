use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, FromRow, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub master_salt: Vec<u8>,
    pub totp_secret: String,
    pub failed_attempts: i32,
    pub is_locked: bool,
}

#[derive(Debug, FromRow)]
pub struct WalletRecord {
    pub id: String,
    pub user_id: String,
    pub address: String,
    pub encrypted_seed: String,
    pub payment_pin_hash: String,
}

#[derive(Debug, FromRow)]
pub struct SecurityLog {
    pub id: String,
    pub event_type: String,
    pub severity: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}