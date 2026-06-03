/**
 * AT-WALLET SECURITY RE-ENGINEERED SCRIPT (PHASE 4 FINAL)
 */

const BASE_URL = "/api";
let currentUser = null; // Holds: username, user_id, password (RAM), token (JWT)
let balancePollId = null;
let trustChart = null;
let currentUserAddress = null;
let totpSecret = null; // Held temporarily during registration

// --- UTILS ---
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.innerText = message;
    toast.className = `fixed bottom-10 left-1/2 -translate-x-1/2 px-8 py-4 rounded-2xl shadow-2xl font-bold text-white transition-all z-50 ${type === 'success' ? 'bg-emerald-500' : 'bg-rose-500'}`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 4000);
}

// --- SECURE API FETCH WRAPPER ---
// Automatically injects the JWT Session Token into the headers
async function secureApiFetch(endpoint, method, bodyObject) {
    const headers = { "Content-Type": "application/json" };
    
    // Inject the JWT token if the user is authenticated
    if (currentUser && currentUser.token) {
        headers["Authorization"] = `Bearer ${currentUser.token}`;
    }

    try {
        const res = await fetch(`${BASE_URL}${endpoint}`, {
            method: method,
            headers: headers,
            body: bodyObject ? JSON.stringify(bodyObject) : null
        });

        const contentType = res.headers.get("content-type");
        let parsedData;
        if (contentType && contentType.includes("application/json")) {
            parsedData = await res.json();
        } else {
            parsedData = { error: await res.text() };
        }

        return { ok: res.ok, status: res.status, data: parsedData };
    } catch (e) {
        console.error("API Connection Failure:", e);
        return { ok: false, status: 500, data: { error: "Không thể kết nối đến máy chủ" } };
    }
}

// --- TRUST CHART ---
async function updateTrustChart() {
    const chartEl = document.getElementById('trustChart');
    if (!chartEl) return;
    const ctx = chartEl.getContext('2d');
    if (trustChart) return;

    trustChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['10:00', '10:05', '10:10', '10:15', '10:20'],
            datasets: [{
                label: 'Trust Score',
                data: [9.5, 9.6, 9.6, 9.8, 10.0],
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointRadius: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { min: 0, max: 10 },
                x: { display: false }
            }
        }
    });
}

