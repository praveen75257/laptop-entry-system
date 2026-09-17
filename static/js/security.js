let html5QrcodeScanner = null;
let isProcessing = false;
let isScannerActive = false;

document.addEventListener('DOMContentLoaded', function() {
  checkSecureContext();
  initScanner();
});

// Safely stop scanner tracks when leaving page
window.addEventListener('beforeunload', stopScanner);
window.addEventListener('pagehide', stopScanner);

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
  document.getElementById('scanResultCard').style.display = 'none';

  // Safely stop existing instance if running
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
      const boxSize = Math.floor(minEdge * 0.7);
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
    console.warn('Environment (rear) camera failed, attempting front camera fallback...', err);
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
    subMsg = 'Android Chrome and iOS Safari block camera access over insecure HTTP. On Vercel, access via your https://*.vercel.app URL.';
  } else if (errStr.includes('notallowed') || errStr.includes('permission denied')) {
    errorMsg = '📷 Camera Permission Denied';
    subMsg = 'Permission was denied. Tap the lock icon or page settings in your browser address bar to allow camera access, then tap below to retry.';
  } else if (errStr.includes('notreadable') || errStr.includes('trackstart')) {
    errorMsg = '📷 Camera In Use';
    subMsg = 'The camera is currently being used by another application. Please close other camera apps and retry.';
  } else if (errStr.includes('notfound') || errStr.includes('devicesnotfound')) {
    errorMsg = '📷 No Camera Found';
    subMsg = 'No active camera hardware was detected on this device.';
  }

  readerElement.innerHTML = `
    <div class="empty-state" style="padding: 28px 16px; text-align: center;">
      <p style="color: var(--danger); font-weight: 700; font-size: 1.05rem; margin-bottom: 8px;">${errorMsg}</p>
      <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.5;">${subMsg}</p>
      <button onclick="initScanner()" class="btn btn-sm btn-primary" style="padding: 10px 20px; font-weight: 600;">📷 Tap to Start Camera</button>
    </div>
  `;
}

function onScanSuccess(decodedText) {
  if (isProcessing) return;
  isProcessing = true;

  // Immediately stop/pause camera scan to prevent duplicate scans
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
  badgeContainer.innerHTML = '<div class="loading-spinner" style="margin: 12px auto;"></div><p style="color:var(--text-secondary); margin-top:8px; font-weight:600;">Processing Student Scan...</p>';
  detailsContainer.innerHTML = '';

  // Post scan payload to server (local decoding: ONLY text payload sent to Flask)
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

      // Immediately refresh inside counter badge
      fetch('/api/security-stats')
        .then(r => r.json())
        .then(stats => {
          const countEl = document.getElementById('scannerInsideCount');
          if (countEl && stats.currently_inside !== undefined) {
            countEl.textContent = stats.currently_inside;
          }
        }).catch(() => {});

      badgeContainer.innerHTML = `
        <div style="font-size: 1.6rem; font-weight: 800; color: ${isEntry ? 'var(--success)' : 'var(--warning)'}; margin-bottom: 6px;">
          ${isEntry ? '✓ ENTRY RECORDED' : '✓ EXIT RECORDED'}
        </div>
        <span class="badge badge-lg badge-${isEntry ? 'success' : 'warning'}" style="font-size: 0.95rem; padding: 6px 18px; letter-spacing: 0.5px;">
          STATUS: ${data.status || (isEntry ? 'INSIDE' : 'OUTSIDE')}
        </span>
      `;

      detailsContainer.innerHTML = `
        <div style="background: rgba(255,255,255,0.03); border-radius: 12px; padding: 16px; border: 1px solid var(--border-color);">
          <p style="margin-bottom: 8px;"><strong>Student:</strong> <span style="color: var(--accent-blue); font-weight: 700; font-size: 1.05rem;">${data.student_name}</span></p>
          <p style="margin-bottom: 8px;"><strong>Reg No:</strong> <code>${data.registration_number}</code></p>
          <p style="margin-bottom: 8px;"><strong>Dept & Year:</strong> ${data.department} ${data.year ? '(' + data.year + ')' : ''}</p>
          <p style="margin-bottom: 8px;"><strong>Laptop:</strong> ${data.laptop_name} ${data.laptop_model_number ? '(' + data.laptop_model_number + ')' : ''}</p>
          ${isEntry ? `
            <p style="margin-bottom: 0;"><strong>Time:</strong> <span class="badge badge-success" style="font-size: 0.9rem;">${data.entry_time}</span></p>
          ` : `
            <p style="margin-bottom: 4px;"><strong>Entry Time:</strong> ${data.entry_time}</p>
            <p style="margin-bottom: 0;"><strong>Exit Time:</strong> <span class="badge badge-warning" style="font-size: 0.9rem;">${data.exit_time}</span></p>
          `}
        </div>
      `;
    } else {
      // Invalid QR payload or scan rejected
      let errorTitle = 'INVALID STUDENT QR';
      if (data.error_code === 'INCOMPLETE_DATA') errorTitle = 'INCOMPLETE STUDENT QR';
      else if (data.error_code === 'UNSUPPORTED_VERSION') errorTitle = 'UNSUPPORTED QR VERSION';

      badgeContainer.innerHTML = `
        <div style="font-size: 1.4rem; font-weight: 800; color: var(--danger); margin-bottom: 6px;">
          ✖ ${errorTitle}
        </div>
        <span class="badge badge-lg badge-danger" style="font-size: 0.85rem;">SCAN REJECTED</span>
      `;

      detailsContainer.innerHTML = `
        <div class="alert alert-error" style="margin-top: 10px; font-size: 0.9rem; line-height: 1.5;">
          ${data.error || 'The scanned QR code is not authorized or contains invalid student data.'}
        </div>
      `;
    }
  })
  .catch(err => {
    isProcessing = false;
    console.error('Scan API error:', err);
    badgeContainer.innerHTML = `
      <div style="font-size: 1.4rem; font-weight: 800; color: var(--danger);">
        ✖ SCANNER ERROR
      </div>
    `;
    detailsContainer.innerHTML = `
      <div class="alert alert-error" style="margin-top: 10px;">
        Unable to communicate with the gate server. Please try again.
      </div>
    `;
  });
}

