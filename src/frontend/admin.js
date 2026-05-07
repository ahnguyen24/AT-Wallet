const BASE = '/admin';

let adminToken = null; // Bearer token

function el(id) { return document.getElementById(id); }

let adminToastTimeout = null;
function showToast(message, type = 'success') {
  let toast = el('admin-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'admin-toast';
    toast.style = 'fixed; bottom: 20px; left: 50%; transform: translateX(-50%); padding: 12px 24px; border-radius: 8px; color: #fff; font-weight: bold; z-index: 9999; transition: all 0.3s;';
    document.body.appendChild(toast);
  }
  
  if (adminToastTimeout) clearTimeout(adminToastTimeout);
  
  toast.innerText = message;
  toast.style.display = 'block';
  toast.style.background = type === 'success' ? '#10b981' : '#ef4444';
  toast.style.position = 'fixed';
  
  adminToastTimeout = setTimeout(() => { 
    toast.style.display = 'none'; 
    adminToastTimeout = null;
  }, 7000); // Tăng lên 7 giây cho thong thả
}

function setMsg(message, type = 'success') {
  showToast(message, type);
}

function authHeaders() {
  const headers = {};
  if (adminToken) headers['Authorization'] = 'Bearer ' + adminToken;
  return headers;
}

// Định nghĩa màu sắc và nhãn theo Trust Score Rule
function getTrustStyle(score) {
  if (score <= 5.0) return { label: "Danger", color: "#fee2e2", textColor: "#991b1b" }; // Đỏ nhạt
  if (score <= 7.5) return { label: "Warning", color: "#ffedd5", textColor: "#9a3412" }; // Cam nhạt
  if (score <= 9.0) return { label: "Normal", color: "#f3f4f6", textColor: "#374151" };  // Xám nhạt
  return { label: "Excellent", color: "#dcfce7", textColor: "#166534" };               // Xanh nhạt
}

async function fetchTx(status) {
  try {
    const url = status ? `${BASE}/transactions?status=${encodeURIComponent(status)}` : `${BASE}/transactions`;
    const r = await fetch(url, { headers: authHeaders() });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    renderTx(data);
  } catch (e) { setMsg('Error loading transactions: ' + e.message); }
}

function renderTx(rows) {
  const tbody = el('tx-table').querySelector('tbody');
  tbody.innerHTML = '';
  rows.forEach(t => {
    const tr = document.createElement('tr');
    const senderDisplay = t.sender_username || t.sender_id;
    
    tr.innerHTML = `
      <td>${t.id}</td>
      <td>${senderDisplay}</td>
      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">${t.receiver}</td>
      <td>${t.amount} SOL</td>
      <td class="actions-cell"></td>
    `;

    const actions = tr.querySelector('.actions-cell');
    // CHỈ hiện nút khi trạng thái là chờ duyệt. Khi đã sang PENDING (đang xử lý) thì ẩn nút.
    if (t.status === 'requires_approval') {
      const btnApprove = document.createElement('button');
      btnApprove.innerText = 'Approve';
      btnApprove.className = 'primary';
      btnApprove.onclick = () => handleAction(t.id, 'approve');

      const btnReject = document.createElement('button');
      btnReject.innerText = 'Reject';
      btnReject.className = 'danger';
      btnReject.style.marginLeft = '5px';
      btnReject.onclick = () => handleAction(t.id, 'reject');

      actions.appendChild(btnApprove);
      actions.appendChild(btnReject);
    } else {
      actions.innerText = '-';
    }
    tbody.appendChild(tr);
  });
}

// CẬP NHẬT: Gửi JSON object để tránh lỗi 422
async function handleAction(txId, actionName) {
  try {
    const r = await fetch(`${BASE}/transactions/${txId}/approve`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: actionName }) // Gửi object thay vì string
    });

    if (!r.ok) {
      const err = await r.json();
      showToast("Action failed: " + (err.detail[0]?.msg || JSON.stringify(err.detail)), 'error');
      return;
    }

    showToast(`Transaction ${txId} has been ${actionName}ed.`, 'success');
    fetchTx(); 
    fetchWallets(); // Cập nhật lại điểm số ở bảng ví
  } catch (e) {
    showToast("Error: " + e.message, 'error');
  }
}

