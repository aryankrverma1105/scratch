/**
 * Sologix Admin - Core Single-Page Application (SPA) Controller
 * Handles:
 * - JWT Authentication & persistence
 * - API request wrapper
 * - Section navigation
 * - Dashboard KPI updates
 * - Office CRUD (Add, Edit, Delete, Toggle Active)
 * - Attendance Management table & search
 * - Employee Management table & search
 * - Audit Logs table & search
 * - IST Live Clock
 */

let currentUser = null;
let currentOffices = [];
let allEmployees = [];
let allAttendance = [];
let allAuditLogs = [];

// ==========================================================================
// API REQUEST HELPER
// ==========================================================================
async function apiRequest(endpoint, method = 'GET', body = null) {
  const token = localStorage.getItem('sologix_admin_token');
  const headers = {
    'Accept': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const options = {
    method,
    headers,
  };
  if (body) {
    options.body = body instanceof FormData ? body : JSON.stringify(body);
  }

  const res = await fetch(endpoint, options);
  if (res.status === 401) {
    // Unauthorized / session expired
    logout();
    throw new Error('Session expired. Please log in again.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data;
}

// ==========================================================================
// TOAST NOTIFICATIONS
// ==========================================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================================================
// AUTHENTICATION
// ==========================================================================
async function checkAuth() {
  const token = localStorage.getItem('sologix_admin_token');
  const savedUser = localStorage.getItem('sologix_admin_user');

  if (!token) {
    showLoginView();
    return;
  }

  try {
    if (savedUser) {
      currentUser = JSON.parse(savedUser);
    }
    // Verify token with backend
    const me = await apiRequest('/api/auth/me');
    currentUser = me.user || currentUser;
    localStorage.setItem('sologix_admin_user', JSON.stringify(currentUser));

    if (currentUser.role !== 'admin' && currentUser.role !== 'super_admin') {
      showToast('Access restricted: Administrator role required', 'error');
      logout();
      return;
    }

    showAppView();
  } catch (err) {
    logout();
  }
}

function showLoginView() {
  document.getElementById('view-login').classList.remove('hidden');
  document.getElementById('view-app').classList.add('hidden');
}

function showAppView() {
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('view-app').classList.remove('hidden');

  // Update user info
  if (currentUser) {
    const nameEl = document.getElementById('current-user-name');
    const emailEl = document.getElementById('current-user-email');
    const avatarEl = document.getElementById('current-user-avatar');
    const badgeEl = document.getElementById('user-role-badge');

    if (nameEl) nameEl.textContent = currentUser.full_name || currentUser.email;
    if (emailEl) emailEl.textContent = currentUser.email || '';
    if (avatarEl) {
      const initials = (currentUser.full_name || currentUser.email || 'AD')
        .split(' ')
        .map(w => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();
      avatarEl.textContent = initials;
    }
    if (badgeEl) {
      badgeEl.textContent = currentUser.role === 'super_admin' ? 'Super Admin' : 'Admin';
    }
  }

  // Load initial data
  loadDashboardStats();
  loadOffices();
  loadPendingReviews();
  startIstClock();
}

function logout() {
  localStorage.removeItem('sologix_admin_token');
  localStorage.removeItem('sologix_admin_user');
  currentUser = null;
  showLoginView();
}

// ==========================================================================
// SECTION SWITCHER
// ==========================================================================
function switchSection(sectionId) {
  // Update nav buttons
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === sectionId);
  });

  // Update sections
  document.querySelectorAll('.content-section').forEach(sec => {
    sec.classList.toggle('active', sec.id === `section-${sectionId}`);
  });

  // Update headers
  const titles = {
    'dashboard': ['Dashboard Overview', 'Real-time attendance, geofences, and field telemetry'],
    'live-map': ['Live Employee Map', 'Real-time location, office boundaries, and status'],
    'reviews': ['Attendance Review Requests', 'Approve or reject outside-geofence check-in requests'],
    'geofencing': ['Geofencing & Office Management', 'Configure multiple office sites, boundaries, and radii'],
    'attendance': ['Attendance Sessions', 'All check-in and checkout events aggregated by calendar date'],
    'employees': ['Employee Directory', 'Search employees by name, view assigned offices and records'],
    'reports': ['Reports & CSV Export', 'Generate and download uncompressed attendance data'],
    'audit-logs': ['System Audit Trail', 'Immutable logs of administrative changes and reviews'],
  };

  const [title, subtitle] = titles[sectionId] || ['Administration', ''];
  const titleEl = document.getElementById('page-title');
  const subtitleEl = document.getElementById('page-subtitle');
  if (titleEl) titleEl.textContent = title;
  if (subtitleEl) subtitleEl.textContent = subtitle;

  // Section specific initializers
  if (sectionId === 'live-map') {
    setTimeout(initLiveMap, 100);
  } else if (sectionId === 'geofencing') {
    setTimeout(initOfficePickerMap, 100);
    loadOffices();
  } else if (sectionId === 'reviews') {
    loadPendingReviews();
  } else if (sectionId === 'attendance') {
    loadAttendance();
  } else if (sectionId === 'employees') {
    loadEmployees();
  } else if (sectionId === 'reports') {
    loadReportPreview();
  } else if (sectionId === 'audit-logs') {
    loadAuditLogs();
  }

  // Close mobile sidebar if open
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.classList.remove('open');
}

// ==========================================================================
// DASHBOARD STATS
// ==========================================================================
async function loadDashboardStats() {
  try {
    const data = await apiRequest('/api/admin/dashboard/stats');
    const s = data.stats || data || {};

    setElText('kpi-total-employees', s.totalEmployees ?? 0);
    setElText('kpi-present-today', s.presentToday ?? 0);
    setElText('kpi-active-sessions', s.activeSessions ?? s.onDutyToday ?? 0);
    setElText('kpi-pending-reviews', s.pendingReviews ?? s.pendingApprovals ?? 0);
    setElText('kpi-outside-geofence', s.outsideGeofence ?? 0);
    setElText('kpi-active-offices', s.activeOffices ?? 0);

    // Render Recent Alerts
    const alertsList = document.getElementById('recent-alerts-list');
    if (alertsList && data.recentAlerts) {
      if (data.recentAlerts.length === 0) {
        alertsList.innerHTML = '<div class="empty-state">No alerts recorded today</div>';
      } else {
        alertsList.innerHTML = data.recentAlerts.map(a => `
          <div style="padding: 10px 0; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <span class="badge ${a.alert_type === 'GEOFENCE_VIOLATION' ? 'badge-warning' : 'badge-danger'}">${a.alert_type}</span>
              <span style="font-size: 13px; font-weight: 600; margin-left: 8px;">${escapeHtml(a.employee_name || a.full_name || 'Employee')}</span>
              <div style="font-size: 12px; color: #94a3b8; margin-top: 2px;">${escapeHtml(a.message || 'Alert triggered')}</div>
            </div>
            <span style="font-size: 11px; color: #64748b;">${escapeHtml(a.created_at_ist || a.created_at || '')}</span>
          </div>
        `).join('');
      }
    }

    // Render Dashboard Offices Mini List
    const offList = document.getElementById('dashboard-offices-list');
    if (offList && data.offices) {
      offList.innerHTML = data.offices.map(o => `
        <div style="padding: 8px 0; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong>${escapeHtml(o.office_name)}</strong>
            <div style="font-size: 11px; color: #94a3b8;">Radius: ${o.radius_meters}m • ${escapeHtml(o.address || 'Coordinates set')}</div>
          </div>
          <span class="badge ${o.status === 'active' ? 'badge-success' : 'badge-neutral'}">${o.status}</span>
        </div>
      `).join('');
    }

  } catch (err) {
    console.error('Failed to load dashboard stats:', err);
  }
}

function setElText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ==========================================================================
// GEOFENCING & OFFICE MANAGEMENT
// ==========================================================================
async function loadOffices() {
  const container = document.getElementById('offices-list-container');
  if (!container) return;

  try {
    const data = await apiRequest('/api/admin/offices');
    currentOffices = data.offices || [];

    const badge = document.getElementById('offices-total-badge');
    if (badge) badge.textContent = `${currentOffices.length} Office(s)`;

    if (currentOffices.length === 0) {
      container.innerHTML = `<div class="empty-state p-4 text-center text-muted">No office locations configured yet. Add one using the form.</div>`;
      return;
    }

    container.innerHTML = currentOffices.map(off => `
      <div class="office-list-item">
        <div>
          <div class="office-item-title">
            <span>${escapeHtml(off.office_name)}</span>
            <span class="badge ${off.status === 'active' ? 'badge-success' : 'badge-neutral'}">${off.status}</span>
          </div>
          <div class="office-item-address">${escapeHtml(off.address || 'No address provided')}</div>
          <div class="office-item-meta">
            <span><strong>Radius:</strong> ${off.radius_meters} m</span>
            <span><strong>Coords:</strong> ${parseFloat(off.latitude).toFixed(4)}, ${parseFloat(off.longitude).toFixed(4)}</span>
            ${off.description ? `<span><strong>Notes:</strong> ${escapeHtml(off.description)}</span>` : ''}
          </div>
        </div>
        <div class="office-actions-bar">
          <button class="btn btn-secondary btn-sm" onclick="editOffice(${off.id})">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteOffice(${off.id}, '${escapeHtml(off.office_name)}')">Delete</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load offices:', err);
    container.innerHTML = `<div class="text-red p-4">Error loading offices: ${escapeHtml(err.message)}</div>`;
  }
}

function editOffice(id) {
  const off = currentOffices.find(o => o.id === id);
  if (!off) return;

  document.getElementById('office-id').value = off.id;
  document.getElementById('office-name').value = off.office_name;
  document.getElementById('office-address').value = off.address || '';
  document.getElementById('office-lat').value = off.latitude;
  document.getElementById('office-lng').value = off.longitude;
  document.getElementById('office-radius').value = off.radius_meters || 150;
  document.getElementById('radius-val-display').textContent = `${off.radius_meters || 150} m`;
  document.getElementById('office-description').value = off.description || '';
  document.getElementById('office-is-active').checked = off.status === 'active';

  document.getElementById('office-form-title').textContent = `Edit Office: ${off.office_name}`;
  document.getElementById('office-form-cancel-btn').classList.remove('hidden');

  setPickerMapCoords(off.latitude, off.longitude, off.radius_meters);
}

function resetOfficeForm() {
  document.getElementById('office-id').value = '';
  document.getElementById('office-editor-form').reset();
  document.getElementById('radius-val-display').textContent = '150 m';
  document.getElementById('office-radius').value = 150;
  document.getElementById('office-is-active').checked = true;

  document.getElementById('office-form-title').textContent = 'Add New Office Location';
  document.getElementById('office-form-cancel-btn').classList.add('hidden');
}

async function handleOfficeSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('office-id').value;
  const name = document.getElementById('office-name').value.trim();
  const address = document.getElementById('office-address').value.trim();
  const lat = parseFloat(document.getElementById('office-lat').value);
  const lng = parseFloat(document.getElementById('office-lng').value);
  const radius = parseFloat(document.getElementById('office-radius').value);
  const desc = document.getElementById('office-description').value.trim();
  const isActive = document.getElementById('office-is-active').checked;

  if (!name || isNaN(lat) || isNaN(lng) || isNaN(radius)) {
    showToast('Please fill all required office fields with valid values', 'error');
    return;
  }

  const payload = {
    office_name: name,
    address,
    latitude: lat,
    longitude: lng,
    radius_meters: radius,
    description: desc,
    status: isActive ? 'active' : 'inactive',
  };

  try {
    if (id) {
      await apiRequest(`/api/admin/offices/${id}`, 'PUT', payload);
      showToast(`Office "${name}" updated successfully`, 'success');
    } else {
      await apiRequest('/api/admin/offices', 'POST', payload);
      showToast(`Office "${name}" created successfully`, 'success');
    }
    resetOfficeForm();
    loadOffices();
    loadDashboardStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteOffice(id, name) {
  if (!confirm(`Are you sure you want to delete or deactivate "${name}"?`)) return;

  try {
    const res = await apiRequest(`/api/admin/offices/${id}`, 'DELETE');
    showToast(res.message || 'Office removed', 'success');
    loadOffices();
    loadDashboardStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================================================
// ATTENDANCE SESSIONS MANAGEMENT
// ==========================================================================
async function loadAttendance() {
  const tbody = document.getElementById('attendance-table-body');
  const dateInput = document.getElementById('attendance-date-filter');
  if (!tbody) return;

  const dateFilter = dateInput && dateInput.value ? dateInput.value : '';

  try {
    const endpoint = dateFilter ? `/api/admin/attendance?date=${dateFilter}` : '/api/admin/attendance';
    const data = await apiRequest(endpoint);
    allAttendance = data.records || [];
    renderAttendanceTable(allAttendance);
  } catch (err) {
    console.error('Failed to load attendance:', err);
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-red p-4">Error loading attendance: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderAttendanceTable(list) {
  const tbody = document.getElementById('attendance-table-body');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center p-4 text-muted">No attendance sessions found.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(item => {
    let geofenceBadge = '<span class="badge badge-success">Inside</span>';
    if (item.geofence_status === 'outside') {
      geofenceBadge = '<span class="badge badge-warning">Outside</span>';
    }

    let reviewBadge = '<span class="badge badge-success">Approved</span>';
    if (item.review_status === 'pending_review') {
      reviewBadge = '<span class="badge badge-warning">Pending Review</span>';
    } else if (item.review_status === 'rejected') {
      reviewBadge = '<span class="badge badge-danger">Rejected</span>';
    }

    const isCell = item.location_source === 'CELL_NETWORK' || item.location_source === 'CELL_TOWER' || ((item.check_in_accuracy || item.distance_from_office) > 100);
    const methodBadge = isCell
      ? '<span class="badge badge-warning" style="font-size:10px;">🗼 Cell Tower</span>'
      : '<span class="badge badge-success" style="font-size:10px;">🛰️ GPS</span>';

    return `
      <tr>
        <td>
          <strong>${escapeHtml(item.employee_name || item.full_name || 'Employee')}</strong>
          <div class="text-xs text-muted">ID: ${item.employee_id || item.user_id || 'N/A'} | ${escapeHtml(item.department || 'General')}</div>
        </td>
        <td>${escapeHtml(item.check_in_time_ist || item.check_in_time || 'N/A')}</td>
        <td>${escapeHtml(item.check_out_time_ist || item.check_out_time || (item.status === 'present' ? 'Active Session' : 'N/A'))}</td>
        <td>${geofenceBadge}</td>
        <td>${reviewBadge}</td>
        <td>
          <div>${methodBadge}</div>
          ${item.distance_from_office ? `<div class="text-xs text-muted" style="margin-top:2px;">${Math.round(item.distance_from_office)}m from site</div>` : ''}
          ${item.check_in_accuracy ? `<div class="text-xs text-muted">Acc: ±${Math.round(item.check_in_accuracy)}m</div>` : ''}
        </td>
        <td>${escapeHtml(item.office_name || 'General')}</td>
      </tr>
    `;
  }).join('');
}

// ==========================================================================
// EMPLOYEE MANAGEMENT
// ==========================================================================
async function loadEmployees() {
  const tbody = document.getElementById('employees-table-body');
  if (!tbody) return;

  try {
    const data = await apiRequest('/api/admin/users');
    allEmployees = data.employees || data.users || [];
    renderEmployeesTable(allEmployees);
  } catch (err) {
    console.error('Failed to load employees:', err);
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-red p-4">Error loading employees: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderEmployeesTable(list) {
  const tbody = document.getElementById('employees-table-body');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center p-4 text-muted">No employees found.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(emp => {
    let apkBadge = '<span class="badge badge-neutral">v1.0 (Not reported)</span>';
    if (emp.app_version) {
      apkBadge = `<span class="badge badge-info" style="font-family: monospace;">v${escapeHtml(emp.app_version)}${emp.app_build_number ? ` (${escapeHtml(emp.app_build_number)})` : ''}</span>`;
    }

    const deviceText = emp.device_model || emp.device_os
      ? `<div><strong>${escapeHtml(emp.device_model || 'Android')}</strong></div><div class="text-xs text-muted">${escapeHtml(emp.device_os || '')}</div>`
      : '<span class="text-xs text-muted">N/A</span>';

    return `
      <tr>
        <td>#${emp.id}</td>
        <td><strong>${escapeHtml(emp.full_name)}</strong></td>
        <td>
          <div>${escapeHtml(emp.email)}</div>
          <div class="text-xs text-muted">${escapeHtml(emp.phone || emp.phone_number || '')}</div>
        </td>
        <td>${escapeHtml(emp.department || 'General')}</td>
        <td><span class="badge badge-info">${emp.role}</span></td>
        <td>${apkBadge}</td>
        <td>${deviceText}</td>
        <td>
          <span class="badge ${emp.is_active ? 'badge-success' : 'badge-danger'}">
            ${emp.is_active ? 'Active' : 'Inactive'}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

// ==========================================================================
// AUDIT LOGS
// ==========================================================================
async function loadAuditLogs() {
  const tbody = document.getElementById('audit-table-body');
  if (!tbody) return;

  try {
    const data = await apiRequest('/api/admin/audit-logs?limit=100');
    allAuditLogs = data.logs || [];
    renderAuditLogsTable(allAuditLogs);
  } catch (err) {
    console.error('Failed to load audit logs:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-red p-4">Error loading audit logs: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderAuditLogsTable(list) {
  const tbody = document.getElementById('audit-table-body');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center p-4 text-muted">No audit logs recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(log => `
    <tr>
      <td class="text-xs">${escapeHtml(log.created_at_ist || log.created_at)}</td>
      <td>
        <strong>${escapeHtml(log.user_name || 'System')}</strong>
        <div class="text-xs text-muted">${log.role || ''}</div>
      </td>
      <td><span class="badge badge-info">${escapeHtml(log.action)}</span></td>
      <td><span class="badge badge-neutral">${escapeHtml(log.module || 'system')}</span></td>
      <td class="text-sm">${escapeHtml(log.details || '-')}</td>
      <td><span class="badge ${log.status === 'failed' ? 'badge-danger' : 'badge-success'}">${log.status}</span></td>
    </tr>
  `).join('');
}

// ==========================================================================
// LIVE IST CLOCK
// ==========================================================================
function startIstClock() {
  const clockEl = document.getElementById('live-ist-clock');
  if (!clockEl) return;

  const update = () => {
    const now = new Date();
    // Format in Asia/Kolkata
    const istString = now.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: true,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    clockEl.textContent = `${istString} IST`;
  };
  update();
  setInterval(update, 1000);
}

// ==========================================================================
// EVENT LISTENERS INITIALIZATION
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Login Form
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const errorDiv = document.getElementById('login-error');
      const submitBtn = document.getElementById('login-btn');

      if (errorDiv) errorDiv.classList.add('hidden');
      if (submitBtn) submitBtn.disabled = true;

      try {
        const res = await apiRequest('/api/auth/login', 'POST', {
          identifier: email,
          email: email,
          password: password,
        });
        localStorage.setItem('sologix_admin_token', res.token);
        localStorage.setItem('sologix_admin_user', JSON.stringify(res.user));
        currentUser = res.user;

        if (currentUser.role !== 'admin' && currentUser.role !== 'super_admin') {
          throw new Error('Access denied. Administrator privileges are required.');
        }

        showAppView();
      } catch (err) {
        if (errorDiv) {
          errorDiv.textContent = err.message || 'Login failed';
          errorDiv.classList.remove('hidden');
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  // Navigation Items
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      switchSection(btn.dataset.section);
    });
  });

  // Mobile Sidebar Toggle
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const closeBtn = document.getElementById('sidebar-close-btn');
  const sidebar = document.querySelector('.sidebar');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
  }
  if (closeBtn && sidebar) {
    closeBtn.addEventListener('click', () => sidebar.classList.remove('open'));
  }

  // Refresh Button
  const refreshBtn = document.getElementById('refresh-data-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      showToast('Refreshing live data...', 'info');
      loadDashboardStats();
      loadPendingReviews();
      refreshLiveMapData();
    });
  }

  // Office Editor Form
  const officeForm = document.getElementById('office-editor-form');
  if (officeForm) officeForm.addEventListener('submit', handleOfficeSubmit);

  const cancelEditBtn = document.getElementById('office-form-cancel-btn');
  if (cancelEditBtn) cancelEditBtn.addEventListener('click', resetOfficeForm);

  // Attendance Date Filter & Search
  const attDate = document.getElementById('attendance-date-filter');
  if (attDate) attDate.addEventListener('change', loadAttendance);

  const attSearch = document.getElementById('attendance-search-input');
  if (attSearch) {
    attSearch.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = allAttendance.filter(a =>
        (a.employee_name && a.employee_name.toLowerCase().includes(q)) ||
        String(a.employee_id).includes(q)
      );
      renderAttendanceTable(filtered);
    });
  }

  // Employee Search
  const empSearch = document.getElementById('employee-search-input');
  if (empSearch) {
    empSearch.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = allEmployees.filter(emp =>
        (emp.full_name && emp.full_name.toLowerCase().includes(q)) ||
        (emp.email && emp.email.toLowerCase().includes(q)) ||
        (emp.phone_number && emp.phone_number.includes(q)) ||
        String(emp.id).includes(q)
      );
      renderEmployeesTable(filtered);
    });
  }

  // Audit Logs Search
  const auditSearch = document.getElementById('audit-search-input');
  if (auditSearch) {
    auditSearch.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = allAuditLogs.filter(l =>
        (l.action && l.action.toLowerCase().includes(q)) ||
        (l.user_name && l.user_name.toLowerCase().includes(q)) ||
        (l.details && l.details.toLowerCase().includes(q))
      );
      renderAuditLogsTable(filtered);
    });
  }

  // Check existing session
  checkAuth();
});