// --- AUTHENTICATION ---
async function handleAuth(type) {
    let username = '';
    let password = '';
    let full_name = '';
    let phone = '';
    let cccd = '';
    let pin = '';
    let totp = '';

    if (type === 'login') {
        const usernameEl = document.getElementById('login-username');
        const passwordEl = document.getElementById('login-password');
        const totpEl = document.getElementById('login-totp');
        
        if (usernameEl && passwordEl && totpEl) {
            username = usernameEl.value.trim();
            password = passwordEl.value;
            totp = totpEl.value.trim();
        }
        if (!username || !password || !totp) {
            return showToast("Vui lòng điền email, mật khẩu và mã 2FA", "error");
        }
    } else {
        const usernameEl = document.getElementById('register-username');
        const passwordEl = document.getElementById('register-password');
        const fullnameEl = document.getElementById('register-fullname');
        const phoneEl = document.getElementById('register-phone');
        const cccdEl = document.getElementById('register-cccd');
        const pinEl = document.getElementById('register-pin');

        if (usernameEl && passwordEl && fullnameEl && phoneEl && cccdEl && pinEl) {
            username = usernameEl.value.trim();
            password = passwordEl.value;
            full_name = fullnameEl.value.trim();
            phone = phoneEl.value.trim();
            cccd = cccdEl.value.trim();
            pin = pinEl.value.trim();
        }
        if (!username || !password || !full_name || !phone || !cccd || !pin) {
            return showToast("Vui lòng điền đủ thông tin đăng ký", "error");
        }
    }

    const btn = document.getElementById(type === 'login' ? 'btn-login-action' : 'register-next-btn');
    const oldText = btn.innerText;
    btn.innerText = type === 'login' ? "Đang xác thực, vui lòng chờ..." : "Đang xử lý...";
    btn.disabled = true;

    const endpoint = type === 'login' ? '/login' : '/register';

    try {
        const body = type === 'login'
            ? { email: username, password, totp_token: totp }
            : { email: username, password, full_name, phone, cccd, pin };

        // Plain fetch is used because we don't have a JWT token yet
        const res = await fetch(`${BASE_URL}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        const data = await res.json();
        btn.disabled = false;
        btn.innerText = oldText;

        if (res.ok) {
            if (type === 'register') {
                totpSecret = data.totp_secret.toUpperCase().replace(/=+$/, "");
                document.getElementById('totp-secret-display').textContent = totpSecret;
                
                // Clear and render white-bordered QR Code
                const qrContainer = document.getElementById("qrcode");
                qrContainer.innerHTML = "";
                const otpUrl = `otpauth://totp/IOTA:${username.split('@')[0]}?secret=${totpSecret}&issuer=IOTA`;
                new QRCode(qrContainer, {
                    text: otpUrl,
                    width: 140,
                    height: 140,
                    correctLevel: QRCode.CorrectLevel.L
                });

                document.getElementById('totp-setup').classList.remove('hidden');
                showToast("Đăng ký thành công! Vui lòng lưu mã 2FA.");
            } else {
                // Save user credentials + JWT securely in RAM
                currentUser = { 
                    username, 
                    user_id: data.user_id, 
                    password, 
                    token: data.token // Capture Phase 4 JWT
                };
                showToast("Đăng nhập thành công!");
                postLoginSetup();
            }
        } else {
            if (type === 'login') {
                if (res.status === 403) {
                    showToast("Tài khoản đã bị khóa. Vui lòng liên hệ dịch vụ chăm sóc khách hàng!", "error");
                } else {
                    showToast("Thông tin đăng nhập hoặc mã 2FA không chính xác!", "error");
                }
            } else {
                showToast(data.error || "Lỗi đăng ký tài khoản", "error");
            }
        }
    } catch (e) {
        btn.disabled = false;
        btn.innerText = oldText;
        showToast("Không thể kết nối tới server", "error");
    }
}

function generateTestToken() {
    if (!totpSecret) return;
    try {
        let totp = new OTPAuth.TOTP({
            issuer: "IOTA",
            secret: OTPAuth.Secret.fromBase32(totpSecret),
        });
        const token = totp.generate();
        document.getElementById('test-token-display').innerText = token;
        document.getElementById('login-totp').value = token;
    } catch (e) { console.error("OTP Gen Error:", e); }
}

function postLoginSetup() {
    document.getElementById('login-card')?.classList.add('hidden');
    document.getElementById('register-card')?.classList.add('hidden');
    document.getElementById('landing-page')?.classList.add('hidden');
    document.getElementById('main-app')?.classList.remove('hidden');

    updateTrustChart();
    startBalancePolling();
    resetInactivityTimer();
}

function startBalancePolling() {
    if (balancePollId) clearInterval(balancePollId);
    fetchWalletInfo();
    balancePollId = setInterval(fetchWalletInfo, 5000);
}

