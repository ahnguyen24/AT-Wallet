from sqlalchemy import Column, Integer, String, DateTime, Boolean, Float, ForeignKey, Text
from sqlalchemy.orm import relationship
from .db import Base
import datetime

# add trust_score column to users table for better trust level management
class TrustScoreHistory(Base):
    __tablename__ = "trust_score_history"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    score_before = Column(Float)
    score_after = Column(Float)
    reason = Column(String) # Ví dụ: "Giao dịch thành công", "Giao dịch lỗi"
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    is_admin = Column(Boolean, default=False)
    trust_score = Column(Float, default=8.0)


class Keystore(Base):
    __tablename__ = "keystore"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    enc_private_key = Column(Text, nullable=False)
    pubkey = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User")


class Wallet(Base):
    __tablename__ = "wallets"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    address = Column(String, nullable=False, unique=True)
    balance = Column(Float, default=0.0)

    user = relationship("User")


class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    receiver = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    status = Column(String, default="pending")
    signature = Column(String, nullable=True)
    slot = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User")


class SecurityLog(Base):
    __tablename__ = "security_logs"
    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String)
    description = Column(Text)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
