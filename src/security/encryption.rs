use aes_gcm::{Aes256Gcm, Key, Nonce, KeyInit, aead::Aead};
use pbkdf2::pbkdf2;
use hmac::Hmac;
use sha2::Sha512;
use zeroize::Zeroizing; // Keep only Zeroizing

pub const PBKDF2_ITERATIONS: u32 = 600_000;
pub struct SecurityCore;

impl SecurityCore {
    pub fn derive_master_key(password: &str, salt: &[u8]) -> [u8; 32] {
        let mut key = [0u8; 32];
        pbkdf2::<Hmac<Sha512>>(password.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key).expect("PBKDF2 failed");
        key
    }

    pub fn encrypt(data: &str, key_bytes: &[u8; 32]) -> (String, Vec<u8>) {
        let key = Key::<Aes256Gcm>::from_slice(key_bytes);
        let cipher = Aes256Gcm::new(key);
        let nonce_bytes = rand::random::<[u8; 12]>();
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher.encrypt(nonce, data.as_bytes()).expect("Encrypt failed");
        (hex::encode(ciphertext), nonce_bytes.to_vec())
    }

    pub fn decrypt(ciphertext_hex: &str, key_bytes: &[u8; 32], nonce_hex: &str) -> Zeroizing<String> {
        let key = Key::<Aes256Gcm>::from_slice(key_bytes);
        let cipher = Aes256Gcm::new(key);
        let ciphertext = hex::decode(ciphertext_hex).expect("Hex dec fail");
        let nonce_vec = hex::decode(nonce_hex).expect("Nonce dec fail");
        let nonce = Nonce::from_slice(&nonce_vec);
        let plaintext = cipher.decrypt(nonce, ciphertext.as_ref()).expect("Decryption integrity failure");
        let plaintext_string = String::from_utf8(plaintext).expect("UTF8 fail");
        Zeroizing::new(plaintext_string)
    }
}