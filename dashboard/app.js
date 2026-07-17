async function loadRequests() {
  try {
    const response = await fetch('/api/dashboard/requests');
    if (!response.ok) throw new Error('Failed to load requests');
    return await response.json();
  } catch (error) {
    console.error(error);
    return [
      {
        id: 'REQ-1001',
        customer: 'أحمد السالم',
        status: 'جديد',
        stage: 'الخطوة 1',
        updated: 'منذ 5 دقائق',
        badge: 'new'
      },
      {
        id: 'REQ-1002',
        customer: 'سارة القحطاني',
        status: 'قيد المعالجة',
        stage: 'الخطوة 2',
        updated: 'منذ 12 دقيقة',
        badge: 'pending'
      },
      {
        id: 'REQ-1003',
        customer: 'خالد العنزي',
        status: 'مكتمل',
        stage: 'الخطوة 3',
        updated: 'منذ 28 دقيقة',
        badge: ''
      },
      {
        id: 'REQ-1004',
        customer: 'نورا الرشيدي',
        status: 'محظور',
        stage: 'تحتاج مراجعة',
        updated: 'منذ 40 دقيقة',
        badge: 'blocked'
      }
    ];
  }
}

async function renderDashboard() {
  const requests = await loadRequests();
  const totalRequests = requests.length;
  const newRequests = requests.filter((r) => r.badge === 'new').length;
  const processingRequests = requests.filter((r) => r.badge === 'pending').length;
  const completedRequests = requests.filter((r) => r.badge !== 'new' && r.badge !== 'pending' && r.badge !== 'blocked').length;

  document.getElementById('totalRequests').textContent = totalRequests;
  document.getElementById('newRequests').textContent = newRequests;
  document.getElementById('processingRequests').textContent = processingRequests;
  document.getElementById('completedRequests').textContent = completedRequests;

  const tbody = document.getElementById('requestsTableBody');
  tbody.innerHTML = requests
    .map(
      (item) => `
        <tr>
          <td>${item.id}</td>
          <td>${item.customer}</td>
          <td><span class="badge ${item.badge}">${item.status}</span></td>
          <td>${item.stage}</td>
          <td>${item.updated}</td>
        </tr>
      `
    )
    .join('');
}

function updateClock() {
  const el = document.getElementById('currentTime');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
}

window.addEventListener('DOMContentLoaded', async () => {
  await renderDashboard();
  updateClock();
  setInterval(updateClock, 1000);
});
