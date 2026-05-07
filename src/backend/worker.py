# src/backend/worker.py

from redis import Redis
from rq import Worker, Queue
from .config import REDIS_URL
import sys

listen = ["default"]
redis_conn = Redis.from_url(REDIS_URL)

def run_worker():
    # Trên Windows, chúng ta phải sử dụng SimpleWorker vì không có os.fork()
    queues = [Queue(name, connection=redis_conn) for name in listen]
    
    # Kiểm tra nếu là Windows thì dùng SimpleWorker
    if sys.platform == "win32":
        from rq.worker import SimpleWorker
        worker = SimpleWorker(queues, connection=redis_conn)
        print("[*] Đang chạy SimpleWorker trên Windows (No fork mode)...")
    else:
        worker = Worker(queues, connection=redis_conn)
        print(f"[*] Worker đang chạy trên {sys.platform}...")

    worker.work()

if __name__ == "__main__":
    run_worker()