/**
 * PHASE 2 FINAL - Security & Session Management
 */

// 1. Session state - Password held ONLY in volatile RAM
let session = {
    userId: null,
    password: null,
    address: null,
    totpSecret: null,
    lastActivity: Date.now()
};

const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 Minutes

// 2. Navigation & View Toggles
function showAuth(type) {
    document.getElementById('register-section').classList.toggle('hidden', type !== 'register');
    document.getElementById('login-section').classList.toggle('hidden', type !== 'login');
}

// 3. Robust API Helper
async function api(path, method, body) {
    try {
        const res = await fetch(`/api${path}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : null
        });
        const contentType = res.headers.get("content-type");
        const data = (contentType && contentType.includes("application/json")) 
            ? await res.json() 
            : { error: await res.text() };
        return { status: res.status, data };
    } catch (e) {
        return { status: 500, data: { error: "Connection Failed" } };
    }
}

// 4. REGISTRATION
async function register() {
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;

    const { status, data } = await api('/register', 'POST', { email, password });

    if (status === 201) {
        session.totpSecret = data.totp_secret.toUpperCase().replace(/=+$/, "");
        document.getElementById('reg-status').classList.remove('hidden');
        document.getElementById('manual-secret').innerText = session.totpSecret;

        // QR Code Gen
        const otpUrl = `otpauth://totp/IOTA-Vault:${encodeURIComponent(email)}?secret=${session.totpSecret}&issuer=IOTA-Vault`;
        document.getElementById('qrcode').innerHTML = "";
        new QRCode(document.getElementById("qrcode"), { text: otpUrl, width: 150, height: 150 });
    } else {
        alert("Registration Failed: " + data.error);
    }
}

// 5. TEST TOKEN (Standard 2FA Logic)
function generateTestToken() {
    if (!session.totpSecret) return;
    let totp = new OTPAuth.TOTP({
        issuer: "IOTA-Vault",
        label: "User",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(session.totpSecret),
    });
    const token = totp.generate();
    document.getElementById('test-token-display').innerText = token;
    document.getElementById('login-totp').value = token;
}

// 6. LOGIN
async function login() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const totp = document.getElementById('login-totp').value;
    const statusEl = document.getElementById('login-status');

    statusEl.style.color = "#94a3b8";
    statusEl.innerText = "Logging in, please wait...";

    const { status, data } = await api('/login', 'POST', { email, password, totp_token: totp });

    if (status === 200) {
        session.userId = data.user_id;
        session.password = password;
        startSessionTimer();

        document.getElementById('nav-auth').classList.add('hidden');
        document.getElementById('login-section').classList.add('hidden');
        document.getElementById('dashboard-section').classList.remove('hidden');
        document.getElementById('audit-section').classList.remove('hidden');
        document.getElementById('display-userid').innerText = data.user_id;
    } else {
        statusEl.style.color = "#f87171";
        statusEl.innerText = (status === 403) 
            ? "This account was blocked, please contact customer service!" 
            : "Wrong email, password, or 2FA code!";
    }
}

// 7. WALLET INITIALIZATION
async function createWallet() {
    const { status, data } = await api('/wallet/create', 'POST', { 
        user_id: session.userId, password: session.password 
    });
    if (status === 200) {
        session.address = data.address;
        document.getElementById('display-address').innerText = data.address;
        document.getElementById('transfer-section').classList.remove('hidden');
    }
}

// 8. SECURE ENVELOPE & SIGNING (Anti-Forgery Objective)
async function sendTransfer() {
    const recipient = document.getElementById('tx-recipient').value;
    const amount = parseInt(document.getElementById('tx-amount').value);
    
    // WebCrypto SHA-256 Signing
    const payload = JSON.stringify({ recipient, amount });
    const nonce = crypto.randomUUID();
    const timestamp = Math.floor(Date.now() / 1000);
    
    // Sign payload + nonce + timestamp with session password to prove knowledge
    const msg = new TextEncoder().encode(payload + nonce + timestamp + session.password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msg);
    const signature = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const envelope = { payload, nonce, timestamp, signature };
    const { status, data } = await api('/wallet/transfer', 'POST', envelope);

    const statusEl = document.getElementById('tx-status');
    statusEl.innerText = (status === 200) ? `Success! Block: ${data.block_id}` : `Error: ${data.error}`;
}

// 9. SECURITY LOG AUDIT
async function viewLogs() {
    const { status, data } = await api('/logs', 'GET');
    const container = document.getElementById('log-display');
    if (status === 200) {
        container.innerHTML = data.map(l => `
            <div style="border-bottom: 1px solid #334155; padding: 4px 0;">
                <span style="color:${l.severity === 'CRITICAL' ? '#ef4444' : '#fbbf24'}">[${l.severity}]</span> 
                <b>${l.event}</b>: ${l.details} <i style="float:right">${l.time.split('T')[1].split('.')[0]}</i>
            </div>
        `).join('');
    }
}

async function checkBalance() {
    if (!session.address) return;
    // Requirement: Must send user_id and password to decrypt seed for live sync
    const { status, data } = await api(`/wallet/balance/${session.address}`, 'POST', {
        user_id: session.userId,
        password: session.password
    });
    if (status === 200) {
        document.getElementById('display-balance').innerText = data.balance;
    } else {
        alert("Balance sync failed. Check password.");
    }
}

// 10. SESSION MANAGEMENT (Auto-Lock)
function startSessionTimer() {
    document.getElementById('session-timer').classList.remove('hidden');
    setInterval(() => {
        const remaining = SESSION_TIMEOUT_MS - (Date.now() - session.lastActivity);
        if (remaining <= 0) logout();
        
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        document.getElementById('timer-count').innerText = `${mins}:${secs.toString().padStart(2, '0')}`;
    }, 1000);
}

function logout() {
    // SECURITY: Wipe RAM
    session = { userId: null, password: null, address: null, totpSecret: null };
    window.location.reload(); 
}

// Activity Tracker
window.addEventListener('mousedown', () => session.lastActivity = Date.now());
window.addEventListener('keypress', () => session.lastActivity = Date.now());