function onScanError(error) {
  // Silent handler for non-matching video frames
}

function scanNext() {
  isProcessing = false;
  document.getElementById('scanResultCard').style.display = 'none';
  document.getElementById('scannerContainer').style.display = 'block';

  // Restart camera safely
  initScanner();
}

// Tab Switching
function switchSecTab(tabName) {
  document.querySelectorAll('.sec-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');

  const activeBtn = document.querySelector(`.sec-tab-btn[data-tab="${tabName}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  const activePane = document.getElementById(`${tabName}Tab`);
  if (activePane) activePane.style.display = 'block';

  if (tabName === 'scanner') {
    if (!isScannerActive) initScanner();
  } else {
    // Stop camera stream when navigating away to save battery & release hardware
    stopScanner();

    if (tabName === 'log') {
      loadTodayLog();
    } else if (tabName === 'stats') {
      loadSecurityStats();
    }
  }
}

function loadTodayLog() {
  fetch('/api/records/today')
    .then(r => r.json())
    .then(data => {
      const container = document.getElementById('todayLogList');
      if (!container) return;

      const records = data.records || (Array.isArray(data) ? data : []);
      if (records.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding: 20px;">No gate movements recorded today</div>';
        return;
      }

      container.innerHTML = `
        <div class="table-container">
          <table style="width: 100%; font-size: 0.88rem;">
            <thead>
              <tr>
                <th style="padding: 8px;">Student</th>
                <th style="padding: 8px;">Laptop</th>
                <th style="padding: 8px;">Time</th>
                <th style="padding: 8px;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${records.map(r => `
                <tr>
                  <td style="padding: 8px;">
                    <strong style="color: var(--accent-blue);">${r.student_name_snapshot || r.student_name || ''}</strong><br>
                    <small style="color: var(--text-secondary);">${r.registration_number_snapshot || r.registration_number || ''}</small>
                  </td>
                  <td style="padding: 8px;">${r.laptop_name_snapshot || r.laptop_name || ''}</td>
                  <td style="padding: 8px;">
                    In: ${r.entry_time_fmt || ''}
                    ${(r.exit_time_fmt && r.exit_time_fmt !== '—') ? '<br>Out: ' + r.exit_time_fmt : ''}
                  </td>
                  <td style="padding: 8px;">
                    <span class="badge ${r.status === 'INSIDE' ? 'badge-inside' : 'badge-outside'}">${r.status || ''}</span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    })
    .catch(err => console.error('Failed to load today log:', err));
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
    })
    .catch(err => console.error('Failed to load security stats:', err));
}
