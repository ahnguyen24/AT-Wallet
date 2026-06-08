const BASE_URL = "/api";
let currentUser = null;
let balancePollId = null;
let trustChart = null;
let currentUserAddress = null;

// --- UTILS ---
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.innerText = message;
    toast.className = `fixed bottom-10 left-1/2 -translate-x-1/2 px-8 py-4 rounded-2xl shadow-2xl font-bold text-white transition-all z-50 ${type === 'success' ? 'bg-emerald-500' : 'bg-rose-500'}`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 4000);
}

async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- BIỂU ĐỒ TRUST SCORE ---
async function updateTrustChart() {
    console.log("Hiển thị biểu đồ Trust Score...");
    const chartEl = document.getElementById('trustChart');
    if (!chartEl) return;
    const ctx = chartEl.getContext('2d');
    if (trustChart) return;

    // @ts-ignore
    trustChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['10:00', '10:05', '10:10', '10:15', '10:20'],
            datasets: [{
                label: 'Trust Score',
                data: [9.5, 9.6, 9.6, 9.8, 10.0],
                borderColor: '#059669',
                backgroundColor: 'rgba(5, 150, 105, 0.1)',
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

    if (type === 'login') {
        const usernameEl = document.getElementById('login-username');
        const passwordEl = document.getElementById('login-password');
        if (usernameEl && passwordEl) {
            username = usernameEl.value.trim();
            password = passwordEl.value;
        }
        if (!username || !password) return showToast("Vui lòng điền đủ thông tin đăng nhập", "error");
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
            return showToast("Vui lòng điền đủ tất cả các trường đăng ký", "error");
        }
        if (pin.length !== 6 || !/^\d+$/.test(pin)) {
            return showToast("Mã PIN giao dịch phải gồm đúng 6 chữ số", "error");
        }
    }

    const endpoint = type === 'login' ? '/login' : '/register';
    console.log(`Đang thực hiện ${type}...`);

    try {
        const hashedPassword = await sha256(password + ":" + username.toLowerCase());
        let hashedPin = '';
        if (type === 'register') {
            hashedPin = await sha256(pin + ":" + username.toLowerCase());
        }

        const body = type === 'login'
            ? { email: username, password: hashedPassword }
            : { email: username, password: hashedPassword, full_name, phone, cccd, pin: hashedPin };

        const res = await fetch(`${BASE_URL}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        const data = await res.json();

        if (res.ok) {
            if (type === 'register') {
                const setupEl = document.getElementById('totp-setup');
                const secretEl = document.getElementById('totp-secret-display');
                if (setupEl && secretEl) {
                    secretEl.textContent = data.totp_secret || 'N/A';
                    setupEl.classList.remove('hidden');
                }
                showToast("Đăng ký thành công! Vui lòng lưu mã TOTP.");
            } else {
                currentUser = { username, user_id: data.user_id, password: hashedPassword };
                showToast("Đăng nhập thành công!");
                postLoginSetup();
            }
        } else {
            showToast(data.error || "Sai thông tin email hoặc mật khẩu", "error");
        }
    } catch (e) {
        console.error("Auth error:", e);
        showToast("Không thể kết nối tới server", "error");
    }
}

// --- GIAO DIỆN SAU ĐĂNG NHẬP ---
function postLoginSetup() {
    console.log("Đang khởi tạo giao diện chính...");

    const loginCard = document.getElementById('login-card');
    const registerCard = document.getElementById('register-card');
    const mainApp = document.getElementById('main-app');

    if (loginCard) {
        loginCard.classList.add('hidden');
        loginCard.classList.remove('flex');
    }
    if (registerCard) {
        registerCard.classList.add('hidden');
        registerCard.classList.remove('flex');
    }

    document.getElementById('landing-page')?.classList.add('hidden');

    if (mainApp) {
        mainApp.classList.remove('hidden');
        mainApp.classList.add('flex');
    }

    // Điền thông tin User
    const nameDisplay = document.getElementById('user-name-display');
    const initialDisplay = document.getElementById('user-initial');

    if (nameDisplay) nameDisplay.innerText = currentUser.username;
    if (initialDisplay) initialDisplay.innerText = currentUser.username[0].toUpperCase();

    updateTrustChart();
    startBalancePolling();
    resetInactivityTimer(); // Bắt đầu tính thời gian không hoạt động
}

// --- POLLING SỐ DƯ ---
function startBalancePolling() {
    console.log("Bắt đầu cập nhật số dư định kỳ...");
    if (balancePollId) clearInterval(balancePollId);

    // Chạy lần đầu
    fetchWalletInfo();

    balancePollId = setInterval(fetchWalletInfo, 5000);
}

async function fetchWalletInfo() {
    if (!currentUser) return;
    try {
        // Gọi API lấy số dư, truyền user_id và password trong body
        // Sử dụng POST /api/wallet/balance/check (bất kỳ chuỗi address nào cũng được vì handler không kiểm tra)
        const r = await fetch(`${BASE_URL}/wallet/balance/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: currentUser.user_id,
                password: currentUser.password
            })
        });

        if (r.ok) {
            const info = await r.json();
            const bal1 = document.getElementById('home-balance');
            const bal2 = document.getElementById('current-balance');
            const tsVal = document.getElementById('trust-score-value');
            const nameDisplay = document.getElementById('user-name-display');
            const initialDisplay = document.getElementById('user-initial');

            // Hiển thị balance
            const balanceValue = typeof info.balance === 'number' ? info.balance : 0;
            if (bal1) bal1.innerText = balanceValue.toFixed(4) + ' SOL';
            if (bal2) bal2.innerText = balanceValue.toFixed(4) + ' SOL';
            if (tsVal) tsVal.innerText = "10.0"; // Điểm tín nhiệm giả lập

            // Cập nhật địa chỉ ví hiện tại và tải các giao dịch
            currentUserAddress = info.address;
            fetchRecentTransactions();

            // Hiển thị thông tin KYC ở trang Profile
            const prFN = document.getElementById('profile-fullname');
            const prEM = document.getElementById('profile-email');
            const prAv = document.getElementById('profile-avatar');
            const prInfoFN = document.getElementById('profile-info-fullname');
            const prInfoPH = document.getElementById('profile-info-phone');
            const prInfoCC = document.getElementById('profile-info-cccd');

            if (prFN) prFN.innerText = info.full_name || '---';
            if (prEM) prEM.innerText = currentUser.username || '---';
            if (prAv && info.full_name) prAv.innerText = info.full_name[0].toUpperCase();
            if (prInfoFN) prInfoFN.innerText = info.full_name || '---';
            if (prInfoPH) prInfoPH.innerText = info.phone || '---';
            if (prInfoCC) prInfoCC.innerText = info.cccd || '---';

            // Cập nhật tên hiển thị ở góc màn hình bằng Họ và tên thật từ KYC
            if (info.full_name) {
                if (nameDisplay) nameDisplay.innerText = info.full_name;
                if (initialDisplay) initialDisplay.innerText = info.full_name[0].toUpperCase();
            }
        } else if (r.status === 500 || r.status === 404) {
            // Nếu lỗi 500/404 có thể ví chưa được tạo, tiến hành tự động tạo ví trong background
            console.log("Ví chưa tồn tại. Đang tự động tạo ví...");
            const createRes = await fetch(`${BASE_URL}/wallet/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: currentUser.user_id,
                    password: currentUser.password
                })
            });
            if (createRes.ok) {
                console.log("Tạo ví thành công!");
                // Gọi lại để cập nhật balance
                fetchWalletInfo();
            }
        }
    } catch (e) {
        console.error("Lỗi lấy thông tin ví:", e);
    }
}

function clearTransferForm() {
    if (document.getElementById('recipient-phone')) document.getElementById('recipient-phone').value = "";
    if (document.getElementById('amount')) document.getElementById('amount').value = "";
    if (document.getElementById('tx-message')) document.getElementById('tx-message').value = "";
    if (document.getElementById('modal-tx-pin')) document.getElementById('modal-tx-pin').value = "";
    document.getElementById('recipient-lookup-info')?.classList.add('hidden');
}

// --- CHUYỂN TAB ---
function switchToHome() {
    clearTransferForm();

    document.getElementById('home-screen')?.classList.remove('hidden');
    document.getElementById('trans-screen')?.classList.add('hidden');
    document.getElementById('profile-screen')?.classList.add('hidden');

    document.getElementById('tab-home')?.classList.add('bg-emerald-800', 'text-white');
    document.getElementById('tab-home')?.classList.remove('hover:bg-emerald-600', 'text-emerald-50');

    document.getElementById('tab-trans')?.classList.remove('bg-emerald-800', 'text-white');
    document.getElementById('tab-trans')?.classList.add('hover:bg-emerald-600', 'text-emerald-50');

    // De-highlight profile trigger
    const nameDisp = document.getElementById('user-name-display');
    const initDisp = document.getElementById('user-initial');
    if (nameDisp) nameDisp.classList.remove('text-yellow-300');
    if (initDisp) {
        initDisp.classList.remove('border-yellow-400', 'scale-105');
        initDisp.classList.add('border-emerald-500');
    }
}

function switchToTrans() {
    clearTransferForm();

    document.getElementById('home-screen')?.classList.add('hidden');
    document.getElementById('trans-screen')?.classList.remove('hidden');
    document.getElementById('profile-screen')?.classList.add('hidden');

    document.getElementById('tab-trans')?.classList.add('bg-emerald-800', 'text-white');
    document.getElementById('tab-trans')?.classList.remove('hover:bg-emerald-600', 'text-emerald-50');

    document.getElementById('tab-home')?.classList.remove('bg-emerald-800', 'text-white');
    document.getElementById('tab-home')?.classList.add('hover:bg-emerald-600', 'text-emerald-50');

    // De-highlight profile trigger
    const nameDisp = document.getElementById('user-name-display');
    const initDisp = document.getElementById('user-initial');
    if (nameDisp) nameDisp.classList.remove('text-yellow-300');
    if (initDisp) {
        initDisp.classList.remove('border-yellow-400', 'scale-105');
        initDisp.classList.add('border-emerald-500');
    }
}

function switchToProfile() {
    clearTransferForm();

    document.getElementById('home-screen')?.classList.add('hidden');
    document.getElementById('trans-screen')?.classList.add('hidden');
    document.getElementById('profile-screen')?.classList.remove('hidden');

    document.getElementById('tab-home')?.classList.remove('bg-emerald-800', 'text-white');
    document.getElementById('tab-home')?.classList.add('hover:bg-emerald-600', 'text-emerald-50');
    document.getElementById('tab-trans')?.classList.remove('bg-emerald-800', 'text-white');
    document.getElementById('tab-trans')?.classList.add('hover:bg-emerald-600', 'text-emerald-50');

    // Highlight profile trigger
    const nameDisp = document.getElementById('user-name-display');
    const initDisp = document.getElementById('user-initial');
    if (nameDisp) nameDisp.classList.add('text-yellow-300');
    if (initDisp) {
        initDisp.classList.add('border-yellow-400', 'scale-105');
        initDisp.classList.remove('border-emerald-500');
    }

    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

// --- CHUYỂN TIỀN ---
let pendingTransferData = null;

function normalizePhoneNumber(rawPhone) {
    let phone = rawPhone.replace(/\D/g, ""); // Remove non-digits
    if (phone.startsWith("84") && phone.length === 11) {
        phone = "0" + phone.slice(2);
    }
    return phone;
}

function openPinModal() {
    console.log("openPinModal triggered");
    const rawPhone = document.getElementById('recipient-phone')?.value.trim() || "";
    const phone = normalizePhoneNumber(rawPhone);
    const amount = document.getElementById('amount')?.value || "";
    const message = document.getElementById('tx-message')?.value.trim() || "";
    const nameEl = document.getElementById('recipient-name');

    console.log("Validation details:", { rawPhone, normalizedPhone: phone, amount, message, name: nameEl?.textContent });

    if (!phone || phone.length !== 10) {
        return showToast("Vui lòng nhập đúng số điện thoại người nhận (10 chữ số)", "error");
    }

    const infoBox = document.getElementById('recipient-lookup-info');
    if (!infoBox || infoBox.classList.contains('hidden') || !nameEl || nameEl.textContent === '---' || nameEl.textContent.includes('chưa đăng ký') || nameEl.textContent.includes('không hợp lệ')) {
        return showToast("Không tìm thấy người nhận hợp lệ", "error");
    }

    if (!amount || parseFloat(amount) <= 0) {
        return showToast("Số tiền gửi phải lớn hơn 0", "error");
    }
    if (parseFloat(amount) > 50.0) {
        return showToast("Hạn mức tối đa là 50 SOL cho mỗi giao dịch", "error");
    }

    // Save pending data
    pendingTransferData = { phone, amount, message };
    console.log("Pending transfer set:", pendingTransferData);

    // Update modal details
    const modalName = document.getElementById('modal-recipient-name');
    const modalAmt = document.getElementById('modal-amount');
    const modalPin = document.getElementById('modal-tx-pin');
    const pinModal = document.getElementById('pin-modal');

    if (modalName) modalName.textContent = nameEl.textContent;
    if (modalAmt) modalAmt.textContent = parseFloat(amount).toFixed(4) + ' SOL';
    if (modalPin) modalPin.value = "";
    if (pinModal) {
        pinModal.classList.remove('hidden');
        modalPin?.focus();
        console.log("PIN modal shown and focused");
    }
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
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
    if (!pin) return showToast("Vui lòng nhập mã PIN giao dịch", "error");
    if (pin.length !== 6 || !/^\d+$/.test(pin)) return showToast("Mã PIN giao dịch phải gồm đúng 6 chữ số", "error");

    try {
        const hashedPin = await sha256(pin + ":" + currentUser.username.toLowerCase());
        const res = await fetch(`${BASE_URL}/wallet/transfer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sender_id: currentUser.user_id,
                recipient: pendingTransferData.phone,
                amount: parseFloat(pendingTransferData.amount),
                pin: hashedPin,
                message: pendingTransferData.message || null
            }),
        });

        const data = await res.json();
        if (res.ok) {
            showToast(data.message || "Chuyển tiền thành công!");
            closePinModal();
            clearTransferForm();
            switchToHome();
            fetchWalletInfo(); // Cập nhật số dư ngay lập tức
        } else {
            showToast(data.error || "Giao dịch bị từ chối", "error");
            if (pinEl) pinEl.value = "";
        }
    } catch (e) {
        showToast("Lỗi hệ thống", "error");
    }
}

