const BASE_URL = "/api";
let currentUser = null;
let balancePollId = null;
let trustChart = null;
let lastKnownTxCount = -1;

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
    console.log("Đang tải dữ liệu biểu đồ...");
    try {
        const res = await fetch(`${BASE_URL}/user/trust-history`, {
            headers: { Authorization: `Bearer ${currentUser.token}` }
        });
        if (!res.ok) {
            console.warn("Chưa có dữ liệu lịch sử Trust Score hoặc API chưa hỗ trợ.");
            return;
        }
        const history = await res.json();
        if (history.length === 0) return;

        const labels = history.map(h => new Date(h.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        const data = history.map(h => h.score_after);

        const chartEl = document.getElementById('trustChart');
        if (!chartEl) return;
        const ctx = chartEl.getContext('2d');

        if (trustChart) {
            trustChart.data.labels = labels;
            trustChart.data.datasets[0].data = data;
            trustChart.update();
        } else {
            // @ts-ignore
            trustChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Trust Score',
                        data: data,
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
    } catch (e) {
        console.error("Lỗi vẽ biểu đồ:", e);
    }
}

// --- AUTHENTICATION ---
async function handleAuth(type) {
    const usernameEl = document.getElementById('username');
    const passwordEl = document.getElementById('password');

    if (!usernameEl || !passwordEl) return;

    const username = usernameEl.value;
    const password = passwordEl.value;

    if (!username || !password) return showToast("Vui lòng điền đủ thông tin", "error");

    const endpoint = type === 'login' ? '/login' : '/register';
    console.log(`Đang thực hiện ${type}...`);

    try {
        const res = await fetch(`${BASE_URL}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
        });

        const data = await res.json();

        if (res.ok) {
            if (type === 'register') {
                showToast("Đăng ký thành công! Hãy đăng nhập.");
            } else {
                currentUser = { username, token: data.access_token };
                // mark blocked if server reports
                if (data.blocked) currentUser.blocked = true;
                console.log("Đăng nhập thành công, token:", data.access_token, "blocked:", data.blocked);
                if (data.blocked) showToast("Tài khoản bị khóa. Vui lòng gửi khiếu nại.", "error");
                else showToast("Đăng nhập thành công!");
                postLoginSetup(); // Kích hoạt giao diện chính
            }
        } else {
            // If account locked, offer to submit anonymous complaint
            if (res.status === 403 && (data.detail || '').toLowerCase().includes('account locked')) {
                const send = confirm('Tài khoản bị khóa. Bạn muốn gửi khiếu nại tới admin không?');
                if (send) {
                    const msg = prompt('Mô tả vấn đề (ví dụ: Tôi bị khóa sai lý do):');
                    if (msg) {
                        try {
                            const r = await fetch(`${BASE_URL}/complaint/anon`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, message: msg }) });
                            if (r.ok) showToast('Khiếu nại đã gửi'); else showToast('Gửi khiếu nại thất bại', 'error');
                        } catch (e) { showToast('Lỗi gửi khiếu nại', 'error') }
                    }
                }
                return;
            }
            showToast(data.detail || "Sai thông tin đăng nhập", "error");
        }
    } catch (e) {
        console.error("Auth error:", e);
        showToast("Không thể kết nối tới server", "error");
    }
}

// --- GIAO DIỆN SAU ĐĂNG NHẬP (QUAN TRỌNG) ---
function postLoginSetup() {
    console.log("Đang khởi tạo giao diện chính...");

    const authCard = document.getElementById('auth-card');
    const mainApp = document.getElementById('main-app');

    if (authCard && mainApp) {
        authCard.classList.add('hidden');
        authCard.classList.remove('flex');
        document.getElementById('landing-page')?.classList.add('hidden');
        mainApp.classList.remove('hidden');
        mainApp.classList.add('flex');
    } else {
        console.error("Không tìm thấy ID auth-card hoặc main-app trong HTML!");
    }

    // Điền thông tin User
    const nameDisplay = document.getElementById('user-name-display');
    const initialDisplay = document.getElementById('user-initial');

    if (nameDisplay) nameDisplay.innerText = currentUser.username;
    if (initialDisplay) initialDisplay.innerText = currentUser.username[0].toUpperCase();

    // Reset polling và biểu đồ
    updateTrustChart();
    startBalancePolling();
    // if user is blocked, show complaint button
    (async () => {
        try {
            const r = await fetch(`${BASE_URL}/wallet/info`, { headers: { Authorization: `Bearer ${currentUser.token}` } });
            if (!r.ok) return;
            const info = await r.json();
            if (info.trust_score !== undefined && info.trust_score <= 5.0) {
                // create complaint button if not exists
                if (!document.getElementById('complaint-btn')) {
                    const container = document.getElementById('home-screen');
                    if (container) {
                        const btn = document.createElement('button');
                        btn.id = 'complaint-btn';
                        btn.textContent = 'Gửi khiếu nại';
                        btn.className = 'w-full mt-4 py-3 bg-rose-600 text-white font-bold rounded-2xl';
                        btn.onclick = () => { showComplaintPrompt() };
                        container.appendChild(btn);
                    }
                }
            }
        } catch (e) { console.warn('complaint UI check failed', e) }
    })();
}

async function showComplaintPrompt() {
    const msg = prompt('Mô tả vấn đề của bạn (ví dụ: Tài khoản bị khóa do sai lý do):');
    if (!msg) return;
    try {
        const r = await fetch(`${BASE_URL}/complaint`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentUser.token}` }, body: JSON.stringify({ message: msg }) });
        if (r.ok) { showToast('Khiếu nại đã gửi, admin sẽ kiểm tra.'); }
        else { const t = await r.text(); showToast('Gửi khiếu nại thất bại: ' + t, 'error') }
    } catch (e) { showToast('Không thể gửi khiếu nại', 'error') }
}

