use ed25519_dalek::{SigningKey, Signer, Verifier, Signature, VerifyingKey};
use rand::rngs::OsRng;

pub fn generate_identity() -> SigningKey {
    // Generate a random 32-byte secret and create a signing key
    let mut csprng = OsRng;
    SigningKey::generate(&mut csprng)
}

pub fn sign_message(key: &SigningKey, message: &[u8]) -> Signature {
    key.sign(message)
}

pub fn verify_identity(public_key: &VerifyingKey, message: &[u8], sig: &Signature) -> bool {
    public_key.verify(message, sig).is_ok()
}