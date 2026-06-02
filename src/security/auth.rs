use jsonwebtoken::{encode, decode, Header, Algorithm, Validation, EncodingKey, DecodingKey};
use serde::{Serialize, Deserialize};
use chrono::{Utc, Duration};

// In production, this should be a long random string in your .env file
const JWT_SECRET: &[u8] = b"iota_secure_vault_super_secret_key_2024";

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,      // Subject (User ID)
    pub exp: usize,       // Expiration time (Unix timestamp)
    pub iat: usize,       // Issued at (Unix timestamp)
}

/// Creates a new JWT valid for 15 minutes
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

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(JWT_SECRET),
    ).expect("Token generation failed")
}

/// Verifies a JWT and returns the User ID (sub)
pub fn verify_jwt(token: &str) -> Result<String, String> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(JWT_SECRET),
        &Validation::new(Algorithm::HS256),
    )
    .map(|data| data.claims.sub)
    .map_err(|e| e.to_string())
}