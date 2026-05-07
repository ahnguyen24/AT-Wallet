"""
Reset the database and create four users + admin with specified trust scores.
Run:
python scripts/reset_db.py
"""
from backend.db import engine, Base, SessionLocal
from backend.models import User, Keystore, Wallet
from backend.keyring import generate_keypair, export_encrypted_keypair
from argon2 import PasswordHasher

print('Resetting DB...')
Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)

ph = PasswordHasher()
users = [
    ('anh','1111',3.5,0.0),
    ('binh','2222',6.5,0.0),
    ('chau','3333',8.0,0.0),
    ('dung','4444',9.5,0.0),
]

db = SessionLocal()
for username, pw, score, bal in users:
    u = User(username=username, password_hash=ph.hash(pw), trust_score=score)
    db.add(u)
    db.commit()
    db.refresh(u)
    kp = generate_keypair()
    enc, pub = export_encrypted_keypair(kp)
    ks = Keystore(user_id=u.id, enc_private_key=enc, pubkey=pub)
    db.add(ks)
    wallet = Wallet(user_id=u.id, address=pub, balance=bal)
    db.add(wallet)
    db.commit()

# admin
admin = User(username='admin', password_hash=ph.hash('admin123'), is_admin=True, trust_score=9.5)
db.add(admin)
db.commit()
db.refresh(admin)
kp = generate_keypair()
enc, pub = export_encrypted_keypair(kp)
ks = Keystore(user_id=admin.id, enc_private_key=enc, pubkey=pub)
db.add(ks)
wallet = Wallet(user_id=admin.id, address=pub, balance=0.0)
db.add(wallet)
db.commit()
print('Done. Created users: anh, binh, chau, dung and admin.')