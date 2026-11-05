/**
 * Sologix Admin - Reports & CSV Export Module
 */

async function loadReportPreview() {
  const typeSelect = document.getElementById('report-type-select');
  const startInput = document.getElementById('report-start-date');
  const endInput = document.getElementById('report-end-date');
  const thead = document.getElementById('reports-table-head');
  const tbody = document.getElementById('reports-table-body');

  if (!typeSelect || !tbody) return;

  const type = typeSelect.value;
  const startDate = startInput ? startInput.value : '';
  const endDate = endInput ? endInput.value : '';

  tbody.innerHTML = `<tr><td colspan="8" class="text-center p-4">Generating report preview...</td></tr>`;

  try {
    const params = new URLSearchParams({ type });
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);

    const data = await apiRequest(`/api/admin/reports?${params.toString()}`);
    const rows = data.records || [];

    if (rows.length === 0) {
      thead.innerHTML = `<tr><th>Results</th></tr>`;
      tbody.innerHTML = `<tr><td class="text-center p-4 text-muted">No records found for the selected criteria.</td></tr>`;
      return;
    }

    // Dynamic headers based on columns
    const columns = Object.keys(rows[0]);
    thead.innerHTML = `<tr>${columns.map(c => `<th>${escapeHtml(formatColHeader(c))}</th>`).join('')}</tr>`;

    tbody.innerHTML = rows.map(r => {
      return `<tr>${columns.map(c => `<td>${escapeHtml(String(r[c] !== null && r[c] !== undefined ? r[c] : '-'))}</td>`).join('')}</tr>`;
    }).join('');

  } catch (err) {
    console.error('Failed to load report:', err);
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-red p-4">Report generation failed: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function exportReportCsv() {
  const typeSelect = document.getElementById('report-type-select');
  const startInput = document.getElementById('report-start-date');
  const endInput = document.getElementById('report-end-date');

  const type = typeSelect ? typeSelect.value : 'daily';
  const startDate = startInput ? startInput.value : '';
  const endDate = endInput ? endInput.value : '';

  const params = new URLSearchParams({ type, export: 'csv' });
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);

  const token = localStorage.getItem('sologix_admin_token');
  try {
    showToast('Preparing uncompressed CSV download...', 'info');
    const response = await fetch(`/api/admin/reports?${params.toString()}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error || `Export failed with status ${response.status}`);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sologix_${type}_report_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast('CSV report downloaded successfully', 'success');
  } catch (err) {
    showToast(`CSV Export Error: ${err.message}`, 'error');
  }
}

function formatColHeader(col) {
  return col.replace(/_/g, ' ').toUpperCase();
}

document.addEventListener('DOMContentLoaded', () => {
  const exportBtn = document.getElementById('report-export-csv-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportReportCsv);
  }

  const typeSelect = document.getElementById('report-type-select');
  const startInput = document.getElementById('report-start-date');
  const endInput = document.getElementById('report-end-date');

  if (typeSelect) typeSelect.addEventListener('change', loadReportPreview);
  if (startInput) startInput.addEventListener('change', loadReportPreview);
  if (endInput) endInput.addEventListener('change', loadReportPreview);

  // Set default dates (first day of month to today)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  if (startInput) startInput.value = `${year}-${month}-01`;
  if (endInput) endInput.value = `${year}-${month}-${day}`;
});

