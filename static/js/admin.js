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
// ENTRY / EXIT RECORDS PAGE (LIVE POLLING)
// ==========================================================
let recordsPollingTimer = null;
let searchDebounceTimer = null;

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
      const timeSpan = document.getElementById('lastUpdatedTime');
      const dateLabel = document.getElementById('currentFilterDateLabel');

      if (timeSpan && data.last_updated) {
        timeSpan.textContent = data.last_updated;
      }
      if (dateLabel && data.date) {
        dateLabel.textContent = `Gate Activity Log for ${data.date}`;
      }

      // Update summary counters
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

      if (!tbody) return;

      const records = data.records || [];
      if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13" class="text-center py-4 text-secondary">No gate records found matching current filters.</td></tr>';
        return;
      }

      tbody.innerHTML = records.map(r => {
        const isInside = (r.status === 'INSIDE');
        const badgeClass = isInside ? 'badge-inside' : 'badge-outside';
        const shortId = (r.record_id || '').substring(0, 8);

        return `
          <tr>
            <td style="white-space: nowrap; font-size: 0.85rem;">${r.date_fmt || ''}</td>
            <td style="white-space: nowrap;"><span class="badge badge-inside" style="font-size: 0.8rem;">${r.entry_time_fmt || ''}</span></td>
            <td style="white-space: nowrap;">${r.exit_time_fmt !== '—' ? `<span class="badge badge-outside" style="font-size: 0.8rem;">${r.exit_time_fmt}</span>` : '<span class="text-muted">—</span>'}</td>
            <td><span class="badge ${badgeClass}">${r.status || ''}</span></td>
            <td><strong>${r.student_name_snapshot || ''}</strong></td>
            <td><code>${r.registration_number_snapshot || ''}</code></td>
            <td>${r.department_snapshot || ''}</td>
            <td>${r.year_snapshot || ''}</td>
            <td style="white-space: nowrap;">${r.phone_number_snapshot || ''}</td>
            <td>${r.laptop_name_snapshot || ''}</td>
            <td><small class="text-secondary">${r.laptop_model_number_snapshot || ''}</small></td>
            <td><span class="badge badge-info" style="font-size: 0.75rem;">v${r.qr_version || 1}</span></td>
            <td><code title="${r.record_id}" style="cursor: pointer;" onclick="navigator.clipboard.writeText('${r.record_id}'); showToast('Copied Record ID', 'info');">${shortId}...</code></td>
          </tr>
        `;
      }).join('');
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
    .then(students => {
      const tbody = document.getElementById('studentsTableBody');
      const cardsView = document.getElementById('studentsCardsView');
      if (!tbody) return;

      if (students.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No active students found</td></tr>';
        if (cardsView) cardsView.innerHTML = '<div class="empty-state">No active students found</div>';
        return;
      }

      // Table view
      tbody.innerHTML = students.map(s => `
        <tr>
          <td><strong>${s.Student_Name}</strong></td>
          <td><code>${s.Registration_Number}</code></td>
          <td>${s.Department}</td>
          <td>${s.Year}</td>
          <td>${s.Phone_Number}</td>
          <td>${s.Laptop_Name} <small style="color:var(--text-secondary);">(${s.Laptop_Model_Number})</small></td>
          <td class="actions-cell">
            <a href="/admin/generate-qr/${s.Registration_Number}" class="btn btn-sm btn-primary" title="View & Print QR">QR Code</a>
            <a href="/admin/students/edit/${s.Registration_Number}" class="btn btn-sm btn-secondary" title="Edit Student">Edit</a>
            <button onclick="deactivateStudent('${s.Registration_Number}', '${s.Student_Name}')" class="btn btn-sm btn-danger" title="Deactivate">Deactivate</button>
          </td>
        </tr>
      `).join('');

      // Cards view for mobile
      if (cardsView) {
        cardsView.innerHTML = students.map(s => `
          <div class="card student-card" style="margin-bottom: 12px;">
            <div class="card-body">
              <h4 style="margin-bottom: 6px; color: var(--accent-blue);">${s.Student_Name}</h4>
              <p style="font-size: 0.9rem; margin-bottom: 4px;"><strong>Reg:</strong> <code>${s.Registration_Number}</code> | ${s.Department} (${s.Year})</p>
              <p style="font-size: 0.85rem; margin-bottom: 4px;"><strong>Phone:</strong> ${s.Phone_Number}</p>
              <p style="font-size: 0.85rem; margin-bottom: 12px;"><strong>Laptop:</strong> ${s.Laptop_Name} (${s.Laptop_Model_Number})</p>
              <div class="card-actions" style="display: flex; gap: 8px;">
                <a href="/admin/generate-qr/${s.Registration_Number}" class="btn btn-sm btn-primary">QR Code</a>
                <a href="/admin/students/edit/${s.Registration_Number}" class="btn btn-sm btn-secondary">Edit</a>
                <button onclick="deactivateStudent('${s.Registration_Number}', '${s.Student_Name}')" class="btn btn-sm btn-danger">Deactivate</button>
              </div>
            </div>
          </div>
        `).join('');
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
