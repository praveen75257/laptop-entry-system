// ==========================================================
// CPAT LAPTOP GATE - MOBILE SECURITY PORTAL & LOG SHEET JS
// Production Architecture: Flask + Neon PostgreSQL (Authoritative)
// ==========================================================

let html5QrcodeScanner = null;
let isProcessing = false;
let isScannerActive = false;

// Log Sheet State
let secLogRecords = [];
let secSearchQuery = '';
let secStatusFilter = '';
let secViewMode = 'table';
let secLogZoom = 1.0;
let secLogPollingTimer = null;
let secStatsPollingTimer = null;

document.addEventListener('DOMContentLoaded', function() {
  checkSecureContext();
  initScanner();
  // Preload initial stats for topbar counter
  refreshTopCounters();
});

// Safely stop scanner tracks and polling timers when leaving or unloading page
window.addEventListener('beforeunload', cleanupSecurityResources);
window.addEventListener('pagehide', cleanupSecurityResources);

function cleanupSecurityResources() {
  stopScanner();
  stopLogPolling();
  stopStatsPolling();
}

function checkSecureContext() {
  const isSecure = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const banner = document.getElementById('secureContextBanner');
  const httpsLink = document.getElementById('httpsLink');

  if (!isSecure && banner) {
    banner.style.display = 'block';
    const httpsUrl = 'https://' + location.hostname + (location.port ? ':' + location.port : '') + location.pathname;
    if (httpsLink) {
      httpsLink.href = httpsUrl;
      httpsLink.textContent = httpsUrl;
    }
  } else if (banner) {
    banner.style.display = 'none';
  }
}

// ==========================================================
// 1. QR CAMERA SCANNER ENGINE
// ==========================================================

function stopScanner() {
  if (html5QrcodeScanner && isScannerActive) {
    try {
      html5QrcodeScanner.stop().then(() => {
        isScannerActive = false;
      }).catch(e => {
        console.warn('Error stopping camera scanner:', e);
        isScannerActive = false;
      });
    } catch (e) {
      isScannerActive = false;
    }
  }
}

function initScanner() {
  if (isScannerActive) return;

  const readerElement = document.getElementById('reader');
  const scannerContainer = document.getElementById('scannerContainer');
  if (!readerElement || !scannerContainer) return;

  scannerContainer.style.display = 'block';
  const resultCard = document.getElementById('scanResultCard');
  if (resultCard) resultCard.style.display = 'none';

  if (html5QrcodeScanner) {
    try {
      html5QrcodeScanner.stop().catch(() => {}).finally(() => {
        startCameraStream();
      });
      return;
    } catch (e) {
      console.warn('Resetting scanner instance:', e);
    }
  }

  startCameraStream();
}

function startCameraStream() {
  const readerElement = document.getElementById('reader');
  if (!readerElement) return;

  readerElement.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-secondary);"><span class="loading-spinner" style="width:24px;height:24px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:8px;"></span> Initializing Rear Camera...</div>';

  const config = {
    fps: 10,
    qrbox: function(viewfinderWidth, viewfinderHeight) {
      const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
      const boxSize = Math.floor(minEdge * 0.72);
      return { width: Math.max(boxSize, 200), height: Math.max(boxSize, 200) };
    },
    aspectRatio: 1.0,
    showTorchButtonIfSupported: true
  };

  try {
    html5QrcodeScanner = new Html5Qrcode('reader');
  } catch (e) {
    console.error('Html5Qrcode initialization failed:', e);
    handleCameraError(e);
    return;
  }

  // Attempt 1: Prioritize Rear Camera ('environment')
  html5QrcodeScanner.start(
    { facingMode: 'environment' },
    config,
    onScanSuccess,
    onScanError
  ).then(() => {
    isScannerActive = true;
  }).catch(err => {
    console.warn('Rear camera failed, trying user camera fallback...', err);
    // Attempt 2: User camera fallback
    html5QrcodeScanner.start(
      { facingMode: 'user' },
      config,
      onScanSuccess,
      onScanError
    ).then(() => {
      isScannerActive = true;
    }).catch(e => {
      console.error('User camera fallback failed:', e);
      // Attempt 3: Any available video device
      html5QrcodeScanner.start(
        true,
        config,
        onScanSuccess,
        onScanError
      ).then(() => {
        isScannerActive = true;
      }).catch(finalErr => {
        console.error('All camera initialization attempts failed:', finalErr);
        handleCameraError(finalErr || err);
      });
    });
  });
}