// Lắng nghe sự kiện nhập số điện thoại để tìm kiếm người nhận
document.addEventListener("DOMContentLoaded", () => {
    setupPhoneLookupListener();
});

// Fallback if DOMContentLoaded already fired
if (document.readyState === "interactive" || document.readyState === "complete") {
    setupPhoneLookupListener();
}

function setupPhoneLookupListener() {
    const phoneInput = document.getElementById('recipient-phone');
    if (!phoneInput) return;

    phoneInput.removeEventListener('input', handlePhoneInput);
    phoneInput.addEventListener('input', handlePhoneInput);
}

async function handlePhoneInput(e) {
    const rawPhone = e.target.value.trim();
    const phone = normalizePhoneNumber(rawPhone);
    console.log("handlePhoneInput raw:", rawPhone, "normalized:", phone);

    const infoBox = document.getElementById('recipient-lookup-info');
    const nameEl = document.getElementById('recipient-name');
    const avatarEl = document.getElementById('recipient-avatar');

    if (phone.length !== 10) {
        infoBox?.classList.add('hidden');
        return;
    }

    try {
        console.log("Searching user by phone:", phone);
        const res = await fetch(`${BASE_URL}/user/lookup-by-phone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        const data = await res.json();
        console.log("Lookup result:", data);
        if (res.ok && data.status === 'success') {
            if (nameEl) nameEl.textContent = data.full_name;
            if (avatarEl) avatarEl.textContent = data.full_name[0].toUpperCase();
            infoBox?.classList.remove('hidden');
        } else {
            if (nameEl) nameEl.textContent = 'Người nhận chưa đăng ký hoặc thông tin không hợp lệ';
            if (avatarEl) avatarEl.textContent = '?';
            infoBox?.classList.remove('hidden');
        }
    } catch (err) {
        console.error("Lỗi tìm kiếm người nhận:", err);
    }
}

// --- ĐĂNG XUẤT ---
function handleLogout() {
    currentUser = null;
    if (balancePollId) clearInterval(balancePollId);
    balancePollId = null;
    if (inactivityTimeout) clearTimeout(inactivityTimeout);
    inactivityTimeout = null;
    location.reload();
}

// --- Điểm Tín Nhiệm Status ---
function getTrustStatus(score) {
    if (score >= 9.0) return { text: 'Excellent', color: '#10b981' };
    if (score >= 7.0) return { text: 'Good', color: '#3b82f6' };
    if (score >= 5.0) return { text: 'Normal', color: '#f59e0b' };
    return { text: 'Risky', color: '#ef4444' };
}

// --- INACTIVITY TIMEOUT (5 PHÚT) ---
let inactivityTimeout = null;
const INACTIVITY_LIMIT = 5 * 60 * 1000; // 5 phút

function resetInactivityTimer() {
    if (!currentUser) return; // Chỉ theo dõi khi đã đăng nhập
    if (inactivityTimeout) clearTimeout(inactivityTimeout);
    inactivityTimeout = setTimeout(() => {
        console.log("Hết thời gian chờ hoạt động. Đang tự động đăng xuất...");
        showToast("Bạn đã bị tự động đăng xuất do không hoạt động trong 5 phút", "error");
        setTimeout(handleLogout, 2000);
    }, INACTIVITY_LIMIT);
}

// Lắng nghe các sự kiện tương tác của người dùng để reset timer
window.addEventListener('mousemove', resetInactivityTimer);
window.addEventListener('keydown', resetInactivityTimer);
window.addEventListener('click', resetInactivityTimer);
window.addEventListener('scroll', resetInactivityTimer);

// --- MULTI-STEP REGISTRATION WIZARD ---
let currentRegisterStep = 1;

function resetRegisterWizard() {
    currentRegisterStep = 1;
    const userEl = document.getElementById('register-username');
    const pwdEl = document.getElementById('register-password');
    const nameEl = document.getElementById('register-fullname');
    const phoneEl = document.getElementById('register-phone');
    const cccdEl = document.getElementById('register-cccd');
    const pinEl = document.getElementById('register-pin');

    if (userEl) userEl.value = "";
    if (pwdEl) pwdEl.value = "";
    if (nameEl) nameEl.value = "";
    if (phoneEl) phoneEl.value = "";
    if (cccdEl) cccdEl.value = "";
    if (pinEl) pinEl.value = "";

    updateRegisterStepsUI();
}

function updateRegisterStepsUI() {
    const step1El = document.getElementById('register-step-1');
    const step2El = document.getElementById('register-step-2');
    const step3El = document.getElementById('register-step-3');

    if (step1El) {
        if (currentRegisterStep === 1) step1El.classList.remove('hidden');
        else step1El.classList.add('hidden');
    }
    if (step2El) {
        if (currentRegisterStep === 2) step2El.classList.remove('hidden');
        else step2El.classList.add('hidden');
    }
    if (step3El) {
        if (currentRegisterStep === 3) step3El.classList.remove('hidden');
        else step3El.classList.add('hidden');
    }

    // Update progress steps dots and labels
    for (let i = 1; i <= 3; i++) {
        const dot = document.getElementById(`step-dot-${i}`);
        const label = document.getElementById(`step-label-${i}`);
        if (!dot || !label) continue;

        if (i < currentRegisterStep) {
            // Completed step
            dot.className = "w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-sm shadow-sm transition-all duration-300";
            dot.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i>`;
            label.className = "text-[10px] font-bold text-emerald-600 mt-1";
        } else if (i === currentRegisterStep) {
            // Active step
            dot.className = "w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-sm transition-all duration-300";
            dot.innerText = i;
            label.className = "text-[10px] font-bold text-emerald-600 mt-1";
        } else {
            // Future step
            dot.className = "w-8 h-8 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center font-bold text-sm transition-all duration-300";
            dot.innerText = i;
            label.className = "text-[10px] font-bold text-slate-400 mt-1";
        }
    }

    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    // Update connector lines color
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

    // Toggle Back / Next Button text & visibility
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
}

