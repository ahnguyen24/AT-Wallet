from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from pydantic import BaseModel, Field
from .db import SessionLocal, init_db
from .models import User, Keystore, Wallet, Transaction, TrustScoreHistory #[cite: 8]
from .models import SecurityLog
from .keyring import generate_keypair, export_encrypted_keypair #[cite: 6]
from .tasks import q
from argon2 import PasswordHasher
from datetime import datetime
from .auth import create_token, get_current_user #[cite: 2]
from .fraud_gate import assess_risk
from .solana_client import get_balance #[cite: 9]
import os

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
    # accept either `receiver` or `recipient` from frontend
    receiver: Optional[str] = None
    recipient: Optional[str] = None
    amount: float
    password: str = Field(..., min_length=1)

@router.post("/login")
def login(payload: RegisterIn):
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == payload.username).first()
        if not user:
            print(f"[-] Login failed: User {payload.username} not found") # Debug
            raise HTTPException(status_code=400, detail="invalid credentials")
        ph = PasswordHasher()
        try:
            ph.verify(user.password_hash, payload.password)
        except Exception:
            print(f"[-] Login failed: Password mismatch for {payload.username}") # Debug
            raise HTTPException(status_code=400, detail="invalid credentials")

        # Deny login for Danger users (trust_score <= 5.0)
        if (user.trust_score or 0.0) <= 5.0:
            raise HTTPException(status_code=403, detail="account locked: submit complaint to admin")

        token = create_token(user.id)
        return {"access_token": str(token), "user_id": user.id, "trust_score": user.trust_score}
    finally:
        db.close()

@router.post("/register")
def register(payload: RegisterIn):
    db = SessionLocal()
    try:
        exists = db.query(User).filter(User.username == payload.username).first()
        if exists:
            raise HTTPException(status_code=400, detail="user exists")
        ph = PasswordHasher()
        pw_hash = ph.hash(payload.password)
        # Sửa thành 6.0 để rơi vào luồng 'requires_approval' khi test
        user = User(username=payload.username, password_hash=pw_hash, trust_score=6.0)
        db.add(user)
        db.commit()
        db.refresh(user)

        kp = generate_keypair() #[cite: 6]
        enc, pub = export_encrypted_keypair(kp)
        ks = Keystore(user_id=user.id, enc_private_key=enc, pubkey=pub)
        db.add(ks)

        # Create wallet and persist server-side signature (not returned to client)
        # initialize new accounts with 10 SOL for local testing
        wallet = Wallet(user_id=user.id, address=pub, balance=10.0)
        db.add(wallet)
        db.commit()
        return {"user_id": user.id}
    finally:
        db.close()

