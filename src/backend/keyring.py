import os
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
from .config import KEY_ENC_KEY


def _ensure_key_bytes(key: str) -> bytes:
    b = key.encode() if isinstance(key, str) else key
    if len(b) < 32:
        b = (b * 32)[:32]
    return b[:32]


def generate_keypair():
    """Generate an Ed25519 private key (cryptography) and return the private key object."""
    return Ed25519PrivateKey.generate()


def encrypt_private_key(private_bytes: bytes) -> str:
    key = _ensure_key_bytes(KEY_ENC_KEY)
    aes = AESGCM(key)
    nonce = os.urandom(12)
    ct = aes.encrypt(nonce, private_bytes, None)
    blob = nonce + ct
    return base64.b64encode(blob).decode()


def decrypt_private_key(enc_blob_b64: str) -> bytes:
    key = _ensure_key_bytes(KEY_ENC_KEY)
    aes = AESGCM(key)
    blob = base64.b64decode(enc_blob_b64)
    nonce = blob[:12]
    ct = blob[12:]
    return aes.decrypt(nonce, ct, None)


def export_encrypted_keypair(kp) -> (str, str):
    # serialize private key to raw bytes
    priv_bytes = kp.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    enc = encrypt_private_key(priv_bytes)
    pubkey = kp.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    pub = pubkey.hex()
    return enc, pub
