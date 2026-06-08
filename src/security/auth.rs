use jsonwebtoken::{encode, decode, Header, Algorithm, Validation, EncodingKey, DecodingKey};
use serde::{Serialize, Deserialize};
use chrono::{Utc, Duration};
use once_cell::sync::OnceCell; // ADDED: Safe global static storage

// This static variable will hold our key in secure, read-only memory after startup
pub static JWT_SECRET_KEY: OnceCell<Vec<u8>> = OnceCell::new();

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,      
    pub exp: usize,       
    pub iat: usize,       
}

/// Helper to access the read-only static key.
/// Fail-Secure: If called before main() initializes it, the app crashes.
fn get_jwt_secret() -> &'static [u8] {
    JWT_SECRET_KEY.get()
        .expect("CRITICAL SECURITY ERROR: JWT_SECRET_KEY has not been initialized on startup!")
}

pub fn create_jwt(user_id: &str) -> String {
    let expiration = Utc::now()
        .checked_add_signed(Duration::minutes(15))
        .expect("valid timestamp")
        .timestamp();

    let claims = Claims {
        sub: user_id.to_owned(),
        iat: Utc::now().timestamp() as usize,
        exp: expiration as usize,
    };

    let secret = get_jwt_secret();

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret),
    ).expect("Token generation failed")
}

pub fn verify_jwt(token: &str) -> Result<String, String> {
    let secret = get_jwt_secret();

    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret),
        &Validation::new(Algorithm::HS256),
    )
    .map(|data| data.claims.sub)
    .map_err(|e| e.to_string())
}