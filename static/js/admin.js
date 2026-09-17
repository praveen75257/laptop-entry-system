// ==========================================================
// CPAT LAPTOP GATE - ADMIN DASHBOARD & RECORDS JAVASCRIPT
// ==========================================================

// Dashboard Stats Loader & Poller
function loadDashboardStats() {
  fetch('/api/dashboard/stats')
    .then(r => r.json())
    .then(data => {
      const elTotal = document.getElementById('totalStudents');
      const elInside = document.getElementById('currentlyInside');
      const elEntries = document.getElementById('todayEntries');
      const elExits = document.getElementById('todayExits');
      const elUpdated = document.getElementById('lastUpdatedTime');

      if (elTotal) elTotal.textContent = data.total_students ?? 0;
      if (elInside) elInside.textContent = data.currently_inside ?? 0;
      if (elEntries) elEntries.textContent = data.today_entries ?? 0;
      if (elExits) elExits.textContent = data.today_exits ?? 0;
      if (elUpdated && data.last_updated) elUpdated.textContent = data.last_updated;

      // Dynamically refresh Currently Inside table
      const tbodyInside = document.getElementById('currentlyInsideTable');
      if (tbodyInside && data.inside_list) {
        if (data.inside_list.length === 0) {
          tbodyInside.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-secondary">No students currently recorded inside campus.</td></tr>';
        } else {
          tbodyInside.innerHTML = data.inside_list.map(s => `
            <tr>
              <td><strong>${s.student_name_snapshot || ''}</strong></td>
              <td><code>${s.registration_number_snapshot || ''}</code></td>
              <td>${s.department_snapshot || ''}</td>
              <td>${s.laptop_name_snapshot || ''}</td>
              <td><span class="badge badge-inside">${s.entry_time_fmt || ''}</span></td>
            </tr>
          `).join('');
        }
      }

      // Dynamically refresh Recent Activity table
      const tbodyRecent = document.getElementById('recentActivity');
      if (tbodyRecent && data.recent_activity) {
        if (data.recent_activity.length === 0) {
          tbodyRecent.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-secondary">No gate movements recorded yet today.</td></tr>';
        } else {
          tbodyRecent.innerHTML = data.recent_activity.map(r => `
            <tr>
              <td><strong>${r.student_name_snapshot || ''}</strong></td>
              <td><code>${r.registration_number_snapshot || ''}</code></td>
              <td>
                <span class="badge ${r.status === 'INSIDE' ? 'badge-inside' : 'badge-outside'}">
                  ${r.status}
                </span>
              </td>
              <td>
                ${r.status === 'INSIDE' 
                  ? `<span class="text-success">${r.entry_time_fmt || ''}</span>` 
                  : `<span class="text-warning">${r.exit_time_fmt || ''}</span>`}
              </td>
            </tr>
          `).join('');
        }
      }
    })
    .catch(err => console.error('Failed to load dashboard stats:', err));
}

// Auto refresh dashboard every 2.5 seconds (2–3s polling specification)
if (document.getElementById('totalStudents')) {
  setInterval(loadDashboardStats, 2500);
}

// ==========================================================
// ENTRY / EXIT RECORDS PAGE (LIVE POLLING & MODERN RENDERING)
// ==========================================================
let recordsPollingTimer = null;
let searchDebounceTimer = null;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function copyRecordId(recordId) {
  if (!recordId) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(recordId)
      .then(() => showToast(`Copied Audit ID: ${recordId.substring(0, 8)}...`, 'info'))
      .catch(() => fallbackCopyText(recordId));
  } else {
    fallbackCopyText(recordId);
  }
}

function fallbackCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
    showToast('Copied Audit ID', 'info');
  } catch (e) {
    showToast('Could not copy Record ID', 'error');
  }
  document.body.removeChild(ta);
}

function setDateFilter(type) {
  const dateInput = document.getElementById('filterDate');
  const btnToday = document.getElementById('btnToday');
  const btnYesterday = document.getElementById('btnYesterday');

  const now = new Date();
  if (type === 'yesterday') {
    now.setDate(now.getDate() - 1);
    if (btnToday) btnToday.classList.remove('active');
    if (btnYesterday) btnYesterday.classList.add('active');
  } else {
    if (btnToday) btnToday.classList.add('active');
    if (btnYesterday) btnYesterday.classList.remove('active');
  }

  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');

  if (dateInput) {
    dateInput.value = `${yyyy}-${mm}-${dd}`;
  }

  applyFilters();
}

function debounceSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(applyFilters, 300);
}