@router.post("/transfer")
def transfer(payload: TransferIn, current_user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        # 1. XÁC THỰC MẬT KHẨU GIAO DỊCH (Bổ sung lớp bảo mật quan trọng)
        ph = PasswordHasher()
        try:
            ph.verify(current_user.password_hash, payload.password)
        except Exception:
            raise HTTPException(status_code=401, detail="Mật khẩu giao dịch không chính xác")

        # 2. KIỂM TRA SỐ DƯ (Di chuyển lên đầu để chặn ngay lập tức)
        sender_wallet = db.query(Wallet).filter(Wallet.user_id == current_user.id).first()
        if not sender_wallet or sender_wallet.balance < payload.amount:
            raise HTTPException(status_code=400, detail="Số dư không đủ để thực hiện giao dịch")

        # 3. Tìm người nhận và kiểm tra điểm số
        receiver_user = db.query(User).filter(User.username == payload.recipient).first()
        # Nếu không tìm thấy qua username, thử tìm qua địa chỉ ví
        if not receiver_user:
            rw = db.query(Wallet).filter(Wallet.address == payload.recipient).first()
            if rw:
                receiver_user = db.query(User).filter(User.id == rw.user_id).first()

        # --- RULE: Block if receiver is Danger ---
        if receiver_user and receiver_user.trust_score <= 5.0:
            # Giảm điểm cả 2 theo rule: "For each blocked transaction... score is decreasing 0.75"
            current_user.trust_score = max(0.0, current_user.trust_score - 0.75)
            receiver_user.trust_score = max(0.0, receiver_user.trust_score - 0.75)
            db.commit()
            raise HTTPException(status_code=400, detail="Giao dịch bị chặn: Người nhận thuộc danh sách nguy hiểm.")

        # 4. Phân loại trạng thái giao dịch dựa trên Trust Score
        s_score = current_user.trust_score
        r_score = receiver_user.trust_score if receiver_user else 8.0 # Mặc định 8.0 nếu gửi ví ngoài hệ thống
        
        # Mặc định status
        status = "pending" 
        
        # RULE: Nếu 1 trong 2 là Warning (5.1 -> 7.5) -> Cần admin duyệt
        if (5.1 <= s_score <= 7.5) or (5.1 <= r_score <= 7.5):
            status = "requires_approval"
        
        # RULE: Nếu cả 2 đều >= 7.6 (Normal/Excellent) -> Tự động duyệt (vẫn để pending để worker xử lý)
        elif s_score > 7.5 and r_score > 7.5:
            status = "pending"

        # 5. Khấu trừ tiền ngay lập tức sau khi các kiểm tra an toàn đã pass
        sender_wallet.balance -= payload.amount

        # 6. Tạo giao dịch
        new_tx = Transaction(
            sender_id=current_user.id,
            receiver=payload.recipient,
            amount=payload.amount,
            status=status
        )
        db.add(new_tx)
        db.commit()

        # Nếu là pending thì đẩy vào queue cho worker xử lý ngay
        if status == "pending":
            q.enqueue("backend.tasks.process_pending_tx", new_tx.id)

        return {"status": status, "tx_id": new_tx.id}
    finally:
        db.close()

@router.get("/user/trust-history")
def get_trust_history(current_user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        rows = db.query(TrustScoreHistory).filter(
            TrustScoreHistory.user_id == current_user.id
        ).order_by(TrustScoreHistory.created_at.asc()).all()
        out = []
        for r in rows:
            out.append({"id": r.id, "user_id": r.user_id, "score_before": r.score_before, "score_after": r.score_after, "reason": r.reason, "created_at": r.created_at.isoformat() if r.created_at else None})
        return out
    finally:
        db.close()

@router.get("/wallet/info")
def get_wallet_info(current_user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        wallet = db.query(Wallet).filter(Wallet.user_id == current_user.id).first() #[cite: 8]
        if not wallet:
            raise HTTPException(status_code=404, detail="Wallet not found")
        # Lấy số dư thực tế từ mạng Solana (đổi từ lamports sang SOL)[cite: 9]
        try:
            on_chain_balance = get_balance(wallet.address) / 1_000_000_000
        except Exception:
            on_chain_balance = None

        # compute trust title for current user
        ts = current_user.trust_score or 0.0
        if ts <= 5.0:
            trust_title = 'Danger'
        elif ts <= 7.5:
            trust_title = 'Warning'
        elif ts <= 9.0:
            trust_title = 'Normal'
        else:
            trust_title = 'Excellent'

        return {
            "address": wallet.address,
            "db_balance": wallet.balance,
            "on_chain_balance": on_chain_balance,
            "trust_title": trust_title,
            "trust_score": ts
        }
    finally:
        db.close()


@router.get('/user/trust')
def user_trust(username: Optional[str] = None):
    db = SessionLocal()
    if not username:
        raise HTTPException(status_code=400, detail='username required')
    u = db.query(User).filter(User.username == username).first()
    if not u:
        # try wallet address
        w = db.query(Wallet).filter(Wallet.address == username).first()
        if w:
            u = db.query(User).filter(User.id == w.user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail='user not found')
    try:
        ts = u.trust_score or 0.0
        title = 'Danger'
        if ts > 9.0:
            title = 'Excellent'
        elif ts > 7.5:
            title = 'Normal'
        elif ts > 5.0:
            title = 'Warning'
        return {"title": title, "trust_score": ts}
    finally:
        db.close()

@router.get("/transactions/history")
def get_tx_history(current_user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        rows = db.query(Transaction).filter(Transaction.sender_id == current_user.id).order_by(Transaction.created_at.desc()).all()
        out = []
        for t in rows:
            out.append({"id": t.id, "sender_id": t.sender_id, "receiver": t.receiver, "amount": t.amount, "status": t.status, "signature": t.signature, "slot": t.slot, "created_at": t.created_at.isoformat() if t.created_at else None})
        return out
    finally:
        db.close()

@router.get("/health")
def health():
    return {"status": "ok", "time": datetime.utcnow()}


class ComplaintIn(BaseModel):
    message: str


@router.post('/complaint')
def submit_complaint(payload: ComplaintIn, current_user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        # log the complaint for admin review
        log = SecurityLog(event_type='complaint', description=f'user:{current_user.id} msg:{payload.message}')
        db.add(log)
        db.commit()
        return {"status":"ok"}
    finally:
        db.close()


class ComplaintAnonIn(BaseModel):
    username: str
    message: str


@router.post('/complaint/anon')
def submit_complaint_anon(payload: ComplaintAnonIn):
    db = SessionLocal()
    try:
        # try resolve username to user id for admin context
        u = db.query(User).filter(User.username == payload.username).first()
        desc = f'user:{u.id if u else payload.username} msg:{payload.message}'
        log = SecurityLog(event_type='complaint', description=desc)
        db.add(log)
        db.commit()
        return {"status": "ok"}
    finally:
        db.close()