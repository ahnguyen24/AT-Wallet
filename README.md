# 🛡️ AT-Wallet: High-Integrity Financial Vault

An advanced, decentralized blockchain wallet designed to bridge the simplicity of traditional mobile payment architectures (like PayPal / Viettel Money) with the cryptographic integrity of public ledgers.

Developed natively in **Rust** (Backend) and **Vanilla JavaScript** (Frontend) to deliver a zero-dependency, ultra-secure financial container.

---

## 👥 Authors & Credits
*   **Nguyen Ha Anh** (Student ID: `22127013`) — Lead Security & Cryptographic Architect
*   **Thai Huu Tho** (Student ID: `22127400`) — Lead Systems & Frontend Engineer

---

## 🏗️ Architectural Core

AT-Wallet does not store sensitive keys, seeds, or plain passwords on disk or permanently in memory. It operates on a **Stateless Security Model**:

```text
[User Password] ---> PBKDF2 (600k) ---> Master Key (RAM Only)
                                              |
[SQLite Vault]  ---> AES-256-GCM ----> Decrypted Seed ---> Shimmer Address
```

### Key Cryptographic Features:
*   **PBKDF2-HMAC-SHA512 (600,000 Iterations):** Hardens the login password against GPU-accelerated brute-force attacks.
*   **AES-256-GCM:** Authenticated symmetric encryption used to encrypt the 24-word seed. Integrity is automatically verified on decryption.
*   **Argon2id Hashing:** Used to secure both the Login Password and the 6-Digit transaction PIN.
*   **JWT Stateless Sessions:** Sessions are managed using HS256 JWTs, reducing database load and securing protected endpoints.
*   **Secure Envelope Routing:** Transactions are signed client-side using a SHA-256 hash of `payload + nonce + timestamp + password` (proves possession of key without sending it).
*   **Fail-Secure Audit Trail:** Automatic recording of Replay attacks, Lockouts, and Tampering events.
*   **Memory Hardening (Zeroize):** Explicitly overwrites RAM memory holding decrypted seed phrases with `0x00` immediately after use.

---

## 📡 Decentralized Multi-Wallet & 12-Digit Routing

AT-Wallet implements the **BIP-44 Standard** for Hierarchical Deterministic (HD) wallets. It derives **3 separate wallets** (Primary, Savings, and Business) from a single 24-word seed:
*   **Wallet Index 0 (Primary):** `m/44'/4218'/0'/0/0`
*   **Wallet Index 1 (Savings):** `m/44'/4218'/0'/0/1`
*   **Wallet Index 2 (Business):** `m/44'/4218'/0'/0/2`

### 12-Digit Routing Code:
Users can transfer funds using a simplified, human-readable 12-digit code:
$$\text{Phone Number (10 digits)} + \text{Wallet Index (2 digits, e.g., "01")}$$

Example: `091234567801` targets the **Savings Wallet** of the user registered with the phone `0912345678`.

---

## 🚀 How to Run (WSL Ubuntu)

### 1. Install System Prerequisites
```bash
sudo apt update
sudo apt install -y build-essential pkg-config libssl-dev sqlite3 uuid-runtime
```

### 2. Configure Environment
```bash
# Create empty database
touch wallet.db

# Create .env file with secrets
cat <<EOF > .env
DATABASE_URL="sqlite://wallet.db?mode=rwc"
JWT_SECRET="9f8b47e2a1c0d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8"
EOF
```

### 3. Start the Server
```bash
cargo run
```
Access the UI at `http://localhost:3000`.

### 4. Run the Automated Audit
In a second terminal:
```bash
python3 -m venv venv
source venv/bin/activate
pip install requests pyotp
python3 test.py
```