function handleCameraError(err) {
  isScannerActive = false;
  const readerElement = document.getElementById('reader');
  if (!readerElement) return;

  let errorMsg = '📷 Camera Access Not Available';
  let subMsg = 'Please grant camera permissions in your mobile browser settings.';

  const errStr = String(err || '').toLowerCase();
  const isSecure = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  if (!isSecure) {
    errorMsg = '🔒 HTTPS Required for Mobile Camera';
    subMsg = 'Android Chrome and iOS Safari block camera access over insecure HTTP. Please access via your HTTPS deployment.';
  } else if (errStr.includes('notallowed') || errStr.includes('permission denied')) {
    errorMsg = '📷 Camera Permission Denied';
    subMsg = 'Permission was denied. Tap the site settings/lock icon in your browser address bar to allow camera access, then tap below to retry.';
  } else if (errStr.includes('notreadable') || errStr.includes('trackstart')) {
    errorMsg = '📷 Camera In Use';
    subMsg = 'The camera is currently being used by another app. Please close other camera apps and retry.';
  } else if (errStr.includes('notfound') || errStr.includes('devicesnotfound')) {
    errorMsg = '📷 No Camera Detected';
    subMsg = 'No active camera hardware was detected on this device.';
  }

  readerElement.innerHTML = `
    <div class="empty-state" style="padding: 28px 16px; text-align: center;">
      <p style="color: var(--danger); font-weight: 700; font-size: 1.05rem; margin-bottom: 8px;">${errorMsg}</p>
      <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.5;">${subMsg}</p>
      <button onclick="initScanner()" class="btn btn-sm btn-primary" style="padding: 10px 20px; font-weight: 600;">Tap to Start Camera</button>
    </div>
  `;
}

function onScanSuccess(decodedText) {
  if (isProcessing) return;
  isProcessing = true;

  // Immediately stop camera scan to prevent duplicate triggers
  if (html5QrcodeScanner && isScannerActive) {
    html5QrcodeScanner.stop().then(() => {
      isScannerActive = false;
      document.getElementById('scannerContainer').style.display = 'none';
    }).catch(err => {
      console.warn('Error stopping scanner on success:', err);
      isScannerActive = false;
      document.getElementById('scannerContainer').style.display = 'none';
    });
  } else {
    document.getElementById('scannerContainer').style.display = 'none';
  }

  // Display processing UI
  const resultCard = document.getElementById('scanResultCard');
  const badgeContainer = document.getElementById('resultBadgeContainer');
  const detailsContainer = document.getElementById('resultDetails');

  resultCard.style.display = 'block';
  badgeContainer.innerHTML = '<div class="loading-spinner" style="margin: 12px auto;"></div><p style="color:var(--text-secondary); margin-top:8px; font-weight:600;">Authorizing Gate Scan...</p>';
  detailsContainer.innerHTML = '';

  // Post scan payload to server (HMAC verified on backend, PostgreSQL authoritative)
  fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qr_data: decodedText })
  })
  .then(r => r.json())
  .then(data => {
    isProcessing = false;
    if (data.success) {
      const isEntry = data.action === 'ENTRY';

      // Update counters immediately
      refreshTopCounters();

      badgeContainer.innerHTML = `
        <div style="font-size: 1.5rem; font-weight: 800; color: ${isEntry ? 'var(--success)' : 'var(--warning)'}; margin-bottom: 6px;">
          ${isEntry ? '✓ ENTRY RECORDED' : '✓ EXIT RECORDED'}
        </div>
        <span class="badge badge-lg ${isEntry ? 'badge-inside' : 'badge-outside'}" style="font-size: 0.92rem; padding: 6px 18px; letter-spacing: 0.5px;">
          GATE STATUS: ${data.status || (isEntry ? 'INSIDE' : 'OUT')}
        </span>
      `;

      detailsContainer.innerHTML = `
        <div style="background: rgba(255,255,255,0.03); border-radius: 12px; padding: 16px; border: 1px solid var(--border-color); margin-top: 12px;">
          <p style="margin-bottom: 8px;"><strong>Student:</strong> <span style="color: #ffffff; font-weight: 700; font-size: 1.05rem;">${data.student_name || ''}</span></p>
          <p style="margin-bottom: 8px;"><strong>Reg No:</strong> <code style="font-size: 0.9rem;">${data.registration_number || ''}</code></p>
          <p style="margin-bottom: 8px;"><strong>Dept:</strong> ${data.department || ''}</p>
          <p style="margin-bottom: 8px;"><strong>Laptop:</strong> ${data.laptop_name || ''} ${data.laptop_model_number ? '(' + data.laptop_model_number + ')' : ''}</p>
          ${isEntry ? `
            <p style="margin-bottom: 0;"><strong>Entry Time:</strong> <span class="ts-chip ts-chip-entry">${data.entry_time || ''}</span></p>
          ` : `
            <p style="margin-bottom: 6px;"><strong>Entry Time:</strong> <span class="ts-chip ts-chip-entry">${data.entry_time || ''}</span></p>
            <p style="margin-bottom: 0;"><strong>Exit Time:</strong> <span class="ts-chip ts-chip-exit">${data.exit_time || ''}</span></p>
          `}
        </div>
      `;
    } else {
      let errorTitle = 'INVALID STUDENT QR';
      if (data.error_code === 'INCOMPLETE_DATA') errorTitle = 'INCOMPLETE STUDENT QR';
      else if (data.error_code === 'UNSUPPORTED_VERSION') errorTitle = 'UNSUPPORTED QR VERSION';

      badgeContainer.innerHTML = `
        <div style="font-size: 1.35rem; font-weight: 800; color: var(--danger); margin-bottom: 6px;">
          ✖ ${errorTitle}
        </div>
        <span class="badge badge-lg badge-danger" style="font-size: 0.85rem;">SCAN REJECTED</span>
      `;

      detailsContainer.innerHTML = `
        <div class="alert alert-error" style="margin-top: 10px; font-size: 0.9rem; line-height: 1.5;">
          ${data.error || 'The scanned QR code is not recognized or contains invalid student signature.'}
        </div>
      `;
    }
  })
  .catch(err => {
    isProcessing = false;
    console.error('Scan API error:', err);
    badgeContainer.innerHTML = `
      <div style="font-size: 1.35rem; font-weight: 800; color: var(--danger);">
        ✖ SCANNER ERROR
      </div>
    `;
    detailsContainer.innerHTML = `
      <div class="alert alert-error" style="margin-top: 10px;">
        Unable to communicate with the gate server. Please verify network connection.
      </div>
    `;
  });
}

