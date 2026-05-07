import time
import jwt
from fastapi import Depends, HTTPException, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from .config import JWT_SECRET
from .db import SessionLocal
from .models import User

security = HTTPBearer()


def create_token(user_id: int, expires_in: int = 3600) -> str:
    payload = {"sub": str(user_id), "exp": int(time.time()) + expires_in} # Chuyển sub sang string
    token = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
    # Đảm bảo trả về chuỗi str nếu là bytes
    if isinstance(token, bytes):
        return token.decode("utf-8")
    return token

def decode_token(token: str):
    try:
        # Giải mã và chỉ định thuật toán
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="token expired")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="invalid token")

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    data = decode_token(credentials.credentials)
    user_id = data.get("sub")
    db = SessionLocal()
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        db.close()
        raise HTTPException(status_code=401, detail="user not found")
    # detach user from session so callers can safely use attributes and we can close the session
    try:
        db.expunge(user)
    except Exception:
        pass
    db.close()
    return user
