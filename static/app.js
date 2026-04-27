// === Date Display ===
const now = new Date();
const todayStr = now.getFullYear() + '-' +
    String(now.getMonth()+1).padStart(2,'0') + '-' +
    String(now.getDate()).padStart(2,'0');
document.getElementById('currentDate').textContent = todayStr;

// Set default record date to today
document.getElementById('recordDate').value = todayStr;

// === DOM References ===
const vendorFile = document.getElementById('vendorFile');
const systemFile = document.getElementById('systemFile');
const compareBtn = document.getElementById('compareBtn');
const vendorPasteArea = document.getElementById('vendorPasteArea');
const vendorPasteBox = document.getElementById('vendorPasteBox');

// === State ===
let currentData = null;
let vendorMode = 'file';

// === Chart Colors ===
const COLORS = ['#1e3a5f','#2d5f8a','#4a90d9','#28a745','#ffc107','#dc3545','#6f42c1','#20c997','#fd7e14','#e83e8c'];

const STATUS_COLORS = {
    'New': '#6c757d',
    'Reproducing': '#0d6efd',
    'Problem Analysis': '#0d6efd',
    'Log Analysis': '#17a2b8',
    "Can't Reproduced": '#ffc107',
    'Need Help': '#dc3545',
    'Code Review': '#6f42c1',
    'Closed': '#28a745',
    'Resolved': '#28a745',
};
const DEFAULT_STATUS_COLORS = ['#1e3a5f','#2d5f8a','#4a90d9','#e83e8c','#fd7e14','#20c997','#dc3545','#ffc107'];
let statusColorIdx = 0;

// === Utility ===
function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function getStatusColor(status) {
    if (STATUS_COLORS[status]) return STATUS_COLORS[status];
    const c = DEFAULT_STATUS_COLORS[statusColorIdx % DEFAULT_STATUS_COLORS.length];
    STATUS_COLORS[status] = c;
    statusColorIdx++;
    return c;
}

function getStatusBadgeClass(status) {
    const s = (status || '').toLowerCase();
    if (s === 'closed' || s === 'resolved') return 'badge-closed';
    if (s === 'new') return 'badge-new';
    return 'badge-progress';
}

// === Upload Box Setup ===
function setupUploadBox(inputEl, boxId, nameId) {
    const box = document.getElementById(boxId);
    inputEl.addEventListener('change', () => {
        if (inputEl.files.length) {
            document.getElementById(nameId).textContent = inputEl.files[0].name;
            box.classList.add('has-file');
        }
        checkReady();
    });
    box.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('dragover'); });
    box.addEventListener('dragleave', () => box.classList.remove('dragover'));
    box.addEventListener('drop', e => {
        e.preventDefault();
        box.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            inputEl.files = e.dataTransfer.files;
            document.getElementById(nameId).textContent = e.dataTransfer.files[0].name;
            box.classList.add('has-file');
            checkReady();
        }
    });
}
setupUploadBox(vendorFile, 'vendorBox', 'vendorName');
setupUploadBox(systemFile, 'systemBox', 'systemName');

// === Vendor Mode Toggle ===
function toggleVendorMode(mode) {
    vendorMode = mode;
    document.getElementById('vendorToggleFile').classList.toggle('active', mode === 'file');
    document.getElementById('vendorTogglePaste').classList.toggle('active', mode === 'paste');
    document.getElementById('vendorBox').style.display = mode === 'file' ? '' : 'none';
    vendorPasteBox.style.display = mode === 'paste' ? '' : 'none';
    checkReady();
}

vendorPasteArea.addEventListener('input', () => {
    vendorPasteBox.classList.toggle('has-data', vendorPasteArea.value.trim().length > 0);
    checkReady();
});

const templateBtn = document.getElementById('templateBtn');

function checkReady() {
    const vendorOk = vendorMode === 'file' ? vendorFile.files.length > 0 : vendorPasteArea.value.trim().length > 0;
    const systemOk = systemFile.files.length > 0;
    compareBtn.disabled = !(vendorOk && systemOk);
    templateBtn.disabled = !systemOk;
}