async function fetchWalletInfo() {
    if (!currentUser) return;
    
    // Uses the secure fetch wrapper which automatically appends the JWT
    const { ok, status, data } = await secureApiFetch('/wallet/balance/check', 'POST', {
        user_id: currentUser.user_id,
        password: currentUser.password
    });

    if (ok) {
        const bal1 = document.getElementById('home-balance');
        const bal2 = document.getElementById('current-balance');
        const tsVal = document.getElementById('trust-score-value');
        const nameDisplay = document.getElementById('user-name-display');
        const initialDisplay = document.getElementById('user-initial');

        const balanceValue = typeof data.balance === 'number' ? data.balance : 0;
        if (bal1) bal1.innerText = balanceValue.toLocaleString('vi-VN') + ' Glow';
        if (bal2) bal2.innerText = balanceValue.toLocaleString('vi-VN') + ' Glow';
        if (tsVal) tsVal.innerText = "10.0";

        currentUserAddress = data.address;
        document.getElementById('display-address').innerText = data.address || "Chưa khởi tạo";
        fetchRecentTransactions();

        const prFN = document.getElementById('profile-fullname');
        const prEM = document.getElementById('profile-email');
        const prAv = document.getElementById('profile-avatar');
        const prInfoFN = document.getElementById('profile-info-fullname');
        const prInfoPH = document.getElementById('profile-info-phone');
        const prInfoCC = document.getElementById('profile-info-cccd');

        if (prFN) prFN.innerText = data.full_name || '---';
        if (prEM) prEM.innerText = currentUser.username || '---';
        if (prAv && data.full_name) prAv.innerText = data.full_name[0].toUpperCase();
        if (prInfoFN) prInfoFN.innerText = data.full_name || '---';
        if (prInfoPH) prInfoPH.innerText = data.phone || '---';
        if (prInfoCC) prInfoCC.innerText = data.cccd || '---';

        if (data.full_name) {
            if (nameDisplay) nameDisplay.innerText = data.full_name;
            if (initialDisplay) initialDisplay.innerText = data.full_name[0].toUpperCase();
        }
    } else if (status === 500 || status === 404) {
        console.log("Ví chưa được kích hoạt. Đang tự động mã hóa & tạo ví mới...");
        const createRes = await secureApiFetch('/wallet/create', 'POST', {
            user_id: currentUser.user_id,
            password: currentUser.password
        });
        if (createRes.ok) {
            fetchWalletInfo();
        }
    }
}

function clearTransferForm() {
    if (document.getElementById('recipient-phone')) document.getElementById('recipient-phone').value = "";
    if (document.getElementById('amount')) document.getElementById('amount').value = "";
    if (document.getElementById('tx-message')) document.getElementById('tx-message').value = "";
    if (document.getElementById('modal-tx-pin')) document.getElementById('modal-tx-pin').value = "";
    document.getElementById('recipient-lookup-info')?.classList.add('hidden');
}

function switchToHome() {
    clearTransferForm();
    document.getElementById('home-screen')?.classList.remove('hidden');
    document.getElementById('trans-screen')?.classList.add('hidden');
    document.getElementById('profile-screen')?.classList.add('hidden');
    document.getElementById('audit-screen')?.classList.add('hidden');

    document.getElementById('tab-home')?.classList.add('bg-emerald-800', 'text-white');
    document.getElementById('tab-trans')?.classList.remove('bg-emerald-800', 'text-white');
    document.getElementById('tab-audit')?.classList.remove('bg-emerald-800', 'text-white');
}

function switchToTrans() {
    clearTransferForm();
    document.getElementById('home-screen')?.classList.add('hidden');
    document.getElementById('trans-screen')?.classList.remove('hidden');
    document.getElementById('profile-screen')?.classList.add('hidden');
    document.getElementById('audit-screen')?.classList.add('hidden');

    document.getElementById('tab-trans')?.classList.add('bg-emerald-800', 'text-white');
    document.getElementById('tab-home')?.classList.remove('bg-emerald-800', 'text-white');
    document.getElementById('tab-audit')?.classList.remove('bg-emerald-800', 'text-white');
}

function switchToAudit() {
    clearTransferForm();
    document.getElementById('home-screen')?.classList.add('hidden');
    document.getElementById('trans-screen')?.classList.add('hidden');
    document.getElementById('profile-screen')?.classList.add('hidden');
    document.getElementById('audit-screen')?.classList.remove('hidden');

    document.getElementById('tab-audit')?.classList.add('bg-emerald-800', 'text-white');
    document.getElementById('tab-home')?.classList.remove('bg-emerald-800', 'text-white');
    document.getElementById('tab-trans')?.classList.remove('bg-emerald-800', 'text-white');
    
    viewLogs(); // Auto-load logs on tab open
}

