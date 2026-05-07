from fastapi import APIRouter, Depends, HTTPException, Header, Body
from fastapi.security import HTTPBasic, HTTPBasicCredentials, HTTPAuthorizationCredentials, HTTPBearer
from typing import List, Optional
from pydantic import BaseModel
import os
import secrets
import jwt
import time

from .db import SessionLocal
from .models import Transaction, Wallet, User, SecurityLog
from .tasks import q
from .config import JWT_SECRET
from .auth import decode_token

router = APIRouter()
security = HTTPBasic(auto_error=False)
bearer = HTTPBearer(auto_error=False)

# --- SCHEMAS ---

class AdminAction(BaseModel):
    action: str  # "approve" hoặc "reject"

class CreditPayload(BaseModel):
    amount: float

# --- MIDDLEWARE & AUTH ---

def _check_basic(credentials: Optional[HTTPBasicCredentials]):
    if not credentials:
        return False
    admin_user = os.environ.get("ADMIN_USER", "admin")
    admin_pass = os.environ.get("ADMIN_PASS", "admin123")
    return secrets.compare_digest(credentials.username, admin_user) and \
           secrets.compare_digest(credentials.password, admin_pass)

def require_admin(
    credentials: Optional[HTTPBasicCredentials] = Depends(security),
    bearer_creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)
):
    # Chấp nhận Basic Auth hoặc Bearer Token (với role admin)
    if _check_basic(credentials):
        return True

    if bearer_creds and bearer_creds.scheme.lower() == 'bearer':
        db = SessionLocal()
        try:
            data = decode_token(bearer_creds.credentials)
            if data:
                user_id = data.get("sub")
                user = db.query(User).filter(User.id == user_id).first()
                if user and user.is_admin:
                    return True
        except Exception as e:
            print(f"Admin auth error: {e}")
        finally:
            db.close()
            
    raise HTTPException(status_code=401, detail="Admin access required")

# --- ENDPOINTS ---

@router.get("/transactions")
def list_transactions(status: Optional[str] = None, _=Depends(require_admin)):
    db = SessionLocal()
    try:
        query = db.query(Transaction)
        if status:
            query = query.filter(Transaction.status == status)
        
        rows = query.order_by(Transaction.id.desc()).all()
        out = []
        for t in rows:
            # Lấy username của người gửi an toàn
            sender_name = "Unknown"
            if t.sender_id:
                sender = db.query(User).filter(User.id == t.sender_id).first()
                if sender:
                    sender_name = sender.username
                    
            out.append({
                "id": t.id,
                "sender_id": t.sender_id,
                "sender_username": sender_name,
                "receiver": t.receiver,
                "amount": t.amount,
                "status": t.status, # ĐÃ THÊM LẠI TRƯỜNG NÀY
                "created_at": t.created_at.isoformat() if t.created_at else None
            })
        return out
    finally:
        db.close()

@router.post("/transactions/{tx_id}/approve")
def approve_tx(tx_id: int, data: AdminAction, _=Depends(require_admin)):
    """Duyệt hoặc từ chối giao dịch và cập nhật điểm tín nhiệm."""
    db = SessionLocal()
    try:
        tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")

        sender = db.query(User).filter(User.id == tx.sender_id).first()

        if data.action == "approve":
            # Chuyển trạng thái về pending để worker xử lý on-chain
            tx.status = "pending"
            q.enqueue("backend.tasks.process_pending_tx", tx.id)
        else:
            # RULE: Admin Reject -> Trừ 0.75 điểm
            tx.status = "blocked_by_admin"
            if sender:
                sender.trust_score = max(0.0, (sender.trust_score or 0.0) - 0.75)
            
            # Nếu người nhận có trong hệ thống, cũng trừ 0.75 điểm
            receiver_user = db.query(User).filter(User.username == tx.receiver).first()
            if receiver_user:
                receiver_user.trust_score = max(0.0, (receiver_user.trust_score or 0.0) - 0.75)

        db.commit()
        return {"status": "ok", "new_tx_status": tx.status}
    finally:
        db.close()

@router.get("/wallets")
def list_wallets(_=Depends(require_admin)):
    db = SessionLocal()
    try:
        users = db.query(User).all()
        out = []
        for u in users:
            w = db.query(Wallet).filter(Wallet.user_id == u.id).first()
            ts = u.trust_score if u.trust_score is not None else 0.0
            out.append({
                "user_id": u.id,
                "username": u.username,
                "trust_score": round(ts, 2),
                "wallet_address": w.address if w else "N/A",
                "balance": w.balance if w else 0.0,
            })
        return out
    finally:
        db.close()

@router.post("/wallets/{user_id}/credit")
def credit_wallet(user_id: int, payload: CreditPayload, _=Depends(require_admin)):
    """Nạp tiền ảo vào ví DB cho người dùng (Test)."""
    db = SessionLocal()
    try:
        w = db.query(Wallet).filter(Wallet.user_id == user_id).first()
        if not w:
            raise HTTPException(status_code=404, detail="Wallet not found")
        
        if payload.amount <= 0:
            raise HTTPException(status_code=400, detail="Amount must be positive")
            
        w.balance = (w.balance or 0.0) + payload.amount
        db.commit()
        return {"user_id": user_id, "new_balance": w.balance}
    finally:
        db.close()

@router.post("/users/{user_id}/unblock")
def unblock_user(user_id: int, _=Depends(require_admin)):
    """RULE: Admin unblock người dùng Danger -> Đưa điểm về 6.0 (Warning)."""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        user.trust_score = 6.0
        db.commit()
        return {"status": "unblocked", "new_score": 6.0}
    finally:
        db.close()

@router.get("/complaints")
def list_complaints(_=Depends(require_admin)):
    db = SessionLocal()
    try:
        # Lấy các log loại khiếu nại (complaint)
        rows = db.query(SecurityLog).filter(SecurityLog.event_type == 'complaint').all()
        return [
            {
                "id": r.id, 
                "description": r.description, 
                "created_at": r.created_at.isoformat() if r.created_at else None
            } for r in rows
        ]
    finally:
        db.close()