// === Rendering ===
function renderBarChart(containerId, data) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const entries = Object.entries(data).sort((a,b) => b[1] - a[1]);
    if (!entries.length) {
        container.innerHTML = '<div style="color:#999;font-size:0.9em;">No data</div>';
        return;
    }
    const maxVal = Math.max(...entries.map(e => e[1]));
    entries.forEach(([label, value], i) => {
        const pct = maxVal > 0 ? (value / maxVal * 100) : 0;
        const color = COLORS[i % COLORS.length];
        container.innerHTML += `
            <div class="bar-row">
                <div class="bar-label" title="${label}">${label || '(empty)'}</div>
                <div class="bar-track">
                    <div class="bar-fill" style="width:${pct}%;background:${color}">${value}</div>
                </div>
            </div>`;
    });
}

function renderTable(issues) {
    const tbody = document.getElementById('issueTableBody');
    tbody.innerHTML = '';
    issues.forEach((issue, idx) => {
        const comments = (issue.Comments || []).map(c => `<div>${escHtml(c)}</div>`).join('');
        tbody.innerHTML += `
            <tr>
                <td>${idx + 1}</td>
                <td style="white-space:nowrap">${escHtml(issue.ID)}</td>
                <td>${escHtml(issue.HEADLINE)}</td>
                <td><span class="badge ${getStatusBadgeClass(issue.Status)}">${escHtml(issue.Status)}</span></td>
                <td>${escHtml(issue.Module || '')}</td>
                <td>${escHtml(issue.Owner || '')}</td>
                <td style="text-align:center">${escHtml(issue['Days since Opened'] || '')}</td>
                <td>${escHtml(issue.Tag || '')}</td>
                <td class="comments-cell">${comments || '-'}</td>
            </tr>`;
    });
}

function renderTimelines(timelines) {
    const container = document.getElementById('timelineContainer');
    if (!timelines || !timelines.length) {
        container.innerHTML = '<div style="color:#999;font-size:0.9em;">No history data yet.</div>';
        return;
    }

    let html = '';
    timelines.forEach(t => {
        const totalDays = t.history.reduce((sum, h) => sum + (h.days || 1), 0);

        let barHtml = '';
        t.history.forEach(h => {
            const pct = Math.max(((h.days || 1) / totalDays) * 100, 3);
            const color = getStatusColor(h.status);
            const label = h.days > 0 ? `${h.status} (${h.days}d)` : h.status;
            barHtml += `<div class="timeline-segment" style="width:${pct}%;background:${color}" title="${label}"><span class="seg-label">${label}</span></div>`;
        });

        html += `
            <div class="timeline-item">
                <div class="timeline-header">
                    <span class="timeline-id">${escHtml(t.id)}</span>
                    <span class="timeline-headline" title="${escHtml(t.headline)}">${escHtml(t.headline)}</span>
                </div>
                <div class="timeline-bar">${barHtml}</div>
            </div>`;
    });

    container.innerHTML = html;
}

function renderBottleneck(bottleneck) {
    if (!bottleneck) return;

    if (bottleneck.avg_by_status && bottleneck.avg_by_status.length) {
        const data = {};
        bottleneck.avg_by_status.forEach(r => {
            data[r.status + ' (avg)'] = r.avg_days;
        });
        renderBarChart('avgStatusChart', data);
    }

    const stalledEl = document.getElementById('stalledList');
    if (!bottleneck.stalled || !bottleneck.stalled.length) {
        stalledEl.innerHTML = '<div style="color:#28a745;font-size:0.9em;">No stalled issues!</div>';
        return;
    }

    let html = '';
    bottleneck.stalled.forEach(s => {
        html += `
            <div class="stalled-item">
                <div class="stalled-info">
                    <span class="stalled-id">${escHtml(s.issue_id)}</span>
                    <span class="stalled-status"> - ${escHtml(s.status)}</span>
                </div>
                <div class="stalled-days">${s.days_in_status} days</div>
            </div>`;
    });
    stalledEl.innerHTML = html;
}