function switchToProfile() {
    clearTransferForm();
    document.getElementById('home-screen')?.classList.add('hidden');
    document.getElementById('trans-screen')?.classList.add('hidden');
    document.getElementById('audit-screen')?.classList.add('hidden');
    document.getElementById('profile-screen')?.classList.remove('hidden');

    document.getElementById('tab-home')?.classList.remove('bg-emerald-800', 'text-white');
    document.getElementById('tab-trans')?.classList.remove('bg-emerald-800', 'text-white');
    document.getElementById('tab-audit')?.classList.remove('bg-emerald-800', 'text-white');
}

// --- SECURE ENVELOPE & SIGNING ---
let pendingTransferData = null;

function normalizePhoneNumber(rawPhone) {
    let phone = rawPhone.replace(/\D/g, "");
    if (phone.startsWith("84") && phone.length === 11) {
        phone = "0" + phone.slice(2);
    }
    return phone;
}

function openPinModal() {
    const rawPhone = document.getElementById('recipient-phone')?.value.trim() || "";
    const phone = normalizePhoneNumber(rawPhone);
    const amount = document.getElementById('amount')?.value || "";
    const message = document.getElementById('tx-message')?.value.trim() || "";
    const nameEl = document.getElementById('recipient-name');

    if (!phone || phone.length !== 10) {
        return showToast("Vui lòng nhập số điện thoại người nhận hợp lệ", "error");
    }

    const infoBox = document.getElementById('recipient-lookup-info');
    if (!infoBox || infoBox.classList.contains('hidden') || !nameEl || nameEl.textContent.includes('chưa đăng ký')) {
        return showToast("Người nhận không hợp lệ", "error");
    }

    if (!amount || parseInt(amount) <= 0) {
        return showToast("Số tiền gửi phải lớn hơn 0", "error");
    }

    pendingTransferData = { phone, amount, message };

    const modalName = document.getElementById('modal-recipient-name');
    const modalAmt = document.getElementById('modal-amount');
    const modalPin = document.getElementById('modal-tx-pin');
    const pinModal = document.getElementById('pin-modal');

    if (modalName) modalName.textContent = nameEl.textContent;
    if (modalAmt) modalAmt.textContent = parseInt(amount).toLocaleString('vi-VN') + ' Glow';
    if (modalPin) modalPin.value = "";
    if (pinModal) {
        pinModal.classList.remove('hidden');
        modalPin?.focus();
    }
}

function closePinModal() {
    document.getElementById('pin-modal')?.classList.add('hidden');
    pendingTransferData = null;
}

async function handleTransfer() {
    const pinEl = document.getElementById('modal-tx-pin');
    const pin = pinEl ? pinEl.value : "";

    if (!pendingTransferData) return showToast("Không có dữ liệu giao dịch", "error");
    if (!pin) return showToast("Vui lòng nhập mã PIN", "error");

    try {
        // --- PHASE 4 SECURE ENVELOPE IMPLEMENTATION ---
        const payloadObject = {
            sender_id: currentUser.user_id,
            recipient: pendingTransferData.phone,
            amount: parseInt(pendingTransferData.amount),
            pin: pin,
            message: pendingTransferData.message || null
        };
        
        const payload = JSON.stringify(payloadObject);
        const nonce = crypto.randomUUID();
        const timestamp = Math.floor(Date.now() / 1000);
        
        // WebCrypto SHA-256 Signature (Integrity check)
        const msg = new TextEncoder().encode(payload + nonce + timestamp + currentUser.password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msg);
        const signature = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

        const envelope = { payload, nonce, timestamp, signature };

        const { ok, data } = await secureApiFetch('/wallet/transfer', 'POST', envelope);

        if (ok) {
            showToast("Thanh toán thành công qua màng bảo vệ!");
            closePinModal();
            clearTransferForm();
            switchToHome();
            fetchWalletInfo(); // Refresh balance
        } else {
            showToast(data.error || "Giao dịch bị từ chối", "error");
            if (pinEl) pinEl.value = "";
        }
    } catch (e) {
        showToast("Lỗi hệ thống", "error");
    }
}

