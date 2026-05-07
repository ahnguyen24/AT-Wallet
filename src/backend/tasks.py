import time
from rq import Queue
from redis import Redis
from .db import SessionLocal
from .models import Transaction as TxModel, Keystore, Wallet, User
from .config import REDIS_URL

redis_conn = Redis.from_url(REDIS_URL)
q = Queue(connection=redis_conn)

def process_pending_tx(tx_id: int):
    """Xử lý giao dịch ở chế độ Demo (Cập nhật DB ngay lập tức)."""
    db = SessionLocal()
    tx = db.query(TxModel).filter(TxModel.id == tx_id).first()
    if not tx or tx.status != "pending":
        if db: db.close()
        return

    try:
        # Tìm ví người nhận
        r_w = db.query(Wallet).filter(Wallet.address == tx.receiver).first()
        if r_w:
            # Cộng tiền cho người nhận trong DB
            r_w.balance = (r_w.balance or 0.0) + tx.amount
            print(f"[tasks] credited {tx.amount} to receiver {tx.receiver}")
        
        # Đánh dấu thành công
        tx.status = "success"
        tx.signature = "demo_mode_success"
        db.commit()
        print(f"[tasks] tx {tx.id} success (DEMO MODE)")
    except Exception as e:
        print(f"[tasks] error processing tx {tx_id}: {e}")
        # Hoàn tiền cho người gửi nếu có lỗi
        s_w = db.query(Wallet).filter(Wallet.user_id == tx.sender_id).first()
        if s_w:
            s_w.balance = (s_w.balance or 0.0) + tx.amount
        tx.status = f"error: {str(e)}"
        db.commit()
    finally:
        db.close()