function nextRegisterStep() {
    const emailEl = document.getElementById('register-username');
    const pwdEl = document.getElementById('register-password');
    const nameEl = document.getElementById('register-fullname');
    const phoneEl = document.getElementById('register-phone');
    const cccdEl = document.getElementById('register-cccd');
    const pinEl = document.getElementById('register-pin');

    const email = emailEl ? emailEl.value.trim() : "";
    const password = pwdEl ? pwdEl.value : "";
    const fullname = nameEl ? nameEl.value.trim() : "";
    const phone = phoneEl ? phoneEl.value.trim() : "";
    const cccd = cccdEl ? cccdEl.value.trim() : "";
    const pin = pinEl ? pinEl.value.trim() : "";

    if (currentRegisterStep === 1) {
        if (!email || !password) {
            return showToast("Vui lòng nhập đầy đủ email và mật khẩu", "error");
        }
        if (!email.includes('@')) {
            return showToast("Địa chỉ email không hợp lệ", "error");
        }
        currentRegisterStep = 2;
        updateRegisterStepsUI();
    } else if (currentRegisterStep === 2) {
        if (!fullname || !phone || !cccd) {
            return showToast("Vui lòng điền đầy đủ Họ tên, Số điện thoại và CCCD", "error");
        }
        if (!/^\d+$/.test(phone)) {
            return showToast("Số điện thoại chỉ được chứa các chữ số", "error");
        }
        if (!/^\d+$/.test(cccd)) {
            return showToast("Số CCCD chỉ được chứa các chữ số", "error");
        }
        currentRegisterStep = 3;
        updateRegisterStepsUI();
    } else if (currentRegisterStep === 3) {
        if (!pin) {
            return showToast("Vui lòng nhập mã PIN giao dịch", "error");
        }
        if (pin.length !== 6 || !/^\d+$/.test(pin)) {
            return showToast("Mã PIN giao dịch phải gồm đúng 6 chữ số", "error");
        }
        // Gọi hàm đăng ký thực tế
        handleAuth('register');
    }
}

