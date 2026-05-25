use serde::{Deserialize, Serialize};
use crate::security::identity;
use ed25519_dalek::{VerifyingKey, Signature};
use std::str::FromStr;

#[derive(Serialize, Deserialize, Debug)]
pub struct SecureEnvelope {
    pub payload: String,    // Encrypted Data (AES-GCM)
    pub nonce: String,      // Unique identifier for this request
    pub timestamp: i64,     // Unix timestamp (must be within 30s window)
    pub signature: String,  // Ed25519 signature of (payload + nonce + timestamp)
}

impl SecureEnvelope {
    pub fn verify(&self, public_key_hex: &str) -> bool {
        // 1. Check Freshness (Anti-Replay)
        let now = chrono::Utc::now().timestamp();
        if (now - self.timestamp).abs() > 30 {
            return false; // Request too old or from the future
        }

        // 2. Verify Signature
        let public_key_bytes = hex::decode(public_key_hex).unwrap();
        let public_key = VerifyingKey::from_bytes(&public_key_bytes.try_into().unwrap()).unwrap();
        
        let message = format!("{}{}{}", self.payload, self.nonce, self.timestamp);
        let sig = Signature::from_str(&self.signature).unwrap();

        identity::verify_identity(&public_key, message.as_bytes(), &sig)
    }
}