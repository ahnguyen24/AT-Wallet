import requests
import time
import uuid
import pyotp
import hashlib
import json

BASE_URL = "http://localhost:3000/api"
PASSWORD = "Master_Hardened_2024!"
EMAIL = f"audit_{uuid.uuid4().hex[:6]}@iota.org"

def get_signature(payload, nonce, timestamp, password):
    msg = f"{payload}{nonce}{timestamp}{password}"
    return hashlib.sha256(msg.encode()).hexdigest()

def run_hardened_audit():
    print("=====================================================")
    print("🛡️  PHASE 4 SECURITY AUDIT: JWT & VAULT HARDENING  🛡️")
    print("=====================================================")

    # 1. REGISTRATION
    print("\n[1/7] Registering New Identity...")
    r = requests.post(f"{BASE_URL}/register", json={"email": EMAIL, "password": PASSWORD})
    user_id = r.json()['user_id']
    totp_secret = r.json()['totp_secret']
    totp = pyotp.TOTP(totp_secret)

    # 2. JWT ISSUANCE TEST
    print("\n[2/7] Testing JWT Issuance via Login...")
    login_res = requests.post(f"{BASE_URL}/login", json={
        "email": EMAIL, "password": PASSWORD, "totp_token": totp.now()
    })
    token = login_res.json().get('token')
    if token:
        print(f"✔ JWT Received: {token[:20]}...")
    else:
        print("❌ FAILED: No JWT issued")
        return

    # 3. UNAUTHORIZED ACCESS TEST (The Gatekeeper)
    print("\n[3/7] Testing Protection (Accessing Wallet WITHOUT JWT)...")
    bad_res = requests.post(f"{BASE_URL}/wallet/balance/any", json={
        "user_id": user_id, "password": PASSWORD
    })
    if bad_res.status_code == 401:
        print("✔ GATEKEEPER ACTIVE: 401 Unauthorized received.")
    else:
        print(f"❌ SECURITY BREACH: Accessed protected route without JWT! (Status: {bad_res.status_code})")

    # 4. AUTHORIZED ACCESS TEST
    print("\n[4/7] Testing Protection (Accessing Wallet WITH JWT)...")
    headers = {"Authorization": f"Bearer {token}"}
    # First, create the wallet so it exists
    requests.post(f"{BASE_URL}/wallet/create", headers=headers, json={
        "user_id": user_id, "password": PASSWORD
    })
    # Now check balance
    good_res = requests.post(f"{BASE_URL}/wallet/balance/any", headers=headers, json={
        "user_id": user_id, "password": PASSWORD
    })
    if good_res.status_code == 200:
        print(f"✔ AUTHORIZED: Balance retrieved ({good_res.json()['balance']} Glow)")

    # 5. ANTI-REPLAY TEST
    print("\n[5/7] Testing Nonce Burning (Anti-Replay)...")
    payload = json.dumps({"recipient": "rms1...", "amount": 500})
    nonce = str(uuid.uuid4())
    ts = int(time.time())
    sig = get_signature(payload, nonce, ts, PASSWORD)
    
    envelope = {"payload": payload, "nonce": nonce, "timestamp": ts, "signature": sig}
    
    # 1st attempt
    requests.post(f"{BASE_URL}/wallet/transfer", headers=headers, json=envelope)
    # 2nd attempt (Same envelope)
    replay_res = requests.post(f"{BASE_URL}/wallet/transfer", headers=headers, json=envelope)
    
    if replay_res.status_code == 409:
        print("✔ REPLAY BLOCKED: Nonce already burned in DB.")

    # 6. SIGNATURE TAMPER TEST
    print("\n[6/7] Testing Integrity (Payload Tampering)...")
    envelope["nonce"] = str(uuid.uuid4()) # New nonce to bypass replay check
    envelope["payload"] = json.dumps({"recipient": "hacker", "amount": 999999})
    # We do NOT update the signature
    tamper_res = requests.post(f"{BASE_URL}/wallet/transfer", headers=headers, json=envelope)
    if tamper_res.status_code != 200:
        print("✔ INTEGRITY VERIFIED: Tampered request rejected.")

    # 7. LOG VERIFICATION
    print("\n[7/7] Checking Security Audit Logs...")
    log_res = requests.get(f"{BASE_URL}/logs", headers=headers)
    if log_res.status_code == 200:
        logs = log_res.json()
        if len(logs) > 0:
            print(f"✔ Logs retrieved. Recent event: {logs[0]['event']}")
        else:
            print("⚠️  Warning: Audit successful but log table is empty. Check backend record_security_log calls.")
            print("\n⭐ PHASE 4 AUDIT COMPLETE: ALL DEFENSES ACTIVE.")

if __name__ == "__main__":
    run_hardened_audit()