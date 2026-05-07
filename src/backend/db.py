from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from .config import DATABASE_URL

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def init_db():
    Base.metadata.create_all(bind=engine)
    # Ensure `trust_score` column exists for users table (add when upgrading schema)
    try:
        if DATABASE_URL.startswith('sqlite'):
            conn = engine.connect()
            res = conn.execute("PRAGMA table_info(users);")
            cols = [r[1] for r in res.fetchall()]
            if 'trust_score' not in cols:
                conn.execute("ALTER TABLE users ADD COLUMN trust_score FLOAT DEFAULT 8.0;")
            conn.close()
        else:
            # For other DBs, best to rely on migrations; try to add column if missing
            conn = engine.connect()
            try:
                conn.execute("ALTER TABLE users ADD COLUMN trust_score FLOAT DEFAULT 8.0;")
            except Exception:
                pass
            conn.close()
    except Exception:
        pass

def seed_sample_accounts():
    """Create 5 sample users with wallets and balances for testing."""
    db = SessionLocal()
    # Do not early-return based on count; ensure sample users exist if missing

    from argon2 import PasswordHasher
    ph = PasswordHasher()
    samples = [
        ("alice", "password1", 10.0),
        ("bob", "password2", 20.0),
        ("carol", "password3", 30.0),
        ("dave", "password4", 40.0),
        ("eve", "password5", 50.0),
    ]
    from .keyring import generate_keypair, export_encrypted_keypair
    from .models import User, Keystore, Wallet

    for username, pw, bal in samples:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            user = User(username=username, password_hash=ph.hash(pw), trust_score=8.0)
            db.add(user)
            db.commit()
            db.refresh(user)

        # Ensure keystore exists for user
        ks = db.query(Keystore).filter(Keystore.user_id == user.id).first()
        if not ks:
            kp = generate_keypair()
            enc, pub = export_encrypted_keypair(kp)
            ks = Keystore(user_id=user.id, enc_private_key=enc, pubkey=pub)
            db.add(ks)
            db.commit()
        else:
            pub = ks.pubkey

        # Ensure wallet exists for user
        w = db.query(Wallet).filter(Wallet.user_id == user.id).first()
        if not w:
            wallet = Wallet(user_id=user.id, address=pub, balance=bal)
            db.add(wallet)
            db.commit()

    # Create an admin account if requested via environment variables
    import os
    admin_user = os.environ.get('ADMIN_USER', 'admin')
    admin_pass = os.environ.get('ADMIN_PASS', 'admin123')
    # ensure admin user exists
    admin = db.query(User).filter(User.username == admin_user).first()
    if not admin:
        admin = User(username=admin_user, password_hash=ph.hash(admin_pass), is_admin=True, trust_score=9.5)
        db.add(admin)
        db.commit()
        db.refresh(admin)
    # ensure keystore and wallet exist for admin
    ks = db.query(Keystore).filter(Keystore.user_id == admin.id).first()
    if not ks:
        kp = generate_keypair()
        enc, pub = export_encrypted_keypair(kp)
        ks = Keystore(user_id=admin.id, enc_private_key=enc, pubkey=pub)
        db.add(ks)
        db.commit()
    else:
        pub = ks.pubkey
    w = db.query(Wallet).filter(Wallet.user_id == admin.id).first()
    if not w:
        wallet = Wallet(user_id=admin.id, address=pub, balance=0.0)
        db.add(wallet)
        db.commit()
