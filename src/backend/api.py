from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from .db import SessionLocal, init_db
from .models import User, Keystore, Wallet, Transaction #[cite: 8]
from .keyring import generate_keypair, export_encrypted_keypair #[cite: 6]
from .tasks import q
from argon2 import PasswordHasher
from datetime import datetime
from .auth import create_token, get_current_user #[cite: 2]
from .fraud_gate import assess_risk
from .solana_client import get_balance #[cite: 9]

router = APIRouter()


@router.get("/")
def api_root():
    endpoints = []
    for r in router.routes:
        path = getattr(r, "path", None)
        methods = getattr(r, "methods", None)
        if not path or not methods:
            continue
        method_list = [m for m in sorted(methods) if m not in ("HEAD", "OPTIONS")]
        if not method_list:
            continue
        endpoints.append({
            "path": f"/api{path}",
            "methods": method_list,
            "name": getattr(r, "name", None),
        })

    return {"message": "AT-Wallet Backend API", "endpoints": endpoints}

class RegisterIn(BaseModel):
    username: str
    password: str

class TransferIn(BaseModel):
    receiver: str
    amount: float
    
@router.post("/login")
def login(payload: RegisterIn):
    db = SessionLocal()
    user = db.query(User).filter(User.username == payload.username).first()
    if not user:
        print(f"[-] Login failed: User {payload.username} not found") # Debug
        raise HTTPException(status_code=400, detail="invalid credentials")
    
    ph = PasswordHasher()
    try:
        ph.verify(user.password_hash, payload.password)
    except Exception as e:
        print(f"[-] Login failed: Password mismatch for {payload.username}") # Debug
        raise HTTPException(status_code=400, detail="invalid credentials")
    
    token = create_token(user.id)
    # Đảm bảo token là chuỗi để FastAPI có thể serialize sang JSON
    return {"access_token": str(token)}

@router.post("/register")
def register(payload: RegisterIn):
    db = SessionLocal()
    exists = db.query(User).filter(User.username == payload.username).first()
    if exists:
        raise HTTPException(status_code=400, detail="user exists")
    
    ph = PasswordHasher()
    pw_hash = ph.hash(payload.password)
    user = User(username=payload.username, password_hash=pw_hash)
    db.add(user)
    db.commit()
    db.refresh(user)

    kp = generate_keypair() #[cite: 6]
    enc, pub = export_encrypted_keypair(kp)
    ks = Keystore(user_id=user.id, enc_private_key=enc, pubkey=pub)
    db.add(ks)
    
    wallet = Wallet(user_id=user.id, address=pub, balance=0.0) #[cite: 8]
    db.add(wallet)
    db.commit()
    return {"user_id": user.id, "address": pub}

@router.post("/transfer")
def transfer(payload: TransferIn, current_user: User = Depends(get_current_user)):
    db = SessionLocal()
    score = assess_risk({"amount": payload.amount, "sender_id": current_user.id, "receiver": payload.receiver}) #[cite: 5]

    tx = Transaction(sender_id=current_user.id, receiver=payload.receiver, amount=payload.amount, status="pending")
    db.add(tx)
    db.commit()
    db.refresh(tx)

    if score > 0.7:
        tx.status = "requires_approval"
        db.commit()
        return {"tx_id": tx.id, "status": "requires_approval", "risk": score}

    q.enqueue("backend.tasks.process_pending_tx", tx.id) #[cite: 10]
    return {"tx_id": tx.id, "status": "queued", "risk": score}

@router.get("/wallet/info")
def get_wallet_info(current_user: User = Depends(get_current_user)):
    db = SessionLocal()
    wallet = db.query(Wallet).filter(Wallet.user_id == current_user.id).first() #[cite: 8]
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    
    # Lấy số dư thực tế từ mạng Solana (đổi từ lamports sang SOL)[cite: 9]
    on_chain_balance = get_balance(wallet.address) / 1_000_000_000
    
    return {
        "address": wallet.address,
        "db_balance": wallet.balance,
        "on_chain_balance": on_chain_balance
    }

@router.get("/transactions/history")
def get_tx_history(current_user: User = Depends(get_current_user)):
    db = SessionLocal()
    # Lấy danh sách giao dịch mới nhất của user[cite: 8]
    return db.query(Transaction).filter(Transaction.sender_id == current_user.id).order_by(Transaction.created_at.desc()).all()

@router.get("/health")
def health():
    return {"status": "ok", "time": datetime.utcnow()}