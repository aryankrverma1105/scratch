/**
 * Sologix Admin - Outside-Geofence Attendance Review Module
 */

let pendingReviews = [];
let activeRejectId = null;

async function loadPendingReviews() {
  const tbody = document.getElementById('pending-reviews-table-body');
  if (!tbody) return;

  try {
    const data = await apiRequest('/api/admin/attendance-reviews/pending');
    pendingReviews = data.reviews || [];

    // Update badges
    const countBadge = document.getElementById('pending-reviews-count');
    const kpiBadge = document.getElementById('kpi-pending-reviews');

    if (countBadge) {
      countBadge.textContent = pendingReviews.length;
      countBadge.classList.toggle('hidden', pendingReviews.length === 0);
    }
    if (kpiBadge) {
      kpiBadge.textContent = pendingReviews.length;
    }

    renderPendingReviewsTable(pendingReviews);
  } catch (err) {
    console.error('Failed to load pending reviews:', err);
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-red p-4">Error loading reviews: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderPendingReviewsTable(list) {
  const tbody = document.getElementById('pending-reviews-table-body');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center p-4 text-muted">No pending outside-geofence reviews. All attendance is verified!</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(item => {
    const distanceMeters = item.distance_from_office ? Math.round(item.distance_from_office) : 'Unknown';
    const radiusMeters = item.office_radius ? item.office_radius : 100;
    const accuracy = (item.accuracy_meters || item.check_in_accuracy) ? `${Math.round(item.accuracy_meters || item.check_in_accuracy)}m` : 'N/A';
    const source = item.location_source || 'GPS';
    const battery = (item.battery_percentage !== null && item.battery_percentage !== undefined) ? `${item.battery_percentage}%` : 'N/A';
    const rawSelfie = item.selfie_path || item.check_in_selfie;
    const cleanSelfieName = rawSelfie ? rawSelfie.split('/').pop().split('\\').pop() : null;
    const token = localStorage.getItem('sologix_admin_token') || '';
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
    const selfieUrl = cleanSelfieName ? `/api/files/selfies/${cleanSelfieName}${tokenQuery}` : null;
    const appVer = item.user_app_version || item.app_version;

    const isCellTower = source === 'CELL_NETWORK' || source === 'CELL_TOWER' || ((item.accuracy_meters || item.check_in_accuracy) > 100);
    const methodBadge = isCellTower
      ? '<span class="badge badge-warning" style="font-size:10px;">🗼 Cell Tower</span>'
      : '<span class="badge badge-success" style="font-size:10px;">🛰️ Location Services (GPS)</span>';

    return `
      <tr>
        <td>
          <div class="d-flex align-center gap-2">
            <div>
              <strong>${escapeHtml(item.employee_name || 'Employee')}</strong>
              <div class="text-xs text-muted">ID: ${item.employee_id || item.user_id || 'N/A'} | ${escapeHtml(item.department || item.employee_department || 'General')}</div>
            </div>
          </div>
        </td>
        <td>
          <div>${escapeHtml(item.check_in_time_ist || item.check_in_time || 'N/A')}</div>
          <span class="badge badge-warning">Outside Office</span>
        </td>
        <td>
          <div><strong>${escapeHtml(item.office_name || 'No assigned office')}</strong></div>
          <div class="text-xs text-red font-bold">${distanceMeters}m away (Permitted: ${radiusMeters}m)</div>
        </td>
        <td>
          ${selfieUrl ? `
            <div style="position: relative; width: 44px; height: 44px;">
              <img src="${selfieUrl}" alt="Selfie" style="width: 44px; height: 44px; border-radius: 6px; object-fit: cover; cursor: pointer; border: 1px solid #334155;"
                   onclick="openSelfieModal('${selfieUrl}', '${escapeHtml(item.employee_name)}')"
                   onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
              <div style="display: none; width: 44px; height: 44px; border-radius: 6px; background: #1e293b; border: 1px solid #334155; align-items: center; justify-content: center; font-size: 10px; color: #94a3b8; text-align: center;">📷 Photo</div>
            </div>
          ` : '<span class="text-xs text-muted">No selfie</span>'}
        </td>
        <td>
          <div class="text-xs">
            <div style="margin-bottom: 3px;"><strong>Method:</strong> ${methodBadge}</div>
            <div><strong>Accuracy:</strong> ${accuracy}</div>
            <div><strong>Battery:</strong> ${battery}</div>
            ${appVer ? `<div style="margin-top:2px;"><span class="badge badge-info" style="font-size:9.5px; font-family:monospace;">APK v${escapeHtml(appVer)}</span></div>` : ''}
          </div>
        </td>
        <td>
          <span class="text-xs text-muted">${escapeHtml(item.outside_reason || item.review_reason || 'No reason provided')}</span>
        </td>
        <td>
          <div class="d-flex gap-1">
            <button class="btn btn-success btn-sm" onclick="approveReview(${item.id})">Approve</button>
            <button class="btn btn-danger btn-sm" onclick="openRejectionModal(${item.id})">Reject</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Approve Attendance Review
async function approveReview(attendanceId) {
  if (!confirm('Approve this outside-geofence check-in? It will be counted as valid payable attendance in salary calculations.')) {
    return;
  }

  try {
    const res = await apiRequest(`/api/admin/attendance-reviews/${attendanceId}/approve`, 'POST', {});
    showToast(res.message || 'Attendance approved successfully', 'success');
    loadPendingReviews();
    loadDashboardStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Rejection Modal
function openRejectionModal(attendanceId) {
  activeRejectId = attendanceId;
  const modal = document.getElementById('modal-rejection');
  const input = document.getElementById('modal-rejection-reason');
  if (input) input.value = '';
  if (modal) modal.classList.remove('hidden');
}

function closeRejectionModal() {
  activeRejectId = null;
  const modal = document.getElementById('modal-rejection');
  if (modal) modal.classList.add('hidden');
}

async function confirmRejection() {
  if (!activeRejectId) return;
  const reasonInput = document.getElementById('modal-rejection-reason');
  const reason = reasonInput ? reasonInput.value.trim() : '';

  if (!reason) {
    alert('A non-empty rejection reason is mandatory.');
    return;
  }

  try {
    const res = await apiRequest(`/api/admin/attendance-reviews/${activeRejectId}/reject`, 'POST', {
      rejection_reason: reason
    });
    showToast(res.message || 'Attendance rejected', 'success');
    closeRejectionModal();
    loadPendingReviews();
    loadDashboardStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Selfie Modal
function openSelfieModal(url, name) {
  const modal = document.getElementById('modal-selfie');
  const img = document.getElementById('modal-selfie-img');
  const title = document.getElementById('modal-selfie-title');
  if (img) {
    img.src = url;
    img.onerror = function() {
      this.alt = 'Selfie photo could not be loaded from storage';
    };
  }
  if (title) title.textContent = `${name} - Check-In Selfie`;
  if (modal) modal.classList.remove('hidden');
}

function closeSelfieModal() {
  const modal = document.getElementById('modal-selfie');
  if (modal) modal.classList.add('hidden');
}

// Attach listeners
document.addEventListener('DOMContentLoaded', () => {
  const confirmRejectBtn = document.getElementById('modal-confirm-reject-btn');
  if (confirmRejectBtn) {
    confirmRejectBtn.addEventListener('click', confirmRejection);
  }

  const searchInput = document.getElementById('reviews-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = pendingReviews.filter(r => 
        (r.employee_name && r.employee_name.toLowerCase().includes(q)) ||
        (r.department && r.department.toLowerCase().includes(q)) ||
        String(r.employee_id).includes(q)
      );
      renderPendingReviewsTable(filtered);
    });
  }
});

