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
let currentProjectId = null;

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

// === Project Management ===
async function loadProjects() {
    try {
        const resp = await fetch('/api/projects');
        const data = await resp.json();
        const select = document.getElementById('projectSelect');
        select.innerHTML = '';
        (data.projects || []).forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            select.appendChild(opt);
        });

        // Restore last selection
        const saved = localStorage.getItem('selectedProjectId');
        if (saved && select.querySelector(`option[value="${saved}"]`)) {
            select.value = saved;
        }
        currentProjectId = parseInt(select.value) || 1;
    } catch (e) {
        console.error('Failed to load projects:', e);
        currentProjectId = 1;
    }
}

function onProjectChange() {
    const select = document.getElementById('projectSelect');
    currentProjectId = parseInt(select.value) || 1;
    localStorage.setItem('selectedProjectId', currentProjectId);
    loadDashboard();
}

async function addProject() {
    const name = prompt('새 프로젝트 이름:');
    if (!name || !name.trim()) return;
    try {
        const resp = await fetch('/api/projects', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name: name.trim()}),
        });
        const data = await resp.json();
        if (!resp.ok) {
            alert(data.error || '프로젝트 생성 실패');
            return;
        }
        await loadProjects();
        // Select the new project
        document.getElementById('projectSelect').value = data.id;
        onProjectChange();
    } catch (e) {
        alert('프로젝트 생성 중 오류: ' + e.message);
    }
}

