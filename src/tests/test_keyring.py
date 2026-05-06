import os
from backend.keyring import generate_keypair, export_encrypted_keypair, decrypt_private_key


def test_key_encrypt_decrypt():
    kp = generate_keypair()
    enc, pub = export_encrypted_keypair(kp)
    assert enc
    priv = decrypt_private_key(enc)
    assert priv is not None

if __name__ == "__main__":
    test_key_encrypt_decrypt()
    print("keyring test passed")
