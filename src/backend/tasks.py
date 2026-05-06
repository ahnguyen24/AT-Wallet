import time
from rq import Queue
from redis import Redis
from .db import SessionLocal
from .models import Transaction as TxModel, Keystore
from .config import REDIS_URL
from .solana_client import client, build_transfer_tx, send_signed_transaction, get_balance #[cite: 9, 10]
from .keyring import decrypt_private_key
from solders.keypair import Keypair # Thay đổi từ solana.keypair

redis_conn = Redis.from_url(REDIS_URL)
q = Queue(connection=redis_conn)

def process_pending_tx(tx_id: int):
    db = SessionLocal()
    tx = db.query(TxModel).filter(TxModel.id == tx_id).first() #[cite: 10]
    if not tx or tx.status != "pending":
        return

    try:
        # Tải keystore và giải mã khóa bí mật[cite: 6, 10]
        ks = db.query(Keystore).filter(Keystore.user_id == tx.sender_id).first()
        if not ks:
            tx.status = "failed_no_keystore"
            db.commit()
            return

        # Kiểm tra số dư thực tế trên chuỗi (On-chain)[cite: 9]
        balance_lamports = get_balance(ks.pubkey)
        required_lamports = int(tx.amount * 1_000_000_000)

        if balance_lamports < required_lamports:
            tx.status = "failed_insufficient_funds"
            db.commit()
            return

        # Ký và gửi giao dịch[cite: 10]
        priv = decrypt_private_key(ks.enc_private_key)
        kp = Keypair.from_bytes(list(priv))        
        tx_obj = build_transfer_tx(kp.public_key, tx.receiver, required_lamports) #[cite: 9]
        tx_obj.sign(kp)
        
        raw = tx_obj.serialize()
        res = send_signed_transaction(raw) #[cite: 9]
        
        tx.signature = str(res)
        tx.status = "submitted"
    except Exception as e:
        tx.status = f"error: {str(e)}"
    finally:
        db.commit() #[cite: 10]