async function renameProject() {
    if (!currentProjectId) return;
    const select = document.getElementById('projectSelect');
    const current = select.options[select.selectedIndex].textContent;
    const name = prompt('프로젝트 이름 변경:', current);
    if (!name || !name.trim() || name.trim() === current) return;
    try {
        const resp = await fetch(`/api/projects/${currentProjectId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name: name.trim()}),
        });
        const data = await resp.json();
        if (!resp.ok) {
            alert(data.error || '이름 변경 실패');
            return;
        }
        await loadProjects();
    } catch (e) {
        alert('오류: ' + e.message);
    }
}

async function deleteProject() {
    if (!currentProjectId || currentProjectId === 1) {
        alert('Default 프로젝트는 삭제할 수 없습니다.');
        return;
    }
    const select = document.getElementById('projectSelect');
    const name = select.options[select.selectedIndex].textContent;
    if (!confirm(`"${name}" 프로젝트를 삭제하시겠습니까?\n관련된 모든 이슈와 이력이 삭제됩니다.`)) return;
    try {
        const resp = await fetch(`/api/projects/${currentProjectId}`, {method: 'DELETE'});
        const data = await resp.json();
        if (!resp.ok) {
            alert(data.error || '삭제 실패');
            return;
        }
        await loadProjects();
        onProjectChange();
    } catch (e) {
        alert('삭제 중 오류: ' + e.message);
    }
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

    // Find global date range across all issues
    let globalStart = null, globalEnd = null;
    const todayDate = new Date(todayStr);

    timelines.forEach(t => {
        t.history.forEach(h => {
            const start = new Date(h.started_at);
            const end = h.ended_at ? new Date(h.ended_at) : todayDate;
            if (!globalStart || start < globalStart) globalStart = start;
            if (!globalEnd || end > globalEnd) globalEnd = end;
        });
    });

    if (!globalStart) {
        container.innerHTML = '<div style="color:#999;font-size:0.9em;">No history data yet.</div>';
        return;
    }

    const totalDays = Math.max(Math.ceil((globalEnd - globalStart) / 86400000), 1);

    // Generate date labels for the axis
    const dateLabels = [];
    const labelStep = totalDays <= 14 ? 1 : totalDays <= 30 ? 3 : totalDays <= 60 ? 7 : 14;
    for (let d = 0; d <= totalDays; d += labelStep) {
        const dt = new Date(globalStart.getTime() + d * 86400000);
        const label = `${dt.getMonth()+1}/${dt.getDate()}`;
        const pct = (d / totalDays) * 100;
        dateLabels.push({label, pct});
    }

    let axisHtml = '<div class="gantt-axis">';
    dateLabels.forEach(dl => {
        axisHtml += `<span class="gantt-axis-label" style="left:${dl.pct}%">${dl.label}</span>`;
    });
    axisHtml += '</div>';

    // Today marker position
    const todayOffset = Math.ceil((todayDate - globalStart) / 86400000);
    const todayPct = Math.min((todayOffset / totalDays) * 100, 100);

    let rowsHtml = '';
    timelines.forEach(t => {
        let segHtml = '';
        t.history.forEach(h => {
            const start = new Date(h.started_at);
            const end = h.ended_at ? new Date(h.ended_at) : todayDate;
            const startDay = Math.max(Math.ceil((start - globalStart) / 86400000), 0);
            const duration = Math.max(Math.ceil((end - start) / 86400000), 1);
            const leftPct = (startDay / totalDays) * 100;
            const widthPct = Math.max((duration / totalDays) * 100, 1.5);
            const color = getStatusColor(h.status);
            const days = h.days || duration;
            const label = `${h.status} (${days}d)`;
            const showLabel = widthPct > 8;
            segHtml += `<div class="gantt-seg" style="left:${leftPct}%;width:${widthPct}%;background:${color}" title="${label}">${showLabel ? `<span class="gantt-seg-label">${h.status}</span>` : ''}</div>`;
        });

        const totalIssueDays = t.history.reduce((s, h) => s + (h.days || 1), 0);

        rowsHtml += `
            <div class="gantt-row">
                <div class="gantt-label">
                    <span class="gantt-id">${escHtml(t.id)}</span>
                    <span class="gantt-headline" title="${escHtml(t.headline)}">${escHtml(t.headline)}</span>
                </div>
                <div class="gantt-track">
                    ${segHtml}
                    <div class="gantt-today" style="left:${todayPct}%"></div>
                </div>
                <span class="gantt-days">${totalIssueDays}d</span>
            </div>`;
    });

    // Status legend
    const usedStatuses = new Set();
    timelines.forEach(t => t.history.forEach(h => usedStatuses.add(h.status)));
    let legendHtml = '<div class="gantt-legend">';
    usedStatuses.forEach(s => {
        legendHtml += `<span class="gantt-legend-item"><span class="gantt-legend-color" style="background:${getStatusColor(s)}"></span>${escHtml(s)}</span>`;
    });
    legendHtml += `<span class="gantt-legend-item"><span class="gantt-legend-today"></span>Today</span>`;
    legendHtml += '</div>';

    container.innerHTML = `
        <div class="gantt-chart">
            ${legendHtml}
            <div class="gantt-body">
                ${axisHtml}
                ${rowsHtml}
            </div>
        </div>`;
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

// === Milestones ===
function getDdayClass(dDay) {
    if (dDay < 0) return 'dday-over';
    if (dDay <= 6) return 'dday-danger';
    if (dDay <= 14) return 'dday-warn';
    return 'dday-safe';
}

function formatDday(dDay) {
    if (dDay === 0) return 'D-Day!';
    if (dDay > 0) return `D-${dDay}`;
    return `D+${Math.abs(dDay)}`;
}

function renderMilestones(milestones) {
    const container = document.getElementById('milestoneList');
    if (!milestones || !milestones.length) {
        container.innerHTML = '<div style="color:#999;font-size:0.9em;">[+] 버튼으로 단계를 추가하세요.</div>';
        return;
    }

    let html = '';
    milestones.forEach(m => {
        const ddayClass = getDdayClass(m.d_day);
        const ddayText = formatDday(m.d_day);
        // Progress: assume milestone spans 90 days before due_date
        const totalSpan = 90;
        const elapsed = totalSpan - Math.max(m.d_day, 0);
        const pct = Math.min(Math.max((elapsed / totalSpan) * 100, 2), 100);
        const barColor = m.d_day < 0 ? '#dc3545' : m.d_day <= 6 ? '#dc3545' : m.d_day <= 14 ? '#fd7e14' : '#0d6efd';

        html += `
            <div class="milestone-item" data-id="${m.id}">
                <span class="milestone-name" onclick="editMilestoneName(${m.id}, this)" title="클릭하여 편집">${escHtml(m.name)}</span>
                <div class="milestone-bar-wrapper">
                    <div class="milestone-bar">
                        <div class="milestone-fill" style="width:${pct}%;background:${barColor}"></div>
                    </div>
                    <span class="milestone-date" onclick="editMilestoneDate(${m.id}, this)" title="클릭하여 편집">${m.due_date}</span>
                </div>
                <span class="milestone-dday ${ddayClass}">${ddayText}</span>
                <button class="milestone-del" onclick="deleteMilestoneItem(${m.id})" title="삭제">&times;</button>
            </div>`;
    });
    container.innerHTML = html;
}

async function addMilestone() {
    const name = prompt('단계 이름 (예: EVT1 검증, 양산 대응):');
    if (!name || !name.trim()) return;

    const due_date = prompt('마감일 (YYYY-MM-DD):', todayStr);
    if (!due_date || !due_date.match(/^\d{4}-\d{2}-\d{2}$/)) {
        alert('날짜 형식이 올바르지 않습니다. (예: 2026-05-15)');
        return;
    }

    try {
        const resp = await fetch(`/api/projects/${currentProjectId}/milestones`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name: name.trim(), due_date}),
        });
        if (!resp.ok) {
            const data = await resp.json();
            alert(data.error || '추가 실패');
            return;
        }
        loadDashboard();
    } catch (e) {
        alert('오류: ' + e.message);
    }
}

async function editMilestoneName(id, el) {
    const current = el.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = current;
    input.className = 'milestone-edit-input';
    el.replaceWith(input);
    input.focus();
    input.select();

    const save = async () => {
        const newVal = input.value.trim();
        if (newVal && newVal !== current) {
            await fetch(`/api/milestones/${id}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({name: newVal}),
            });
        }
        loadDashboard();
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
}