function onScanError(error) {
  // Silent handler for individual non-matching camera frames
}

function scanNext() {
  isProcessing = false;
  const resultCard = document.getElementById('scanResultCard');
  const scannerContainer = document.getElementById('scannerContainer');
  if (resultCard) resultCard.style.display = 'none';
  if (scannerContainer) scannerContainer.style.display = 'block';

  initScanner();
}

// ==========================================================
// 2. TAB NAVIGATION
// ==========================================================

function switchSecTab(tabName) {
  document.querySelectorAll('.sec-tab-btn').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.sec-tab-pane').forEach(p => p.style.display = 'none');

  const activeBtn = document.querySelector(`.sec-tab-btn[data-tab="${tabName}"]`);
  if (activeBtn) {
    activeBtn.classList.add('active');
    activeBtn.setAttribute('aria-selected', 'true');
  }

  const activePane = document.getElementById(`${tabName}Tab`);
  if (activePane) activePane.style.display = 'block';

  if (tabName === 'scanner') {
    stopLogPolling();
    stopStatsPolling();
    if (!isScannerActive) initScanner();
  } else if (tabName === 'log') {
    stopScanner();
    stopStatsPolling();
    loadTodayLog();
    startLogPolling();
  } else if (tabName === 'stats') {
    stopScanner();
    stopLogPolling();
    loadSecurityStats();
    startStatsPolling();
  }
}

// ==========================================================
// 3. DEDICATED LIVE POSTGRESQL LOG SHEET CONTROLLER
// ==========================================================