function prevRegisterStep() {
    if (currentRegisterStep > 1) {
        currentRegisterStep--;
        updateRegisterStepsUI();
    }
}

// --- TẢI LỊCH SỬ GIAO DỊCH ---
const userNamesCache = {};

async function resolveName(type, value) {
    const cacheKey = `${type}:${value}`;
    if (userNamesCache[cacheKey]) {
        return userNamesCache[cacheKey];
    }
    try {
        const body = {};
        body[type] = value;
        const res = await fetch(`${BASE_URL}/user/lookup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (res.ok) {
            const data = await res.json();
            if (data.status === 'success' && data.full_name) {
                userNamesCache[cacheKey] = data.full_name;
                return data.full_name;
            }
        }
    } catch (e) {
        console.error("Error resolving name:", e);
    }
    const fallbackVal = type === 'address'
        ? (value ? value.slice(0, 8) + '...' + value.slice(-6) : 'N/A')
        : value;
    userNamesCache[cacheKey] = fallbackVal;
    return fallbackVal;
}

function extractVal(details, key) {
    // Try to match key='value' (single quotes)
    const quoteRegex = new RegExp(key + "='([^']*)'");
    const quoteMatch = details.match(quoteRegex);
    if (quoteMatch) return quoteMatch[1];

    // Try to match key=value (terminated by comma or end of string)
    const regex = new RegExp(key + "=([^,]+)");
    const match = details.match(regex);
    if (match) {
        let val = match[1].trim();
        // Strip trailing " SOL" if key is amount
        if (key === "amount" && val.endsWith(" SOL")) {
            val = val.replace(" SOL", "").trim();
        }
        return val;
    }
    return null;
}

async function fetchRecentTransactions() {
    if (!currentUser || !currentUserAddress) return;
    try {
        const res = await fetch(`${BASE_URL}/logs`);
        if (!res.ok) return;
        const logs = await res.json();

        const txList = document.getElementById('transactions-list');
        if (!txList) return;

        // Filter and parse logs of type TRANSFER that involve currentUser
        const transfers = [];
        for (const log of logs) {
            if (log.event === 'TRANSFER') {
                const details = log.details || "";
                const senderId = extractVal(details, "sender_id");
                const senderEmail = extractVal(details, "sender_email");
                const senderName = extractVal(details, "sender_name");
                const recipientWalletId = extractVal(details, "recipient_wallet_id");
                const recipientAddress = extractVal(details, "recipient_address");
                const recipientName = extractVal(details, "recipient_name");
                const amountStr = extractVal(details, "amount");
                const message = extractVal(details, "message") || "";

                if (senderEmail && recipientAddress && amountStr) {
                    const parsed = {
                        senderId,
                        senderEmail,
                        senderName,
                        recipientWalletId,
                        recipientAddress,
                        recipientName,
                        amount: parseFloat(amountStr),
                        message,
                        time: log.time
                    };

                    const isSender = (parsed.senderEmail === currentUser.username);
                    const isRecipient = (parsed.recipientAddress === currentUserAddress);

                    if (isSender || isRecipient) {
                        transfers.push({
                            ...parsed,
                            isSender,
                            isRecipient
                        });
                    }
                }
            }
        }

        if (transfers.length === 0) {
            txList.innerHTML = `
                <div class="p-8 text-center text-slate-400 flex flex-col items-center justify-center h-64" id="tx-placeholder">
                    <div class="bg-slate-50 p-4 rounded-full mb-4">
                        <i data-lucide="history" class="w-8 h-8 text-slate-300"></i>
                    </div>
                    <p class="font-medium text-slate-500">Các giao dịch của bạn sẽ hiển thị tại đây.</p>
                    <p class="text-sm mt-2">Dữ liệu on-chain đang được đồng bộ...</p>
                </div>
            `;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            return;
        }

        let html = "";
        for (const tx of transfers) {
            const formattedTime = new Date(tx.time).toLocaleString('vi-VN', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });

            const isSend = tx.isSender;
            const amountText = (isSend ? "-" : "+") + tx.amount.toFixed(4) + " SOL";
            const amountClass = isSend ? "text-rose-600 font-extrabold" : "text-emerald-600 font-extrabold";

            const iconName = isSend ? "arrow-up-right" : "arrow-down-left";
            const iconBg = isSend ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600";

            const labelTitle = isSend ? "Chuyển tiền đi" : "Nhận tiền đến";

            let partnerInfo = "";
            if (isSend) {
                if (tx.recipientName) {
                    partnerInfo = `Đến: <span class="font-bold text-slate-700">${tx.recipientName}</span>`;
                } else {
                    const fallbackText = tx.recipientAddress ? tx.recipientAddress.slice(0, 8) + '...' + tx.recipientAddress.slice(-6) : 'N/A';
                    partnerInfo = `Đến: <span class="font-bold text-slate-700" data-lookup-address="${tx.recipientAddress}">${fallbackText}</span>`;
                }
            } else {
                if (tx.senderName) {
                    partnerInfo = `Từ: <span class="font-bold text-slate-700">${tx.senderName}</span>`;
                } else {
                    partnerInfo = `Từ: <span class="font-bold text-slate-700" data-lookup-email="${tx.senderEmail}">${tx.senderEmail}</span>`;
                }
            }

            const messageHtml = tx.message
                ? `<p class="text-xs text-slate-400 mt-1 italic font-medium bg-slate-50 px-2.5 py-1 rounded-md inline-block border border-slate-100">"${tx.message}"</p>`
                : "";

            html += `
                <div class="p-6 flex items-center justify-between hover:bg-slate-50/50 transition-colors border-b border-slate-100 last:border-b-0">
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${iconBg}">
                            <i data-lucide="${iconName}" class="w-6 h-6"></i>
                        </div>
                        <div>
                            <p class="font-bold text-slate-800 text-sm md:text-base">${labelTitle}</p>
                            <p class="text-xs text-slate-500 font-semibold">${partnerInfo} • ${formattedTime}</p>
                            ${messageHtml}
                        </div>
                    </div>
                    <div class="text-right shrink-0">
                        <p class="${amountClass} text-sm md:text-base">${amountText}</p>
                        <p class="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full inline-block font-bold border border-emerald-100 mt-1 uppercase">Thành công</p>
                    </div>
                </div>
            `;
        }

        txList.innerHTML = html;

        // Resolve names asynchronously for placeholder elements
        const elementsToResolve = txList.querySelectorAll('[data-lookup-address], [data-lookup-email]');
        const uniqueLookups = new Set();
        elementsToResolve.forEach(el => {
            const address = el.getAttribute('data-lookup-address');
            if (address) uniqueLookups.add(`address:${address}`);
            const email = el.getAttribute('data-lookup-email');
            if (email) uniqueLookups.add(`email:${email}`);
        });

        for (const item of uniqueLookups) {
            const [type, value] = item.split(':');
            resolveName(type, value).then(resolvedName => {
                const selector = type === 'address'
                    ? `[data-lookup-address="${value}"]`
                    : `[data-lookup-email="${value}"]`;
                txList.querySelectorAll(selector).forEach(el => {
                    el.textContent = resolvedName;
                });
            });
        }

        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    } catch (e) {
        console.error("Error fetching transactions:", e);
    }
}