// === Tab Switching ===
function showTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    if (!currentData) return;
    if (tab === 'active') renderTable(currentData.common.concat(currentData.system_only));
    else renderTable(currentData.vendor_only);
}

// === Timeline Loading ===
async function loadTimeline() {
    try {
        const resp = await fetch('/timeline');
        const data = await resp.json();
        if (data.error) return;
        renderTimelines(data.timelines);
        renderBottleneck(data.bottleneck);
    } catch (e) {
        console.error('Timeline load error:', e);
    }
}

// === Compare Action ===
async function doCompare() {
    const formData = new FormData();
    if (vendorMode === 'file') {
        formData.append('vendor_file', vendorFile.files[0]);
    } else {
        formData.append('vendor_paste', vendorPasteArea.value);
    }
    formData.append('system_file', systemFile.files[0]);
    formData.append('record_date', document.getElementById('recordDate').value);

    const loading = document.getElementById('loading');
    const errorMsg = document.getElementById('errorMsg');
    errorMsg.style.display = 'none';
    loading.classList.add('active');
    compareBtn.disabled = true;

    try {
        const resp = await fetch('/compare', { method: 'POST', body: formData });
        let data;
        try {
            data = await resp.json();
        } catch (parseErr) {
            errorMsg.textContent = 'Server error (HTTP ' + resp.status + '). Check console window for details.';
            errorMsg.style.display = 'block';
            return;
        }

        if (data.error) {
            errorMsg.textContent = data.error;
            errorMsg.style.display = 'block';
            return;
        }

        currentData = data;

        // Summary cards
        document.getElementById('statTotal').textContent = data.stats.summary.total_active;
        document.getElementById('statOngoing').textContent = data.stats.summary.common;
        document.getElementById('statNew').textContent = data.stats.summary.new;
        document.getElementById('statCompleted').textContent = data.stats.summary.resolved;

        // Tab counts
        document.getElementById('tabCountActive').textContent = data.stats.summary.total_active;
        document.getElementById('tabCountResolved').textContent = data.stats.summary.resolved;

        // Charts
        renderBarChart('chartStatus', data.stats.status);
        renderBarChart('chartDays', data.stats.days_distribution);
        renderBarChart('chartModule', data.stats.module);
        renderBarChart('chartOwner', data.stats.owner);

        // Table
        renderTable(data.common.concat(data.system_only));
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.tab-btn').classList.add('active');

        // Show dashboard
        document.getElementById('dashboard').classList.add('active');
        document.getElementById('downloadBtn').style.display = 'inline-block';

        // Load timeline
        loadTimeline();

    } catch (err) {
        errorMsg.textContent = 'Error: ' + err.message;
        errorMsg.style.display = 'block';
    } finally {
        loading.classList.remove('active');
        compareBtn.disabled = false;
    }
}

function doDownload() {
    window.location.href = '/download';
}

async function doGenerateTemplate() {
    const formData = new FormData();
    formData.append('system_file', systemFile.files[0]);

    const loading = document.getElementById('loading');
    const errorMsg = document.getElementById('errorMsg');
    errorMsg.style.display = 'none';
    loading.classList.add('active');
    templateBtn.disabled = true;

    try {
        const resp = await fetch('/generate-template', { method: 'POST', body: formData });

        if (!resp.ok) {
            let errMsg = 'Template generation failed.';
            try {
                const data = await resp.json();
                errMsg = data.error || errMsg;
            } catch (e) {}
            errorMsg.textContent = errMsg;
            errorMsg.style.display = 'block';
            return;
        }

        // Download the file
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = resp.headers.get('Content-Disposition')?.split('filename=')[1] || 'vendor_template.xlsx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

    } catch (err) {
        errorMsg.textContent = 'Error: ' + err.message;
        errorMsg.style.display = 'block';
    } finally {
        loading.classList.remove('active');
        templateBtn.disabled = false;
    }
}