function loadTodayLog(isManualRefresh = false) {
  const refreshBtn = document.getElementById('secRefreshBtn');
  if (refreshBtn && isManualRefresh) {
    refreshBtn.classList.add('loading');
    refreshBtn.disabled = true;
  }

  fetch('/api/records/today')
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      if (refreshBtn && isManualRefresh) {
        refreshBtn.classList.remove('loading');
        refreshBtn.disabled = false;
      }

      secLogRecords = data.records || (Array.isArray(data) ? data : []);

      // Update sync indicator with actual server time
      const syncEl = document.getElementById('logSyncTime');
      if (syncEl) {
        syncEl.textContent = `Synced: ${data.last_updated || 'Just now'}`;
      }

      // Update status counter pills
      updateFilterCounts();

      // Render records into active view
      renderSecurityLogs();

      // Also sync top counter
      if (data.summary && data.summary.inside !== undefined) {
        updateInsideCounterDOM(data.summary.inside);
      }
    })
    .catch(err => {
      if (refreshBtn && isManualRefresh) {
        refreshBtn.classList.remove('loading');
        refreshBtn.disabled = false;
      }
      console.error('Failed to load today gate log from PostgreSQL:', err);
      const syncEl = document.getElementById('logSyncTime');
      if (syncEl) syncEl.textContent = 'Sync error (retrying...)';
    });
}

function updateFilterCounts() {
  const countAllEl = document.getElementById('countAll');
  const countInsideEl = document.getElementById('countInside');
  const countOutEl = document.getElementById('countOut');

  const total = secLogRecords.length;
  const inside = secLogRecords.filter(r => r.status === 'INSIDE').length;
  const out = secLogRecords.filter(r => r.status === 'OUT').length;

  if (countAllEl) countAllEl.textContent = total;
  if (countInsideEl) countInsideEl.textContent = inside;
  if (countOutEl) countOutEl.textContent = out;
}