function startBalancePolling() {
    console.log("Bắt đầu cập nhật số dư định kỳ...");
    if (balancePollId) clearInterval(balancePollId);

    balancePollId = setInterval(async () => {
        if (!currentUser) return;
        try {
            // 1. Cập nhật Balance
            const r = await fetch(`${BASE_URL}/wallet/info`, {
                headers: { Authorization: `Bearer ${currentUser.token}` }
            });
            if (r.ok) {
                const info = await r.json();
                const bal1 = document.getElementById('home-balance');
                const bal2 = document.getElementById('current-balance');
                const tsVal = document.getElementById('trust-score-value');

                if (bal1) bal1.innerText = (info.db_balance || 0).toFixed(4) + ' SOL';
                if (bal2) bal2.innerText = (info.db_balance || 0).toFixed(4) + ' SOL';
                if (tsVal) tsVal.innerText = (info.trust_score || 0).toFixed(1);
            }

            // 2. Check giao dịch mới thành công
            const txR = await fetch(`${BASE_URL}/transactions/history`, {
                headers: { Authorization: `Bearer ${currentUser.token}` }
            });
            if (txR.ok) {
                const txs = await txR.json();
                const currentSuccessCount = txs.filter(t => t.status === 'success').length;

                if (lastKnownTxCount !== -1 && currentSuccessCount > lastKnownTxCount) {
                    showToast("Giao dịch On-chain thành công!", "success");
                    updateTrustChart();
                }
                lastKnownTxCount = currentSuccessCount;
            }
        } catch (e) {
            console.error("Lỗi polling:", e);
        }
    }, 5000);
}

// --- CHUYỂN TAB ---
function switchToHome() {
    // Xóa trắng các ô nhập liệu khi về Home
    if (document.getElementById('recipient')) document.getElementById('recipient').value = "";
    if (document.getElementById('amount')) document.getElementById('amount').value = "";
    if (document.getElementById('tx-password')) document.getElementById('tx-password').value = "";
    document.getElementById('home-screen')?.classList.remove('hidden');
    document.getElementById('trans-screen')?.classList.add('hidden');
    document.getElementById('tab-home')?.classList.add('bg-emerald-800', 'text-white');
    document.getElementById('tab-home')?.classList.remove('hover:bg-emerald-600', 'text-emerald-50');
    document.getElementById('tab-trans')?.classList.remove('bg-emerald-800', 'text-white');
    document.getElementById('tab-trans')?.classList.add('hover:bg-emerald-600', 'text-emerald-50');
}

function switchToTrans() {
    // Xóa trắng các ô nhập liệu khi vào trang Chuyển tiền
    if (document.getElementById('recipient')) document.getElementById('recipient').value = "";
    if (document.getElementById('amount')) document.getElementById('amount').value = "";
    if (document.getElementById('tx-password')) document.getElementById('tx-password').value = "";
    document.getElementById('home-screen')?.classList.add('hidden');
    document.getElementById('trans-screen')?.classList.remove('hidden');
    document.getElementById('tab-trans')?.classList.add('bg-emerald-800', 'text-white');
    document.getElementById('tab-trans')?.classList.remove('hover:bg-emerald-600', 'text-emerald-50');
    document.getElementById('tab-home')?.classList.remove('bg-emerald-800', 'text-white');
    document.getElementById('tab-home')?.classList.add('hover:bg-emerald-600', 'text-emerald-50');
}

async function handleTransfer() {
    const recipient = document.getElementById('recipient').value;
    const amount = document.getElementById('amount').value;
    const password = document.getElementById('tx-password').value;

    if (!recipient || !amount || !password) return showToast("Vui lòng điền đủ thông tin", "error");

    try {
        const res = await fetch(`${BASE_URL}/transfer`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${currentUser.token}`
            },
            // backend accepts either `receiver` or `recipient`
            body: JSON.stringify({ recipient, amount: parseFloat(amount), password }),
        });

        const data = await res.json();
        if (res.ok) {
            if (data.status === "requires_approval") {
                showToast("Giao dịch đang chờ Admin phê duyệt (do rủi ro thấp)", "success");
            } else {
                showToast("Giao dịch đã được gửi lên hệ thống xử lý...");
            }
            document.getElementById('tx-password').value = "";
            switchToHome();
        } else {
            showToast(data.detail || "Giao dịch bị từ chối", "error");
        }
    } catch (e) {
        showToast("Lỗi hệ thống", "error");
    }
}

function handleLogout() {
    location.reload(); // Cách nhanh nhất để reset trạng thái app an toàn
}

function getTrustStatus(score) {
    if (score >= 9.0) return { text: 'Excellent', color: '#10b981' }; // Xanh lá
    if (score >= 7.0) return { text: 'Good', color: '#3b82f6' };      // Xanh dương
    if (score >= 5.0) return { text: 'Normal', color: '#f59e0b' };    // Cam
    return { text: 'Risky', color: '#ef4444' };                       // Đỏ
}

// Khi render bảng ví:
const status = getTrustStatus(w.trust_score);
tr.innerHTML = `
    <td>${w.user_id}</td>
    <td style="color: ${status.color}; font-weight: bold">${status.text} (${w.trust_score.toFixed(1)})</td>
    ...
`;