function applyFilters() {
  const dateInput = document.getElementById('filterDate');
  const searchInput = document.getElementById('filterSearch');
  const searchClearBtn = document.getElementById('searchClearBtn');
  const statusSelect = document.getElementById('filterStatus');

  const filters = {};
  if (dateInput && dateInput.value) {
    // format as DD-MM-YYYY
    const p = dateInput.value.split('-');
    if (p.length === 3) {
      filters.date = `${p[2]}-${p[1]}-${p[0]}`;
    }
  }
  if (searchInput && searchInput.value.trim()) {
    filters.search = searchInput.value.trim();
    if (searchClearBtn) searchClearBtn.style.display = 'flex';
  } else {
    if (searchClearBtn) searchClearBtn.style.display = 'none';
  }
  if (statusSelect && statusSelect.value) {
    filters.status = statusSelect.value;
  }

  loadRecords(filters);
}

function loadRecords(filters = {}) {
  const params = new URLSearchParams(filters);
  fetch(`/api/records?${params.toString()}`)
    .then(r => r.json())
    .then(data => {
      const tbody = document.getElementById('recordsTableBody');
      const cardsContainer = document.getElementById('recordsCardsContainer');
      const emptyState = document.getElementById('recordsEmptyState');
      const desktopView = document.querySelector('.records-desktop-view');
      const timeSpan = document.getElementById('lastUpdatedTime');
      const dateLabel = document.getElementById('currentFilterDateLabel');
      const countBadge = document.getElementById('recordsCountBadge');

      if (timeSpan && data.last_updated) {
        timeSpan.textContent = data.last_updated;
      }
      if (dateLabel && data.date) {
        dateLabel.textContent = `Gate security entry and exit activity for ${data.date}`;
      }

      // Update summary metric counters
      if (data.summary) {
        const elTot = document.getElementById('statTotal');
        const elIns = document.getElementById('statInside');
        const elOut = document.getElementById('statOut');
        const elEnt = document.getElementById('statEntries');

        if (elTot) elTot.textContent = data.summary.total ?? 0;
        if (elIns) elIns.textContent = data.summary.inside ?? 0;
        if (elOut) elOut.textContent = data.summary.out ?? 0;
        if (elEnt) elEnt.textContent = data.summary.entries ?? 0;
      }

      const records = data.records || [];
      if (countBadge) {
        countBadge.textContent = `${records.length} Record${records.length === 1 ? '' : 's'}`;
      }

      // Handle Empty State
      if (records.length === 0) {
        if (tbody) tbody.innerHTML = '';
        if (cardsContainer) cardsContainer.innerHTML = '';
        if (desktopView) desktopView.style.display = 'none';
        if (emptyState) emptyState.style.display = 'flex';
        return;
      }

      // Hide empty state and show table
      if (emptyState) emptyState.style.display = 'none';
      if (desktopView) desktopView.style.display = '';

      // 1. Render Desktop Table Rows
      if (tbody) {
        tbody.innerHTML = records.map(r => {
          const isInside = (r.status === 'INSIDE');
          const shortId = (r.record_id || '').substring(0, 8);

          return `
            <tr>
              <!-- STATUS -->
              <td>
                <span class="status-pill ${isInside ? 'inside' : 'out'}">
                  <span class="dot"></span>
                  ${r.status || 'UNKNOWN'}
                </span>
              </td>

              <!-- TIMELINE -->
              <td>
                <div class="timeline-cell">
                  <div class="timeline-row">
                    <span class="timeline-tag in" title="Campus Entry Time">
                      <i class="bi bi-box-arrow-in-right"></i> ${r.entry_time_fmt || '—'}
                    </span>
                    ${r.exit_time_fmt && r.exit_time_fmt !== '—'
                      ? `<span class="timeline-tag out" title="Campus Exit Time"><i class="bi bi-box-arrow-right"></i> ${r.exit_time_fmt}</span>`
                      : '<span class="text-secondary small" style="font-size:0.75rem;">(Active Inside)</span>'
                    }
                  </div>
                  <div class="timeline-date"><i class="bi bi-calendar-event me-1"></i>${r.date_fmt || ''}</div>
                </div>
              </td>

              <!-- STUDENT DETAILS -->
              <td>
                <div class="student-info-cell">
                  <span class="student-name-text">${escapeHtml(r.student_name_snapshot || '')}</span>
                  <div class="student-meta-text">
                    <code>${escapeHtml(r.registration_number_snapshot || '')}</code>
                    <span>&bull;</span>
                    <span>${escapeHtml(r.department_snapshot || '')}</span>
                    <span>(${escapeHtml(r.year_snapshot || '')})</span>
                  </div>
                  <div class="student-phone-text">
                    <i class="bi bi-telephone me-1"></i>${escapeHtml(r.phone_number_snapshot || '')}
                  </div>
                </div>
              </td>

              <!-- EQUIPMENT REGISTERED -->
              <td>
                <div class="equipment-info-cell">
                  <span class="laptop-name-text">${escapeHtml(r.laptop_name_snapshot || '')}</span>
                  <span class="laptop-model-text">${escapeHtml(r.laptop_model_number_snapshot || '')}</span>
                  <span class="badge-qr-ver"><i class="bi bi-qr-code me-1"></i>Pass v${r.qr_version || 1}</span>
                </div>
              </td>

              <!-- AUDIT ID -->
              <td class="text-end">
                <button type="button" class="audit-id-pill" onclick="copyRecordId('${r.record_id}')" title="Click to copy full ID: ${r.record_id}">
                  <i class="bi bi-clipboard me-1"></i><code>${shortId}...</code>
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }

      // 2. Render Mobile Stacked Cards
      if (cardsContainer) {
        cardsContainer.innerHTML = records.map(r => {
          const isInside = (r.status === 'INSIDE');
          const shortId = (r.record_id || '').substring(0, 8);

          return `
            <div class="record-mobile-card ${isInside ? 'inside' : 'out'}">
              <div class="mobile-card-top">
                <div>
                  <span class="status-pill ${isInside ? 'inside' : 'out'} mb-1">
                    <span class="dot"></span> ${r.status || 'UNKNOWN'}
                  </span>
                  <h4 class="student-name-text mt-1 mb-0">${escapeHtml(r.student_name_snapshot || '')}</h4>
                  <div class="student-meta-text mt-1">
                    <code>${escapeHtml(r.registration_number_snapshot || '')}</code>
                    <span>&bull;</span>
                    <span>${escapeHtml(r.department_snapshot || '')} (${escapeHtml(r.year_snapshot || '')})</span>
                  </div>
                </div>
                <button type="button" class="audit-id-pill" onclick="copyRecordId('${r.record_id}')" title="Copy full ID: ${r.record_id}">
                  <i class="bi bi-clipboard me-1"></i><code>${shortId}</code>
                </button>
              </div>

              <div class="mobile-card-timeline">
                <div class="d-flex align-items-center gap-2 flex-wrap">
                  <span class="timeline-tag in"><i class="bi bi-box-arrow-in-right"></i> In: ${r.entry_time_fmt || '—'}</span>
                  <i class="bi bi-arrow-right text-secondary small"></i>
                  ${r.exit_time_fmt && r.exit_time_fmt !== '—'
                    ? `<span class="timeline-tag out"><i class="bi bi-box-arrow-right"></i> Out: ${r.exit_time_fmt}</span>`
                    : '<span class="status-pill inside" style="padding: 2px 7px; font-size: 0.7rem;"><span class="dot"></span> Inside</span>'
                  }
                </div>
                <div class="ms-auto timeline-date">${r.date_fmt || ''}</div>
              </div>

              <div class="mobile-card-details">
                <div>
                  <span class="text-secondary" style="font-size:0.7rem; font-weight:700;">EQUIPMENT</span>
                  <div class="laptop-name-text" style="font-size:0.84rem;">${escapeHtml(r.laptop_name_snapshot || '')}</div>
                  <div class="text-muted" style="font-size:0.72rem;">${escapeHtml(r.laptop_model_number_snapshot || '')}</div>
                  <span class="badge-qr-ver"><i class="bi bi-qr-code me-1"></i>Pass v${r.qr_version || 1}</span>
                </div>
                <div>
                  <span class="text-secondary" style="font-size:0.7rem; font-weight:700;">CONTACT</span>
                  <div class="text-white" style="font-size:0.84rem;"><i class="bi bi-telephone me-1"></i>${escapeHtml(r.phone_number_snapshot || '')}</div>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }

    })
    .catch(err => {
      console.error('Failed to load records:', err);
    });
}

function startRecordsLivePolling() {
  if (recordsPollingTimer) clearInterval(recordsPollingTimer);
  recordsPollingTimer = setInterval(applyFilters, 2500);
}

// ==========================================================
// QR CODE DOWNLOAD & PRINT
// ==========================================================
function downloadQR(regNumber) {
  window.location.href = `/api/qr-download/${encodeURIComponent(regNumber)}`;
}

function printQR() {
  window.print();
}

// Students Management
function loadStudents(search = '') {
  fetch(`/api/students?search=${encodeURIComponent(search)}`)
    .then(r => r.json())
    .then(data => {
      const tbody = document.getElementById('studentsTableBody');
      const cardsView = document.getElementById('studentsCardsView');
      if (!tbody) return;

      const students = Array.isArray(data) ? data : (data.students || []);

      if (students.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No active students found</td></tr>';
        if (cardsView) cardsView.innerHTML = '<div class="empty-state">No active students found</div>';
        return;
      }

      // Table view
      tbody.innerHTML = students.map(s => {
        const name = s.student_name || s.Student_Name || '';
        const reg = s.registration_number || s.Registration_Number || '';
        const dept = s.department || s.Department || '';
        const yr = s.year || s.Year || '';
        const phone = s.phone_number || s.Phone_Number || '';
        const lapName = s.laptop_name || s.Laptop_Name || '';
        const lapModel = s.laptop_model_number || s.Laptop_Model_Number || '';

        return `
        <tr>
          <td><strong>${name}</strong></td>
          <td><code>${reg}</code></td>
          <td>${dept}</td>
          <td>${yr}</td>
          <td>${phone}</td>
          <td>${lapName} <small style="color:var(--text-secondary);">(${lapModel})</small></td>
          <td class="actions-cell">
            <a href="/admin/generate-qr/${encodeURIComponent(reg)}" class="btn btn-sm btn-primary" title="View & Print QR">QR Code</a>
            <a href="/admin/students/edit/${encodeURIComponent(reg)}" class="btn btn-sm btn-secondary" title="Edit Student">Edit</a>
            <button onclick="deactivateStudent('${encodeURIComponent(reg)}', '${name.replace(/'/g, "\\'")}')" class="btn btn-sm btn-danger" title="Deactivate">Deactivate</button>
          </td>
        </tr>
      `}).join('');

      // Cards view for mobile
      if (cardsView) {
        cardsView.innerHTML = students.map(s => {
          const name = s.student_name || s.Student_Name || '';
          const reg = s.registration_number || s.Registration_Number || '';
          const dept = s.department || s.Department || '';
          const yr = s.year || s.Year || '';
          const phone = s.phone_number || s.Phone_Number || '';
          const lapName = s.laptop_name || s.Laptop_Name || '';
          const lapModel = s.laptop_model_number || s.Laptop_Model_Number || '';

          return `
          <div class="card student-card" style="margin-bottom: 12px;">
            <div class="card-body">
              <h4 style="margin-bottom: 6px; color: var(--accent-blue);">${name}</h4>
              <p style="font-size: 0.9rem; margin-bottom: 4px;"><strong>Reg:</strong> <code>${reg}</code> | ${dept} (${yr})</p>
              <p style="font-size: 0.85rem; margin-bottom: 4px;"><strong>Phone:</strong> ${phone}</p>
              <p style="font-size: 0.85rem; margin-bottom: 12px;"><strong>Laptop:</strong> ${lapName} (${lapModel})</p>
              <div class="card-actions" style="display: flex; gap: 8px;">
                <a href="/admin/generate-qr/${encodeURIComponent(reg)}" class="btn btn-sm btn-primary">QR Code</a>
                <a href="/admin/students/edit/${encodeURIComponent(reg)}" class="btn btn-sm btn-secondary">Edit</a>
                <button onclick="deactivateStudent('${encodeURIComponent(reg)}', '${name.replace(/'/g, "\\'")}')" class="btn btn-sm btn-danger">Deactivate</button>
              </div>
            </div>
          </div>
        `}).join('');
      }
    })
    .catch(err => console.error('Failed to load students:', err));
}

function searchStudents() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    loadStudents(searchInput.value);
  }
}

function deactivateStudent(regNumber, studentName) {
  if (!confirm(`Are you sure you want to change status for student ${studentName || regNumber}? Historical movement records will be preserved.`)) return;

  fetch(`/admin/students/deactivate/${encodeURIComponent(regNumber)}`, { 
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest' }
  })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showToast(data.message || `Student ${regNumber} status changed successfully`, 'success');
        if (typeof loadStudents === 'function') loadStudents();
        else window.location.reload();
      } else {
        showToast(data.error || 'Failed to update student status', 'error');
      }
    })
    .catch(err => showToast('Network error updating student status', 'error'));
}

// ==========================================================
// TOAST NOTIFICATIONS
// ==========================================================
function showToast(message, type = 'info') {
  let toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toastContainer';
    toastContainer.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 10px;';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.style.cssText = `
    padding: 12px 20px; border-radius: 8px; font-weight: 500; font-size: 0.9rem;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3); color: #ffffff; min-width: 250px;
    background: ${type === 'success' ? '#22c55e' : type === 'error' || type === 'danger' ? '#ef4444' : '#3b82f6'};
    opacity: 0; transform: translateY(-10px); transition: all 0.3s ease;
  `;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  }, 10);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
