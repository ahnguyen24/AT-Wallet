use jsonwebtoken::{encode, decode, Header, Algorithm, Validation, EncodingKey, DecodingKey};
use serde::{Serialize, Deserialize};
use chrono::{Utc, Duration};
use std::env; // ADDED

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,      
    pub exp: usize,       
    pub iat: usize,       
}

/// Helper to load the JWT secret safely from the environment.
/// Fail-Secure: If the secret is missing, the application crashes on startup.
fn get_jwt_secret() -> Vec<u8> {
    env::var("JWT_SECRET")
        .expect("CRITICAL SECURITY ERROR: JWT_SECRET environment variable is not set!")
        .into_bytes()
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

    // Load secret dynamically
    let secret = get_jwt_secret();

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(&secret),
    ).expect("Token generation failed")
}

pub fn verify_jwt(token: &str) -> Result<String, String> {
    let secret = get_jwt_secret();

    decode::<Claims>(
        token,
        &DecodingKey::from_secret(&secret),
        &Validation::new(Algorithm::HS256),
    )
    .map(|data| data.claims.sub)
    .map_err(|e| e.to_string())
}