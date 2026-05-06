import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'backend.db')}")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
KEY_ENC_KEY = os.getenv("KEY_ENC_KEY", "change-me-32-bytes-long-----")
JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-jwt-key")
SOLANA_RPC = os.getenv("SOLANA_RPC", "http://127.0.0.1:8899")
SOLANA_CLUSTER = os.getenv("SOLANA_CLUSTER", "local")

DEFAULT_FEE_PAYER = os.getenv("DEFAULT_FEE_PAYER")
