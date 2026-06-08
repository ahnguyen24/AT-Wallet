let session = { userId: null, password: null, token: null, address: null, totpSecret: null, lastActivity: Date.now(), currentBalance: 0 };
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * 1. FIXED UI Navigation (Added Null Checks)
 */
function showAuth(type) {
    document.getElementById('register-section').classList.toggle('hidden', type !== 'register');
    document.getElementById('login-section').classList.toggle('hidden', type !== 'login');
    
    const loginBtn = document.getElementById('btn-nav-login');
    const regBtn = document.getElementById('btn-nav-reg');
    
    if(loginBtn) loginBtn.style.background = (type === 'login') ? '#3b82f6' : '#334155';
    if(regBtn) regBtn.style.background = (type === 'register') ? '#3b82f6' : '#334155';
}

async function api(path, method, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (session.token) headers['Authorization'] = `Bearer ${session.token}`;
    try {
        const res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : null });
        const contentType = res.headers.get("content-type");
        const data = (contentType && contentType.includes("application/json")) ? await res.json() : { error: "Non-JSON response" };
        return { status: res.status, data };
    } catch (e) { return { status: 500, data: { error: "Network disconnected" } }; }
}

async function register() {
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const { status, data } = await api('/register', 'POST', { email, password });
    if (status === 201) {
        const cleanSecret = data.totp_secret.toUpperCase().replace(/=+$/, "");
        session.totpSecret = cleanSecret; 
        document.getElementById('reg-status').classList.remove('hidden');
        document.getElementById('manual-secret').innerText = cleanSecret;
        const otpUrl = `otpauth://totp/IOTA:${email.split('@')[0]}?secret=${cleanSecret}&issuer=IOTA`;
        document.getElementById('qrcode').innerHTML = "";
        new QRCode(document.getElementById("qrcode"), { text: otpUrl, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.L });
    }
}

function generateTestToken() {
    if (!session.totpSecret) return;
    let totp = new OTPAuth.TOTP({ issuer: "IOTA", secret: OTPAuth.Secret.fromBase32(session.totpSecret) });
    const token = totp.generate();
    document.getElementById('test-token-display').innerText = token;
    document.getElementById('login-totp').value = token;
}

async function login() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const totp = document.getElementById('login-totp').value;
    const statusEl = document.getElementById('login-status');
    statusEl.innerText = "Logging in, please wait...";

    const { status, data } = await api('/login', 'POST', { email, password, totp_token: totp });
    if (status === 200) {
        session.token = data.token;
        session.userId = data.user_id;
        session.password = password;
        startSessionTimer();

        document.getElementById('nav-auth').classList.add('hidden');
        document.getElementById('login-section').classList.add('hidden');
        document.getElementById('register-section').classList.add('hidden');
        document.getElementById('dashboard-section').classList.remove('hidden');
        document.getElementById('display-userid').innerText = data.user_id;

        // --- NEW: Restore Wallet automatically if it exists ---
        if (data.address && data.address !== "") {
            session.address = data.address;
            document.getElementById('display-address').innerText = data.address;
            document.getElementById('transfer-section').classList.remove('hidden');
            document.getElementById('btn-create').innerText = "Wallet Active";
            document.getElementById('btn-create').disabled = true;
            checkBalance(); // Fetch existing balance
        }
    } else {
        statusEl.innerText = (status === 403) ? "Account Blocked!" : "Wrong Credentials!";
    }
}

async function createWallet() {
    const { status, data } = await api('/wallet/create', 'POST', { user_id: session.userId, password: session.password });
    if (status === 200) {
        session.address = data.address;
        document.getElementById('display-address').innerText = data.address;
        document.getElementById('transfer-section').classList.remove('hidden');
    }
}

async function checkBalance() {
    if (!session.address) return;
    const { status, data } = await api(`/wallet/balance/${session.address}`, 'POST', { user_id: session.userId, password: session.password });
    if (status === 200) {
        session.currentBalance = data.balance;
        document.getElementById('display-balance').innerText = session.currentBalance;
    }
}

/**
 * 2. SECURE TRANSFER (Simulated Balance Update for UX)
 */
async function sendTransfer() {
    const recipient = document.getElementById('tx-recipient').value;
    const amount = parseInt(document.getElementById('tx-amount').value);
    const statusEl = document.getElementById('tx-status');
    if (!recipient || isNaN(amount)) return alert("Invalid inputs");

    const payload = JSON.stringify({ recipient, amount });
    const nonce = crypto.randomUUID();
    const timestamp = Math.floor(Date.now() / 1000);
    const msg = new TextEncoder().encode(payload + nonce + timestamp + session.password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msg);
    const signature = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const envelope = { payload, nonce, timestamp, signature };
    const { status, data } = await api('/wallet/transfer', 'POST', envelope);

    if (status === 200) {
        // Update balance from the backend response
        session.currentBalance = data.new_balance;
        document.getElementById('display-balance').innerText = session.currentBalance;
        
        statusEl.style.color = "#4ade80";
        statusEl.innerText = `Success! Block ID: ${data.block_id.substring(0,20)}...`;
    } else {
        statusEl.style.color = "#f87171";
        statusEl.innerText = "Error: " + (data.error || "Failed");
    }
}

async function viewLogs() {
    const { status, data } = await api('/logs', 'GET');
    if (status === 200) {
        document.getElementById('log-display').innerHTML = data.map(l => `<div>[${l.severity}] ${l.event}: ${l.details}</div>`).join('');
    }
}

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

function logout() { session = {}; window.location.reload(); }
window.addEventListener('mousedown', () => session.lastActivity = Date.now());
window.addEventListener('keypress', () => session.lastActivity = Date.now());