async function fetchWallets() {
  try {
    const r = await fetch(`${BASE}/wallets`, { headers: authHeaders() });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    const tbody = el('wallet-table').querySelector('tbody');
    tbody.innerHTML = '';
    data.forEach(w => {
      const style = getTrustStyle(w.trust_score);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${w.user_id}</td>
        <td>${w.username}</td>
        <td>
          <span style="background:${style.color}; color:${style.textColor}; padding:4px 8px; border-radius:4px; font-weight:bold">
            ${style.label} (${w.trust_score.toFixed(2)})
          </span>
        </td>
        <td><small>${w.wallet_address}</small></td>
        <td>${w.balance.toFixed(4)} SOL</td>
        <td>
          <input type="number" id="amt-${w.user_id}" placeholder="Amt" step="0.1" style="width:60px">
          <button class="primary" onclick="creditWallet(${w.user_id})">Add</button>
          ${w.trust_score <= 5.0 ? `<button class="danger" onclick="unblockUser(${w.user_id})">Unblock</button>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) { console.error(e); }
}

async function creditWallet(userId) {
  const amount = parseFloat(el(`amt-${userId}`).value);
  if (isNaN(amount) || amount <= 0) return showToast("Invalid amount", 'error');
  try {
    const r = await fetch(`${BASE}/wallets/${userId}/credit`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount })
    });
    if (r.ok) {
      showToast(`Credited ${amount} to user ${userId}`, 'success');
      fetchWallets();
    }
  } catch (e) { showToast(e.message, 'error'); }
}

async function unblockUser(userId) {
  try {
    const r = await fetch(`${BASE}/users/${userId}/unblock`, {
      method: 'POST',
      headers: authHeaders()
    });
    if (r.ok) {
      showToast(`User ${userId} unblocked successfully!`, 'success');
      fetchWallets();
    }
  } catch (e) { showToast(e.message, 'error'); }
}

async function fetchComplaints() {
  try {
    const r = await fetch(`${BASE}/complaints`, { headers: authHeaders() });
    const data = await r.json();
    const tbody = el('complaint-table').querySelector('tbody');
    tbody.innerHTML = '';
    data.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${c.id}</td><td>${c.description}</td><td>${c.created_at}</td>`;
      tbody.appendChild(tr);
    });
  } catch (e) { console.error(e); }
}

// --- Auth & Init ---
function setAdminLoggedIn(user) {
  // Kiểm tra phần tử trước khi set style để tránh crash
  const loginBox = el('admin-login-box');
  if (loginBox) loginBox.style.display = 'none';

  const adminSec = el('admin-section');
  if (adminSec) adminSec.style.display = 'block';

  const walletSec = el('wallet-section');
  if (walletSec) walletSec.style.display = 'block';

  const complaintSec = el('complaint-section');
  if (complaintSec) complaintSec.style.display = 'block';

  setMsg(`Logged in as admin: ${user}`);
  fetchTx();
  fetchWallets();
  fetchComplaints();
}

function adminLogout() {
  adminToken = null;
  localStorage.removeItem('admin_token');
  location.reload();
}

el('admin-login').onclick = async () => {
  const user = el('admin-user').value;
  const pass = el('admin-pass').value;
  try {
    const r = await fetch(`/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });
    if (!r.ok) { setMsg('Login failed'); return; }
    const j = await r.json();
    adminToken = j.access_token;
    localStorage.setItem('admin_token', adminToken);
    setAdminLoggedIn(user);
  } catch (e) { setMsg('Login error'); }
};

// Auto-login if token exists
const savedToken = localStorage.getItem('admin_token');
if (savedToken) {
  adminToken = savedToken;
  setAdminLoggedIn('Session');
}

// Wire events
if (el('btn-all')) el('btn-all').onclick = () => fetchTx();
if (el('btn-pending')) el('btn-pending').onclick = () => fetchTx('pending');
if (el('btn-requires')) el('btn-requires').onclick = () => fetchTx('requires_approval');
if (el('refresh-wallets')) el('refresh-wallets').onclick = () => { 
    fetchTx(); 
    fetchWallets(); 
    fetchComplaints(); 
    showToast('Dữ liệu đã được làm mới thành công!'); 
};
if (el('admin-logout')) el('admin-logout').onclick = adminLogout;