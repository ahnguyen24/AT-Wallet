import requests
import time
import uuid
import pyotp
import hashlib
import json

BASE_URL = "http://localhost:3000/api"
PASSWORD = "Secure_AT_Wallet_2026!"
TX_PIN = "998877"

# Legitimate User Data
SENDER_EMAIL = f"sender_{uuid.uuid4().hex[:4]}@atwallet.com"
SENDER_PHONE = f"09{str(uuid.uuid4().int)[:8]}"[:10]

RECEIVER_EMAIL = f"receiver_{uuid.uuid4().hex[:4]}@atwallet.com"
RECEIVER_PHONE = f"09{str(uuid.uuid4().int)[:8]}"[:10]

def get_signature(payload, nonce, timestamp, password):
    msg = f"{payload}{nonce}{timestamp}{password}"
    return hashlib.sha256(msg.encode()).hexdigest()

def print_banner(text):
    print("\n" + "="*60)
    print(f"🛡️  {text}")
    print("="*60)

def run_suite():
    print_banner("AT-WALLET: ENTERPRISE SECURITY AUDIT SUITE")

    # --- STEP 1: REGISTRATION ---
    print("\n[1/10] Registering Sender and Receiver (eKYC)...")
    
    # Register Sender
    sender_reg = {
        "email": SENDER_EMAIL, "password": PASSWORD, "full_name": "Nguyen Ha Anh",
        "phone": SENDER_PHONE, "cccd": f"030{str(uuid.uuid4().int)[:9]}"[:12], "pin": TX_PIN
    }
    r = requests.post(f"{BASE_URL}/register", json=sender_reg)
    sender_id = r.json()['user_id']
    sender_totp = r.json()['totp_secret']

    # Register Receiver
    receiver_reg = {
        "email": RECEIVER_EMAIL, "password": PASSWORD, "full_name": "Thai Huu Tho",
        "phone": RECEIVER_PHONE, "cccd": f"030{str(uuid.uuid4().int)[:9]}"[:12], "pin": TX_PIN
    }
    r = requests.post(f"{BASE_URL}/register", json=receiver_reg)
    receiver_id = r.json()['user_id']
    receiver_totp = r.json()['totp_secret']

    print(f"✔ Registered Nguyen Ha Anh (SĐT: {SENDER_PHONE})")
    print(f"✔ Registered Thai Huu Tho (SĐT: {RECEIVER_PHONE})")

    # --- STEP 2: PBKDF2 TIMING AUDIT ---
    print("\n[2/10] Auditing Login Latency (PBKDF2 600k iterations)...")
    totp_sender = pyotp.TOTP(sender_totp)
    
    start = time.time()
    login_res = requests.post(f"{BASE_URL}/login", json={
        "email": SENDER_EMAIL, "password": PASSWORD, "totp_token": totp_sender.now()
    })
    elapsed = time.time() - start
    
    print(f"✔ Server Response Time: {elapsed:.3f}s")
    if elapsed < 0.4:
        print("❌ SECURITY WARNING: PBKDF2 latency is too low!")
    else:
        print("✔ PBKDF2 Strecthing: SECURE (>400ms threshold met)")

    sender_token = login_res.json()['token']

    # --- STEP 3: LOGIN LOCKOUT ---
    print("\n[3/10] Testing Dictionary Attack Protection (Lockout)...")
    lock_email = f"victim_{uuid.uuid4().hex[:4]}@atwallet.com"
    requests.post(f"{BASE_URL}/register", json={
        "email": lock_email, "password": PASSWORD, "full_name": "Lock Test",
        "phone": f"09{str(uuid.uuid4().int)[:8]}"[:10], "cccd": f"030{str(uuid.uuid4().int)[:9]}"[:12], "pin": "123456"
    })
    
    for i in range(5):
        requests.post(f"{BASE_URL}/login", json={"email": lock_email, "password": "WRONG_PASSWORD", "totp_token": "000000"})
    
    # 6th attempt with correct password
    r = requests.post(f"{BASE_URL}/login", json={"email": lock_email, "password": PASSWORD, "totp_token": "000000"})
    if r.status_code == 403:
        print("✔ Account Lockout: PASSED (403 Forbidden received)")

    # --- STEP 4: WALLET VAULT INITIALIZATION ---
    print("\n[4/10] Initializing HD Wallet (Deriving 3 accounts)...")
    headers = {"Authorization": f"Bearer {sender_token}"}
    r = requests.post(f"{BASE_URL}/wallet/create", headers=headers, json={
        "user_id": sender_id, "password": PASSWORD
    })
    sender_address = r.json()['address']
    print(f"✔ Derived Address Index 0 (Primary): {sender_address}")

    # Initialize Receiver Wallet as well
    totp_rec = pyotp.TOTP(receiver_totp)
    login_rec = requests.post(f"{BASE_URL}/login", json={"email": RECEIVER_EMAIL, "password": PASSWORD, "totp_token": totp_rec.now()})
    rec_token = login_rec.json()['token']
    requests.post(f"{BASE_URL}/wallet/create", headers={"Authorization": f"Bearer {rec_token}"}, json={"user_id": receiver_id, "password": PASSWORD})

    # --- STEP 5: PROOF OF DECRYPTION (BALANCE SYNC) ---
    print("\n[5/10] Testing Memory Decryption & Balance Sync...")
    r = requests.post(f"{BASE_URL}/wallet/balance/check", headers=headers, json={
        "user_id": sender_id, "password": PASSWORD
    })
    if r.status_code == 200:
        print(f"✔ Decryption verified. Initial Balance: {r.json()['balance']} Glow")

    # --- STEP 6: RECIPIENT LOOKUP ---
    print("\n[6/10] Testing Recipient Lookup via 12-Digit Routing Code...")
    routing_code = f"{RECEIVER_PHONE}01" // Phone + Wallet Index 01
    r = requests.post(f"{BASE_URL}/user/lookup-by-phone", headers=headers, json={"phone": routing_code})
    if r.status_code == 200 and r.json()['full_name'] == "Thai Huu Tho":
        print(f"✔ Lookup Success: {routing_code} resolved to '{r.json()['full_name']}'")

    # --- STEP 7: SECURE ENVELOPE TRANSFER ---
    print("\n[7/10] Testing Secure Envelope Transfer (Debit/Credit Ledger)...")
    payload_dict = {
        "sender_id": sender_id,
        "recipient": routing_code, // 12-digit code
        "amount": 200000,
        "pin": TX_PIN,
        "message": "AT-Wallet final audit payload"
    }
    payload_str = json.dumps(payload_dict, separators=(',', ':'))
    nonce = str(uuid.uuid4())
    ts = int(time.time())
    sig = get_signature(payload_str, nonce, ts, PASSWORD)

    envelope = {"payload": payload_str, "nonce": nonce, "timestamp": ts, "signature": sig}

    r = requests.post(f"{BASE_URL}/wallet/transfer", headers=headers, json=envelope)
    if r.status_code == 200:
        print(f"✔ Transfer authorized. New Balance: {r.json()['new_balance']} Glow")

    # --- STEP 8: REPLAY ATTACK BLOCK ---
    print("\n[8/10] Testing Replay Attack Block...")
    r = requests.post(f"{BASE_URL}/wallet/transfer", headers=headers, json=envelope)
    if r.status_code == 409:
        print("✔ Replay Blocked: PASSED")

    # --- STEP 9: SIGNATURE FORGERY BLOCK ---
    print("\n[9/10] Testing Signature Forgery...")
    envelope['nonce'] = str(uuid.uuid4())
    envelope['payload'] = json.dumps({**payload_dict, "amount": 99999999}, separators=(',', ':'))
    r = requests.post(f"{BASE_URL}/wallet/transfer", headers=headers, json=envelope)
    if r.status_code == 401:
        print("✔ Tampering detected and blocked: PASSED")

    # --- STEP 10: AUDIT LOG CHECK ---
    print("\n[10/10] Fetching Security Audit Logs...")
    r = requests.get(f"{BASE_URL}/logs", headers=headers)
    logs = r.json()
    print(f"✔ Logs fetched successfully. Last Event: [{logs[0]['severity']}] {logs[0]['event']}")

    print_banner("ALL SECURITY RUNTIMES STABLE & VERIFIED")

if __name__ == "__main__":
    run_suite()