// --- PHONE LOOKUP ---
document.addEventListener("DOMContentLoaded", () => {
    const phoneInput = document.getElementById('recipient-phone');
    if (phoneInput) {
        phoneInput.addEventListener('input', async (e) => {
            const rawPhone = e.target.value.trim();
            const phone = normalizePhoneNumber(rawPhone);
            const infoBox = document.getElementById('recipient-lookup-info');
            const nameEl = document.getElementById('recipient-name');
            const avatarEl = document.getElementById('recipient-avatar');

            if (phone.length !== 10) {
                infoBox?.classList.add('hidden');
                return;
            }

            const { ok, data } = await secureApiFetch('/user/lookup-by-phone', 'POST', { phone });
            if (ok && data.status === 'success') {
                if (nameEl) nameEl.textContent = data.full_name;
                if (avatarEl) avatarEl.textContent = data.full_name[0].toUpperCase();
                infoBox?.classList.remove('hidden');
            } else {
                if (nameEl) nameEl.textContent = 'Số điện thoại này chưa đăng ký tài khoản';
                if (avatarEl) avatarEl.textContent = '?';
                infoBox?.classList.remove('hidden');
            }
        });
    }
});

// --- SECURITY MONITORING VIEW (Phase 4) ---
async function viewLogs() {
    const { ok, data } = await secureApiFetch('/logs', 'GET');
    const container = document.getElementById('log-display');
    if (!container) return;

    if (ok && Array.isArray(data)) {
        if (data.length === 0) {
            container.innerHTML = `<div class="text-slate-500">Nhật ký trống. Chưa phát hiện mối đe dọa nào.</div>`;
            return;
        }

        container.innerHTML = data.map(l => {
            const date = new Date(l.time).toLocaleTimeString('vi-VN');
            const colorClass = l.severity === 'CRITICAL' ? 'text-rose-500 font-bold' : 'text-amber-500';
            return `<div class="border-b border-slate-800 pb-2">
                <span class="${colorClass}">[${l.severity}]</span> 
                <b>${l.event}</b>: ${l.details} <span class="float-right text-slate-500">${date}</span>
            </div>`;
        }).join('');
    } else {
        container.innerHTML = `<div class="text-rose-500">Lỗi khi tải nhật ký. Token có thể đã hết hạn.</div>`;
    }
}

// --- LOGOUT ---
function handleLogout() {
    // SECURITY WIPE: Clear RAM state on logout
    currentUser = null;
    totpSecret = null;
    if (balancePollId) clearInterval(balancePollId);
    balancePollId = null;
    if (inactivityTimeout) clearTimeout(inactivityTimeout);
    inactivityTimeout = null;
    location.reload();
}

// --- INACTIVITY TIMEOUT (Wipe credentials from memory) ---
let inactivityTimeout = null;
const INACTIVITY_LIMIT = 15 * 60 * 1000; // 15 Phút

function resetInactivityTimer() {
    if (!currentUser) return;
    if (inactivityTimeout) clearTimeout(inactivityTimeout);
    inactivityTimeout = setTimeout(() => {
        showToast("Phiên làm việc hết hạn. Ví tự động khóa bảo mật.", "error");
        setTimeout(handleLogout, 2000);
    }, INACTIVITY_LIMIT);
}

window.addEventListener('mousemove', resetInactivityTimer);
window.addEventListener('keydown', resetInactivityTimer);
window.addEventListener('click', resetInactivityTimer);
window.addEventListener('scroll', resetInactivityTimer);

// --- MULTI-STEP REGISTRATION WIZARD ---
let currentRegisterStep = 1;

function resetRegisterWizard() {
    currentRegisterStep = 1;
    updateRegisterStepsUI();
}

