CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    master_salt BLOB NOT NULL,
    totp_secret TEXT,
    failed_attempts INTEGER DEFAULT 0,
    is_locked BOOLEAN DEFAULT FALSE
);

CREATE TABLE wallets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    address TEXT NOT NULL,
    encrypted_seed TEXT NOT NULL, -- AES-GCM format
    payment_pin_hash TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE security_logs (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL, -- "LOGIN_FAIL", "TX_SIGNED"
    severity TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);