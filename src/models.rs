use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use chrono::{DateTime, Utc};

#[derive(Debug, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub password_hash: String, // ADDED
    pub master_salt: String,
    pub totp_secret: String,
    pub failed_attempts: i32,
    pub is_locked: bool,
}

#[derive(Debug, FromRow, Serialize, Deserialize)]
pub struct WalletRecord {
    pub id: String,
    pub user_id: String,
    pub address: String,
    pub encrypted_seed: String,  // AES-GCM Ciphertext
    pub nonce: String,           // AES-GCM Nonce/IV
    pub tag: String,             // AES-GCM Auth Tag
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SecurityLog {
    pub id: String,
    pub event_type: String,      // e.g., "LOGIN_FAIL", "REPLAY_ATTACK"
    pub severity: String,        // "LOW", "CRITICAL"
    pub timestamp: DateTime<Utc>,
}