function updateRegisterStepsUI() {
    const step1El = document.getElementById('register-step-1');
    const step2El = document.getElementById('register-step-2');
    const step3El = document.getElementById('register-step-3');

    if (currentRegisterStep === 1) {
        step1El?.classList.remove('hidden');
        step2El?.classList.add('hidden');
        step3El?.classList.add('hidden');
    } else if (currentRegisterStep === 2) {
        step1El?.classList.add('hidden');
        step2El?.classList.remove('hidden');
        step3El?.classList.add('hidden');
    } else if (currentRegisterStep === 3) {
        step1El?.classList.add('hidden');
        step2El?.classList.add('hidden');
        step3El?.classList.remove('hidden');
    }

    for (let i = 1; i <= 3; i++) {
        const dot = document.getElementById(`step-dot-${i}`);
        const label = document.getElementById(`step-label-${i}`);
        if (!dot || !label) continue;

        if (i < currentRegisterStep) {
            dot.className = "w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-sm shadow-sm transition-all duration-300";
            dot.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i>`;
            label.className = "text-[10px] font-bold text-emerald-600 mt-1";
        } else if (i === currentRegisterStep) {
            dot.className = "w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-sm transition-all duration-300";
            dot.innerText = i;
            label.className = "text-[10px] font-bold text-emerald-600 mt-1";
        } else {
            dot.className = "w-8 h-8 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center font-bold text-sm transition-all duration-300";
            dot.innerText = i;
            label.className = "text-[10px] font-bold text-slate-400 mt-1";
        }
    }

    const line1 = document.getElementById('step-line-1');
    const line2 = document.getElementById('step-line-2');
    if (line1) {
        if (currentRegisterStep > 1) {
            line1.classList.remove('bg-slate-100');
            line1.classList.add('bg-emerald-500');
        } else {
            line1.classList.add('bg-slate-100');
            line1.classList.remove('bg-emerald-500');
        }
    }
    if (line2) {
        if (currentRegisterStep > 2) {
            line2.classList.remove('bg-slate-100');
            line2.classList.add('bg-emerald-500');
        } else {
            line2.classList.add('bg-slate-100');
            line2.classList.remove('bg-emerald-500');
        }
    }

    const prevBtn = document.getElementById('register-prev-btn');
    const nextBtn = document.getElementById('register-next-btn');
    if (prevBtn) {
        if (currentRegisterStep === 1) prevBtn.classList.add('hidden');
        else prevBtn.classList.remove('hidden');
    }
    if (nextBtn) {
        if (currentRegisterStep === 3) nextBtn.innerText = "Đăng ký";
        else nextBtn.innerText = "Tiếp tục";
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function nextRegisterStep() {
    const email = document.getElementById('register-username')?.value.trim();
    const password = document.getElementById('register-password')?.value;
    const fullname = document.getElementById('register-fullname')?.value.trim();
    const phone = document.getElementById('register-phone')?.value.trim();
    const cccd = document.getElementById('register-cccd')?.value.trim();
    const pin = document.getElementById('register-pin')?.value.trim();

    if (currentRegisterStep === 1) {
        if (!email || !password) return showToast("Vui lòng nhập email và mật khẩu", "error");
        if (!email.includes('@')) return showToast("Email không hợp lệ", "error");
        currentRegisterStep = 2;
        updateRegisterStepsUI();
    } else if (currentRegisterStep === 2) {
        if (!fullname || !phone || !cccd) return showToast("Vui lòng nhập thông tin xác thực", "error");
        if (!/^\d+$/.test(phone)) return showToast("SĐT chỉ được chứa số", "error");
        if (!/^\d+$/.test(cccd)) return showToast("CCCD chỉ được chứa số", "error");
        currentRegisterStep = 3;
        updateRegisterStepsUI();
    } else if (currentRegisterStep === 3) {
        if (!pin) return showToast("Vui lòng nhập mã PIN", "error");
        if (pin.length !== 6 || !/^\d+$/.test(pin)) return showToast("Mã PIN phải gồm đúng 6 chữ số", "error");
        handleAuth('register');
    }
}

function prevRegisterStep() {
    if (currentRegisterStep > 1) {
        currentRegisterStep--;
        updateRegisterStepsUI();
    }
}