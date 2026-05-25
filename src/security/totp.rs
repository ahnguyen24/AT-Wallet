use totp_rs::{Algorithm, TOTP};
use rand::{thread_rng, RngCore};

pub fn generate_totp_secret(user_email: &str) -> (String, String) {
    // 1. Generate 20 random bytes for the secret (standard for SHA1 TOTP)
    let mut secret_bytes = [0u8; 20];
    thread_rng().fill_bytes(&mut secret_bytes);

    // 2. Encode to Base32 for storage (this is the string users type into apps)
    let secret_base32 = base32::encode(base32::Alphabet::RFC4648 { padding: false }, &secret_bytes);

    // 3. Create TOTP instance with the new 7-argument signature
    // Args: algorithm, digits, skew, step, secret, issuer, account_name
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
    // 1. Decode Base32 string back to bytes
    let secret_bytes = base32::decode(base32::Alphabet::RFC4648 { padding: false }, secret_base32)
        .expect("Invalid Base32 secret");

    // 2. Create TOTP instance for verification
    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret_bytes,
        Some("IOTA-Secure-Wallet".to_string()),
        "user@placeholder.com".to_string(), // Metadata doesn't affect token check
    ).expect("Failed to create TOTP");
    
    totp.check_current(token).unwrap_or(false)
}