function renderSecurityLogs() {
  const tbody = document.getElementById('secLogTableBody');
  const cardsList = document.getElementById('secLogCardsList');
  const counterEl = document.getElementById('logSummaryCounter');

  // Filter records in-memory based on search query & status filter
  let filtered = secLogRecords.slice();

  if (secStatusFilter) {
    filtered = filtered.filter(r => r.status === secStatusFilter);
  }

  if (secSearchQuery) {
    const q = secSearchQuery.toLowerCase();
    filtered = filtered.filter(r => {
      const name = String(r.student_name_snapshot || r.student_name || '').toLowerCase();
      const reg = String(r.registration_number_snapshot || r.registration_number || '').toLowerCase();
      const dept = String(r.department_snapshot || r.department || '').toLowerCase();
      const lap = String(r.laptop_name_snapshot || r.laptop_name || '').toLowerCase();
      const mod = String(r.laptop_model_number_snapshot || r.laptop_model_number || '').toLowerCase();
      const rid = String(r.record_id || '').toLowerCase();
      return name.includes(q) || reg.includes(q) || dept.includes(q) || lap.includes(q) || mod.includes(q) || rid.includes(q);
    });
  }

  if (counterEl) {
    counterEl.textContent = `Showing ${filtered.length} of ${secLogRecords.length} records`;
  }

  // --- Render Table View ---
  if (tbody) {
    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="13" class="empty-state" style="padding: 2.5rem 1rem;">
            ${secSearchQuery || secStatusFilter ? 'No gate records match your active filters.' : 'No gate movements recorded yet today.'}
          </td>
        </tr>
      `;
    } else {
      tbody.innerHTML = filtered.map((r, idx) => {
        const isInside = (r.status === 'INSIDE');
        const badgeClass = isInside ? 'badge-inside' : 'badge-outside';
        const shortId = (r.record_id || '').substring(0, 8);

        return `
          <tr>
            <td class="col-sticky">
              <strong style="color: #ffffff; font-size: 0.92rem;">${r.student_name_snapshot || r.student_name || '—'}</strong>
            </td>
            <td>
              <span class="badge ${badgeClass}">${r.status || '—'}</span>
            </td>
            <td>
              <span class="ts-chip ts-chip-entry">${r.entry_time_fmt || '—'}</span>
            </td>
            <td>
              ${(r.exit_time_fmt && r.exit_time_fmt !== '—')
                ? `<span class="ts-chip ts-chip-exit">${r.exit_time_fmt}</span>`
                : `<span class="ts-chip-null">—</span>`}
            </td>
            <td style="color: var(--text-secondary); font-size: 0.8rem;">${r.date_fmt || '—'}</td>
            <td><code>${r.registration_number_snapshot || r.registration_number || '—'}</code></td>
            <td style="color: var(--text-secondary);">${r.department_snapshot || r.department || '—'}</td>
            <td style="color: var(--text-secondary);">${r.year_snapshot || r.year || '—'}</td>
            <td>${r.laptop_name_snapshot || r.laptop_name || '—'}</td>
            <td style="color: var(--text-muted);"><small>${r.laptop_model_number_snapshot || r.laptop_model_number || '—'}</small></td>
            <td style="color: var(--text-secondary);">${r.phone_number_snapshot || r.phone_number || '—'}</td>
            <td><span class="badge badge-info" style="font-size: 0.7rem;">v${r.qr_version || 1}</span></td>
            <td>
              <code title="${r.record_id}" style="cursor: pointer; font-size: 0.75rem;" onclick="copyRecordId('${r.record_id}')">
                ${shortId}…
              </code>
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  // --- Render Mobile Cards View ---
  if (cardsList) {
    if (filtered.length === 0) {
      cardsList.innerHTML = `
        <div class="empty-state" style="padding: 2.5rem 1rem;">
          ${secSearchQuery || secStatusFilter ? 'No gate records match your active filters.' : 'No gate movements recorded yet today.'}
        </div>
      `;
    } else {
      cardsList.innerHTML = filtered.map((r, idx) => {
        const isInside = (r.status === 'INSIDE');
        const badgeClass = isInside ? 'badge-inside' : 'badge-outside';
        const logNum = String(filtered.length - idx).padStart(3, '0');
        const shortId = (r.record_id || '').substring(0, 8);

        return `
          <div class="sec-log-card">
            <div class="sec-log-card-header">
              <div class="sec-log-card-student">
                ${r.student_name_snapshot || r.student_name || '—'}
                <span class="sec-log-num">#${logNum}</span>
              </div>
              <span class="badge ${badgeClass}">${r.status || '—'}</span>
            </div>

            <div class="d-flex align-items-center gap-2 mb-2">
              <span class="sec-log-card-reg">${r.registration_number_snapshot || r.registration_number || '—'}</span>
              <span style="font-size: 0.8rem; color: var(--text-secondary);">${r.department_snapshot || ''} ${r.year_snapshot ? '(' + r.year_snapshot + ')' : ''}</span>
            </div>

            <div class="sec-log-card-details">
              <div class="sec-log-card-field">
                <strong>Entry Time</strong>
                <span class="ts-chip ts-chip-entry" style="margin-top: 2px;">${r.entry_time_fmt || '—'}</span>
              </div>
              <div class="sec-log-card-field">
                <strong>Exit Time</strong>
                ${(r.exit_time_fmt && r.exit_time_fmt !== '—')
                  ? `<span class="ts-chip ts-chip-exit" style="margin-top: 2px;">${r.exit_time_fmt}</span>`
                  : `<span class="ts-chip-null" style="margin-top: 2px; display:inline-block;">Still Inside</span>`}
              </div>
              <div class="sec-log-card-field">
                <strong>Laptop</strong>
                <span style="color: var(--text-primary); font-weight: 500;">${r.laptop_name_snapshot || '—'}</span>
              </div>
              <div class="sec-log-card-field">
                <strong>Model</strong>
                <span style="color: var(--text-secondary);">${r.laptop_model_number_snapshot || '—'}</span>
              </div>
            </div>

            <div class="sec-log-card-footer">
              <span style="font-size: 0.75rem; color: var(--text-muted);">${r.date_fmt || ''}</span>
              <code style="font-size: 0.72rem; cursor: pointer;" onclick="copyRecordId('${r.record_id}')" title="Tap to copy Record ID">ID: ${shortId}…</code>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

// Copy record ID helper
function copyRecordId(id) {
  if (!id) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(id).then(() => {
      showSecurityToast('Copied Record ID', 'info');
    }).catch(() => {});
  }
}

// Search and Filter controls
function onSecuritySearchInput(val) {
  secSearchQuery = (val || '').trim();
  const clearBtn = document.getElementById('secSearchClear');
  if (clearBtn) {
    clearBtn.style.display = secSearchQuery.length > 0 ? 'inline-block' : 'none';
  }
  renderSecurityLogs();
}

function clearSecuritySearch() {
  const searchInput = document.getElementById('secLogSearch');
  if (searchInput) searchInput.value = '';
  secSearchQuery = '';
  const clearBtn = document.getElementById('secSearchClear');
  if (clearBtn) clearBtn.style.display = 'none';
  renderSecurityLogs();
}

function setSecurityStatusFilter(status) {
  secStatusFilter = status;
  document.querySelectorAll('.sec-filter-pill').forEach(btn => {
    if (btn.getAttribute('data-status') === status) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  renderSecurityLogs();
}

// View Toggle: Table vs Cards
function setLogViewMode(mode) {
  secViewMode = mode;
  const tableView = document.getElementById('secTableView');
  const cardsView = document.getElementById('secCardsView');
  const btnTable = document.getElementById('btnViewTable');
  const btnCards = document.getElementById('btnViewCards');

  if (mode === 'cards') {
    if (tableView) tableView.style.display = 'none';
    if (cardsView) cardsView.style.display = 'block';
    if (btnTable) btnTable.classList.remove('active');
    if (btnCards) btnCards.classList.add('active');
  } else {
    if (tableView) tableView.style.display = 'block';
    if (cardsView) cardsView.style.display = 'none';
    if (btnTable) btnTable.classList.add('active');
    if (btnCards) btnCards.classList.remove('active');
  }
}

// ==========================================================
// 4. LOG SHEET ZOOM ENGINE
// ==========================================================

function changeLogZoom(delta) {
  secLogZoom = Math.min(Math.max(secLogZoom + delta, 0.8), 1.5);
  applyLogZoom();
}

function resetLogZoom() {
  secLogZoom = 1.0;
  applyLogZoom();
}

function applyLogZoom() {
  const tableWrap = document.getElementById('secTableView');
  const zoomDisplay = document.getElementById('zoomLevelDisplay');

  if (tableWrap) {
    tableWrap.style.setProperty('--log-zoom', secLogZoom);
  }
  if (zoomDisplay) {
    zoomDisplay.textContent = `${Math.round(secLogZoom * 100)}%`;
  }
}

// ==========================================================
// 5. POLLING & BACKGROUND SYNC
// ==========================================================

function startLogPolling() {
  stopLogPolling();
  // Poll PostgreSQL every 3.0s while log tab is open
  secLogPollingTimer = setInterval(() => {
    loadTodayLog(false);
  }, 3000);
}

function stopLogPolling() {
  if (secLogPollingTimer) {
    clearInterval(secLogPollingTimer);
    secLogPollingTimer = null;
  }
}

function startStatsPolling() {
  stopStatsPolling();
  secStatsPollingTimer = setInterval(() => {
    loadSecurityStats();
  }, 3000);
}

function stopStatsPolling() {
  if (secStatsPollingTimer) {
    clearInterval(secStatsPollingTimer);
    secStatsPollingTimer = null;
  }
}

function refreshTopCounters() {
  fetch('/api/security-stats')
    .then(r => r.json())
    .then(stats => {
      if (stats.currently_inside !== undefined) {
        updateInsideCounterDOM(stats.currently_inside);
      }
    })
    .catch(() => {});
}

function updateInsideCounterDOM(count) {
  const elTop = document.getElementById('topbarInsideCount');
  const elScanner = document.getElementById('scannerInsideCount');
  const elStats = document.getElementById('secInside');

  if (elTop) elTop.textContent = count;
  if (elScanner) elScanner.textContent = count;
  if (elStats) elStats.textContent = count;
}

function loadSecurityStats() {
  fetch('/api/security-stats')
    .then(r => r.json())
    .then(data => {
      const elEnt = document.getElementById('secEntries');
      const elExt = document.getElementById('secExits');
      const elIns = document.getElementById('secInside');

      if (elEnt) elEnt.textContent = data.today_entries ?? 0;
      if (elExt) elExt.textContent = data.today_exits ?? 0;
      if (elIns) elIns.textContent = data.currently_inside ?? 0;

      if (data.currently_inside !== undefined) {
        updateInsideCounterDOM(data.currently_inside);
      }
    })
    .catch(err => console.error('Failed to load security stats:', err));
}

// Toast Notification
function showSecurityToast(message, type = 'info') {
  let toastContainer = document.getElementById('secToastContainer');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'secToastContainer';
    toastContainer.style.cssText = 'position: fixed; top: 70px; right: 16px; z-index: 9999; display: flex; flex-direction: column; gap: 8px;';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.style.cssText = `
    padding: 10px 16px; border-radius: 8px; font-weight: 600; font-size: 0.85rem;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5); color: #ffffff;
    background: ${type === 'success' ? '#22c55e' : type === 'error' || type === 'danger' ? '#ef4444' : '#0284c7'};
    opacity: 0; transform: translateY(-8px); transition: all 0.25s ease;
  `;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  }, 10);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
