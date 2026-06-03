use totp_rs::{Algorithm, TOTP}; // Removed Secret import
use rand::{thread_rng, RngCore};

pub fn generate_totp_secret(user_email: &str) -> (String, String) {
    let mut secret_bytes = [0u8; 20];
    thread_rng().fill_bytes(&mut secret_bytes);

    let secret_base32 = base32::encode(base32::Alphabet::RFC4648 { padding: false }, &secret_bytes);

    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret_bytes.to_vec(),
        Some("IOTA-Secure-Wallet".to_string()),
        user_email.to_string(),
    ).expect("Failed to create TOTP");

    (secret_base32, totp.get_url())
}

pub fn verify_totp(secret_base32: &str, token: &str) -> bool {
    // Standard Base32 decoding (Bypasses all totp-rs Secret enum conflicts)
    let secret_bytes = base32::decode(base32::Alphabet::RFC4648 { padding: false }, secret_base32)
        .expect("Invalid Base32 secret");

    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        2, // SKEW = 2: Safe against WSL clock drift
        30,
        secret_bytes,
        Some("IOTA-Secure-Wallet".to_string()),
        "user@placeholder.com".to_string(),
    ).expect("Failed to create TOTP");
    
    totp.check_current(token).unwrap_or(false)
}