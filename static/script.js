const BASE_URL = "/api";
let currentUser = null;
let balancePollId = null;
let trustChart = null;

// --- UTILS ---
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.innerText = message;
    toast.className = `fixed bottom-10 left-1/2 -translate-x-1/2 px-8 py-4 rounded-2xl shadow-2xl font-bold text-white transition-all z-50 ${type === 'success' ? 'bg-emerald-500' : 'bg-rose-500'}`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 4000);
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
        const body = type === 'login' 
            ? { email: username, password } 
            : { email: username, password, full_name, phone, cccd, pin };

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
                currentUser = { username, user_id: data.user_id, password };
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

// --- CHUYỂN TAB ---
function switchToHome() {
    if (document.getElementById('recipient')) document.getElementById('recipient').value = "";
    if (document.getElementById('amount')) document.getElementById('amount').value = "";
    if (document.getElementById('tx-pin')) document.getElementById('tx-pin').value = "";

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
    if (document.getElementById('recipient')) document.getElementById('recipient').value = "";
    if (document.getElementById('amount')) document.getElementById('amount').value = "";
    if (document.getElementById('tx-pin')) document.getElementById('tx-pin').value = "";

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
    if (document.getElementById('recipient')) document.getElementById('recipient').value = "";
    if (document.getElementById('amount')) document.getElementById('amount').value = "";
    if (document.getElementById('tx-pin')) document.getElementById('tx-pin').value = "";

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
async function handleTransfer() {
    const recipient = document.getElementById('recipient').value.trim();
    const amount = document.getElementById('amount').value;
    const pin = document.getElementById('tx-pin').value;

    if (!recipient || !amount || !pin) return showToast("Vui lòng điền đủ thông tin", "error");
    if (parseFloat(amount) <= 0) return showToast("Số tiền không hợp lệ", "error");
    if (parseFloat(amount) > 50.0) return showToast("Hạn mức tối đa là 50 SOL cho mỗi giao dịch", "error");
    if (pin.length !== 6 || !/^\d+$/.test(pin)) return showToast("Mã PIN giao dịch phải gồm đúng 6 chữ số", "error");

    try {
        // Gửi giao dịch qua endpoint /api/wallet/transfer
        const res = await fetch(`${BASE_URL}/wallet/transfer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sender_id: currentUser.user_id,
                recipient: recipient,
                amount: parseFloat(amount),
                pin: pin
            }),
        });

        const data = await res.json();
        if (res.ok) {
            showToast(data.message || "Chuyển tiền thành công!");
            document.getElementById('tx-pin').value = "";
            switchToHome();
            fetchWalletInfo(); // Cập nhật số dư ngay lập tức
        } else {
            showToast(data.error || "Giao dịch bị từ chối", "error");
        }
    } catch (e) {
        showToast("Lỗi hệ thống", "error");
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