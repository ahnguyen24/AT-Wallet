import time
from rq import Queue
from redis import Redis
from .db import SessionLocal
from .models import Transaction as TxModel, Keystore, Wallet, User
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
        # On success, persist DB updates and mark success atomically
        try:
            r_w = db.query(Wallet).filter(Wallet.address == tx.receiver).first()
            if r_w:
                r_w.balance = (r_w.balance or 0.0) + tx.amount
            # increase trust score for successful transaction
            sender_u = db.query(User).filter(User.id == tx.sender_id).first()
            if sender_u:
                sender_u.trust_score = (sender_u.trust_score or 0.0) + 0.25
            if r_w:
                recv_u = db.query(User).filter(User.id == r_w.user_id).first()
                if recv_u:
                    recv_u.trust_score = (recv_u.trust_score or 0.0) + 0.25
            tx.status = "success"
            print(f"[tasks] tx {tx.id} success on-chain sig={tx.signature}; DB credited and trust updated")
            db.commit()
            db.close()
            return
        except Exception as inner_e:
            # if DB update fails here, treat as error and continue to outer exception handler
            print(f"[tasks] failed updating DB after send for tx {tx.id}: {inner_e}")
            raise inner_e
    except Exception as e:
        try:
            tx.status = f"error: {str(e)}"
        except Exception:
            pass
        # refund sender DB wallet since processing failed
        try:
            s_w = db.query(Wallet).filter(Wallet.user_id == tx.sender_id).first()
            if s_w:
                s_w.balance = (s_w.balance or 0.0) + tx.amount
            # decrease trust scores for failed transaction
            try:
                sender_u = db.query(User).filter(User.id == tx.sender_id).first()
                if sender_u:
                    sender_u.trust_score = (sender_u.trust_score or 0.0) - 0.75
                if tx.receiver:
                    r_user = db.query(User).filter(User.username == tx.receiver).first()
                    if not r_user:
                        rw = db.query(Wallet).filter(Wallet.address == tx.receiver).first()
                        if rw:
                            r_user = db.query(User).filter(User.id == rw.user_id).first()
                    if r_user:
                        r_user.trust_score = (r_user.trust_score or 0.0) - 0.75
            except Exception:
                pass
        except Exception:
            pass
        try:
            db.commit()
        except Exception as ce:
            print(f"[tasks] commit failed in error handler for tx {tx_id}: {ce}")
        finally:
            db.close()
        return
    # Should not reach here
    try:
        db.close()
    except Exception:
        pass