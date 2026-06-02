use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};

pub fn hash_payment_pin(pin: &str) -> String {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2.hash_password(pin.as_bytes(), &salt)
        .expect("Argon2 hashing failed")
        .to_string()
}

pub fn verify_payment_pin(hash: &str, pin: &str) -> bool {
    let parsed_hash = PasswordHash::new(hash).expect("Invalid hash format");
    Argon2::default().verify_password(pin.as_bytes(), &parsed_hash).is_ok()
}