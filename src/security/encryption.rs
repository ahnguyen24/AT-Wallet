use aes_gcm::{Aes256Gcm, Key, Nonce, KeyInit, aead::Aead};
use pbkdf2::pbkdf2;
use hmac::Hmac; // Required for modern PBKDF2
use sha2::Sha512;

pub const PBKDF2_ITERATIONS: u32 = 600_000;

pub struct SecurityCore;

impl SecurityCore {
    pub fn derive_master_key(password: &str, salt: &[u8]) -> [u8; 32] {
        let mut key = [0u8; 32];
        // We use Hmac<Sha512> as the PRF
        pbkdf2::<Hmac<Sha512>>(
            password.as_bytes(),
            salt,
            PBKDF2_ITERATIONS,
            &mut key
        ).expect("PBKDF2 failed");
        key
    }

    pub fn encrypt(data: &str, key_bytes: &[u8; 32]) -> (String, Vec<u8>) {
        let key = Key::<Aes256Gcm>::from_slice(key_bytes);
        let cipher = Aes256Gcm::new(key);
        
        // In production, this must be a random 12-byte nonce saved with the data
        let nonce_bytes = [0u8; 12]; 
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher.encrypt(nonce, data.as_bytes())
            .expect("Encryption failure");
        
        (hex::encode(ciphertext), nonce_bytes.to_vec())
    }
}