async function editMilestoneDate(id, el) {
    const current = el.textContent;
    const input = document.createElement('input');
    input.type = 'date';
    input.value = current;
    input.className = 'milestone-edit-input';
    el.replaceWith(input);
    input.focus();

    const save = async () => {
        const newVal = input.value;
        if (newVal && newVal !== current) {
            await fetch(`/api/milestones/${id}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({due_date: newVal}),
            });
        }
        loadDashboard();
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
}

async function deleteMilestoneItem(id) {
    if (!confirm('이 단계를 삭제하시겠습니까?')) return;
    try {
        await fetch(`/api/milestones/${id}`, {method: 'DELETE'});
        loadDashboard();
    } catch (e) {
        alert('삭제 실패: ' + e.message);
    }
}

// === Tab Switching ===
function showTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    if (!currentData) return;
    if (tab === 'active') renderTable(currentData.common.concat(currentData.system_only));
    else renderTable(currentData.vendor_only);
}

// === Dashboard Loading (from DB) ===
async function loadDashboard() {
    if (!currentProjectId) return;
    try {
        const resp = await fetch(`/api/projects/${currentProjectId}/dashboard`);
        const data = await resp.json();
        if (data.error) return;

        const summary = data.summary || {};
        const issues = data.issues || [];

        // Milestones (always show, even without issues)
        renderMilestones(data.milestones || []);

        if (issues.length === 0) {
            // No issues yet - show dashboard only if milestones exist
            document.getElementById('exportBtn').style.display = 'none';
            if ((data.milestones || []).length > 0) {
                document.getElementById('dashboard').classList.add('active');
            } else {
                document.getElementById('dashboard').classList.remove('active');
            }
            return;
        }

        // Summary cards
        document.getElementById('statTotal').textContent = summary.total || 0;
        document.getElementById('statOngoing').textContent = summary.total || 0;
        document.getElementById('statNew').textContent = 0;
        document.getElementById('statCompleted').textContent = 0;

        // Tab counts
        document.getElementById('tabCountActive').textContent = summary.total || 0;
        document.getElementById('tabCountResolved').textContent = 0;

        // Charts
        renderBarChart('chartStatus', summary.status || {});
        renderBarChart('chartModule', summary.module || {});
        renderBarChart('chartOwner', summary.owner || {});
        document.getElementById('chartDays').innerHTML = '<div style="color:#999;font-size:0.9em;">Compare 실행 시 표시됩니다</div>';

        // Table - convert DB format to display format
        const tableIssues = issues.map(i => ({
            ID: i.id,
            HEADLINE: i.headline,
            Status: i.current_status,
            Module: i.module,
            Owner: i.owner,
            Tag: i.tag,
            'Days since Opened': '',
            Comments: [],
        }));
        renderTable(tableIssues);
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.tab-btn').classList.add('active');

        // Timeline & bottleneck
        renderTimelines(data.timelines);
        renderBottleneck(data.bottleneck);

        // Show dashboard & export button
        document.getElementById('dashboard').classList.add('active');
        document.getElementById('exportBtn').style.display = 'inline-block';
    } catch (e) {
        console.error('Dashboard load error:', e);
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
    formData.append('project_id', currentProjectId || 1);

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

        // Reload timeline & bottleneck
        loadDashboard();

    } catch (err) {
        errorMsg.textContent = 'Error: ' + err.message;
        errorMsg.style.display = 'block';
    } finally {
        loading.classList.remove('active');
        compareBtn.disabled = false;
    }
}

function doDownload() {
    window.location.href = `/download?project_id=${currentProjectId || 1}`;
}

function doExportIssues() {
    window.location.href = `/export-issues?project_id=${currentProjectId || 1}`;
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

// === Init ===
loadProjects().then(() => loadDashboard());
