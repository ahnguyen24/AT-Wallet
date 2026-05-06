import requests
import time

BASE = "http://127.0.0.1:8000/api"

def demo_workflow():
    # 1. Đăng ký tài khoản mới[cite: 12]
    username = f"user_{int(time.time())}" # Tránh trùng lặp username
    password = "password123"
    
    print(f"[*] Đang đăng ký user: {username}...")
    reg_res = requests.post(f"{BASE}/register", json={"username": username, "password": password})
    
    if reg_res.status_code != 200:
        print("[-] Đăng ký thất bại:", reg_res.text)
        return
    
    user_data = reg_res.json()
    address = user_data.get("address")
    print(f"[+] Đăng ký thành công. Ví: {address}")

    # 2. Đăng nhập để lấy Access Token[cite: 1, 2]
    print("[*] Đang đăng nhập...")
    login_res = requests.post(f"{BASE}/login", json={"username": username, "password": password})
    login_data = login_res.json()
    token = login_data.get("access_token")
    if not token:
        print("[-] Lỗi: Không nhận được token từ server")
    return
    # 3. Tạo Header chứa Token
    headers = {"Authorization": f"Bearer {token}"}

    # 4. Thực hiện chuyển tiền với Header xác thực[cite: 1, 12]
    print(f"[*] Đang thực hiện chuyển tiền đến {address}...")
    transfer_payload = {
        "receiver": address, # Gửi cho chính mình để test
        "amount": 0.001
    }
    
    # Gửi kèm headers chứa JWT
    trans_res = requests.post(f"{BASE}/transfer", json=transfer_payload, headers=headers)
    
    print(f"[+] Kết quả: {trans_res.status_code}")
    print(f"[+] Nội dung: {trans_res.text}")

if __name__ == "__main__":
    demo_workflow()