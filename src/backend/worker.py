"""Programmatic RQ worker entrypoint."""
from redis import Redis
from rq import Worker, Queue, push_connection, pop_connection
from .config import REDIS_URL

# Cấu hình danh sách các hàng đợi cần lắng nghe
listen = ["default"]

# Khởi tạo kết nối tới Redis Server dựa trên config
redis_conn = Redis.from_url(REDIS_URL)

def run_worker():
    # Đẩy kết nối vào ngăn xếp kết nối của RQ
    push_connection(redis_conn)
    try:
        # Khởi tạo worker và danh sách hàng đợi
        queues = [Queue(name, connection=redis_conn) for name in listen]
        worker = Worker(queues)
        
        print(f"[*] Worker đang khởi chạy và lắng nghe trên: {listen}")
        worker.work()
    finally:
        # Đảm bảo đóng kết nối khi worker dừng[cite: 11]
        pop_connection()

if __name__ == "__main__":
    run_worker()