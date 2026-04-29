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
    if (s === 'reopened') return 'badge-reopened';
    return 'badge-progress';
}

// === Project Management ===
async function loadProjects() {
    try {
        const resp = await fetch('/api/projects');
        const data = await resp.json();
        const select = document.getElementById('projectSelect');
        select.innerHTML = '';
        const projects = data.projects || [];
        const groups = {};
        projects.forEach(p => {
            const g = p.group_name || '';
            if (!groups[g]) groups[g] = [];
            groups[g].push(p);
        });
        Object.entries(groups).forEach(([groupName, items]) => {
            if (groupName && Object.keys(groups).length > 1) {
                const optgroup = document.createElement('optgroup');
                optgroup.label = groupName;
                items.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    optgroup.appendChild(opt);
                });
                select.appendChild(optgroup);
            } else {
                items.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = groupName ? `${p.name}` : p.name;
                    select.appendChild(opt);
                });
            }
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

    // Clear file inputs to prevent cross-project contamination
    vendorFile.value = '';
    systemFile.value = '';
    vendorPasteArea.value = '';
    document.getElementById('vendorName').textContent = '';
    document.getElementById('systemName').textContent = '';
    document.getElementById('vendorBox').classList.remove('has-file');
    document.getElementById('systemBox').classList.remove('has-file');
    vendorPasteBox.classList.remove('has-data');
    document.getElementById('saveBtn').style.display = 'none';
    document.getElementById('previewBanner').style.display = 'none';
    checkReady();

    loadDashboard();
}

async function addProject() {
    const group_name = prompt('그룹명 (업체명 등, 생략 가능):') || '';
    const name = prompt('프로젝트 이름:');
    if (!name || !name.trim()) return;
    try {
        const resp = await fetch('/api/projects', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name: name.trim(), group_name: group_name.trim()}),
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

function checkReady() {
    const systemOk = systemFile.files.length > 0;
    compareBtn.disabled = !systemOk;
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
    let html = '';
    entries.forEach(([label, value], i) => {
        const pct = maxVal > 0 ? (value / maxVal * 100) : 0;
        const color = COLORS[i % COLORS.length];
        html += `<div class="bar-row"><div class="bar-label" title="${label}">${label || '(empty)'}</div><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}">${value}</div></div></div>`;
    });
    container.innerHTML = html;
}

function renderDonutChart(containerId, data) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const entries = Object.entries(data).sort((a,b) => b[1] - a[1]);
    if (!entries.length) {
        container.innerHTML = '<div style="color:#999;font-size:0.9em;">No data</div>';
        return;
    }
    const total = entries.reduce((s, e) => s + e[1], 0);
    const svgSize = 360;
    const cx = svgSize / 2, cy = svgSize / 2, r = 95, inner = 60, labelR = 130;

    let angle = -90;
    let arcs = '', labels = '';

    entries.forEach(([label, value], i) => {
        const pct = value / total;
        const sweep = pct * 360;
        const startAngle = angle;
        const endAngle = angle + sweep;
        const midAngle = (startAngle + endAngle) / 2;
        const largeArc = sweep > 180 ? 1 : 0;
        const rad1 = startAngle * Math.PI / 180;
        const rad2 = endAngle * Math.PI / 180;
        const midRad = midAngle * Math.PI / 180;
        const color = COLORS[i % COLORS.length];

        // Donut arc
        const x1 = cx + r * Math.cos(rad1), y1 = cy + r * Math.sin(rad1);
        const x2 = cx + r * Math.cos(rad2), y2 = cy + r * Math.sin(rad2);
        const ix1 = cx + inner * Math.cos(rad2), iy1 = cy + inner * Math.sin(rad2);
        const ix2 = cx + inner * Math.cos(rad1), iy2 = cy + inner * Math.sin(rad1);
        const path = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${inner} ${inner} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;
        arcs += `<path d="${path}" fill="${color}" stroke="white" stroke-width="1.5"><title>${label}: ${value} (${Math.round(pct*100)}%)</title></path>`;

        // Label with leader line
        const arcMidX = cx + (r + 4) * Math.cos(midRad);
        const arcMidY = cy + (r + 4) * Math.sin(midRad);
        const lblX = cx + labelR * Math.cos(midRad);
        const lblY = cy + labelR * Math.sin(midRad);
        const textAnchor = midAngle > -90 && midAngle < 90 ? 'start' : 'end';
        const textX = lblX + (textAnchor === 'start' ? 4 : -4);
        const pctText = Math.round(pct * 100);
        const displayLabel = label.length > 14 ? label.substring(0, 12) + '..' : label;

        labels += `<line x1="${arcMidX}" y1="${arcMidY}" x2="${lblX}" y2="${lblY}" stroke="${color}" stroke-width="1" opacity="0.6"/>`;
        labels += `<text x="${textX}" y="${lblY - 2}" text-anchor="${textAnchor}" fill="${color}" font-size="13" font-weight="600">${displayLabel}</text>`;
        labels += `<text x="${textX}" y="${lblY + 14}" text-anchor="${textAnchor}" fill="#888" font-size="11">${value} (${pctText}%)</text>`;

        angle = endAngle;
    });

    const svg = `<svg width="${svgSize}" height="${svgSize}" viewBox="0 0 ${svgSize} ${svgSize}" style="overflow:visible">
        ${arcs}${labels}
        <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="#333" font-size="28" font-weight="700">${total}</text>
    </svg>`;

    container.innerHTML = `<div style="display:flex;justify-content:center">${svg}</div>`;
}

function renderTable(issues) {
    const tbody = document.getElementById('issueTableBody');
    let html = '';
    issues.forEach((issue, idx) => {
        const comments = (issue.Comments || []).map(c => `<div>${escHtml(c)}</div>`).join('');
        html += `<tr>
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
    tbody.innerHTML = html;
}

function renderTimelines(timelines) {
    const container = document.getElementById('timelineContainer');
    if (!timelines || !timelines.length) {
        container.innerHTML = '<div style="color:#999;font-size:0.9em;">No history data yet.</div>';
        return;
    }

    // Find global date range
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

    // Date axis labels
    const dateLabels = [];
    const labelStep = totalDays <= 14 ? 1 : totalDays <= 30 ? 3 : totalDays <= 60 ? 7 : 14;
    for (let d = 0; d <= totalDays; d += labelStep) {
        const dt = new Date(globalStart.getTime() + d * 86400000);
        dateLabels.push({label: `${dt.getMonth()+1}/${dt.getDate()}`, pct: (d / totalDays) * 100});
    }

    // Detect weekends for shading
    let weekendBands = '';
    for (let d = 0; d <= totalDays; d++) {
        const dt = new Date(globalStart.getTime() + d * 86400000);
        const dow = dt.getDay(); // 0=Sun, 6=Sat
        if (dow === 0 || dow === 6) {
            const leftPct = (d / totalDays) * 100;
            const widthPct = (1 / totalDays) * 100;
            weekendBands += `<div class="tl-weekend-band" style="left:${leftPct}%;width:${widthPct}%"></div>`;
        }
    }

    let axisHtml = '<div class="tl-axis">';
    dateLabels.forEach(dl => {
        // Check if this date is weekend
        const dlDate = new Date(globalStart.getTime() + (dl.pct / 100) * totalDays * 86400000);
        const isWeekend = dlDate.getDay() === 0 || dlDate.getDay() === 6;
        const labelClass = isWeekend ? 'tl-axis-label tl-axis-weekend' : 'tl-axis-label';
        axisHtml += `<span class="${labelClass}" style="left:${dl.pct}%">${dl.label}</span>`;
    });
    axisHtml += '</div>';

    // Today position
    const todayPct = Math.min((Math.ceil((todayDate - globalStart) / 86400000) / totalDays) * 100, 100);
    const minTrackWidth = Math.max(totalDays * 14, 400);

    // Build rows
    let labelsHtml = '';
    let tracksHtml = '';
    timelines.forEach(t => {
        const totalIssueDays = t.history.reduce((s, h) => s + (h.days || 1), 0);

        // Dots and connecting lines
        let dotsHtml = '';
        t.history.forEach((h, i) => {
            const start = new Date(h.started_at);
            const startDay = Math.max(Math.ceil((start - globalStart) / 86400000), 0);
            const leftPct = (startDay / totalDays) * 100;
            const color = getStatusColor(h.status);
            const days = h.days || 1;
            const isLast = (i === t.history.length - 1);
            const dotSize = isLast ? 'tl-dot-current' : '';
            const dateStr = h.started_at;
            const tooltip = `${h.status} (${days}d)\n${dateStr}`;

            // Connecting line to next dot (or to today for last)
            if (i < t.history.length - 1) {
                const nextStart = new Date(t.history[i+1].started_at);
                const nextDay = Math.max(Math.ceil((nextStart - globalStart) / 86400000), 0);
                const nextPct = (nextDay / totalDays) * 100;
                dotsHtml += `<div class="tl-line" style="left:${leftPct}%;width:${nextPct - leftPct}%;border-color:${color}"></div>`;
            } else if (!h.ended_at) {
                // Last segment, ongoing - line to today
                dotsHtml += `<div class="tl-line tl-line-active" style="left:${leftPct}%;width:${todayPct - leftPct}%;border-color:${color}"></div>`;
            }

            // Dot
            dotsHtml += `<div class="tl-dot ${dotSize}" style="left:${leftPct}%;background:${color};border-color:${color}" title="${tooltip}"></div>`;

            // Status label below dot (only current status always visible)
            const labelClass = isLast ? 'tl-dot-label tl-dot-label-current' : 'tl-dot-label';
            const labelAlign = leftPct < 10 ? 'transform:translateX(0)' : leftPct > 90 ? 'transform:translateX(-100%)' : 'transform:translateX(-50%)';
            dotsHtml += `<span class="${labelClass}" style="left:${leftPct}%;${labelAlign}">${escHtml(h.status)}</span>`;
        });

        labelsHtml += `
            <div class="tl-label-row">
                <span class="tl-id">${escHtml(t.id)}</span>
                <span class="tl-headline" title="${escHtml(t.headline)}">${escHtml(t.headline)}</span>
            </div>`;

        tracksHtml += `
            <div class="tl-track-row">
                <div class="tl-track">
                    ${dotsHtml}
                    ${weekendBands}
                    <div class="tl-today-line" style="left:${todayPct}%"></div>
                </div>
                <span class="tl-days">${totalIssueDays}d</span>
            </div>`;
    });

    // Legend
    const usedStatuses = new Set();
    timelines.forEach(t => t.history.forEach(h => usedStatuses.add(h.status)));
    let legendHtml = '<div class="tl-legend">';
    usedStatuses.forEach(s => {
        legendHtml += `<span class="tl-legend-item"><span class="tl-legend-dot" style="background:${getStatusColor(s)}"></span>${escHtml(s)}</span>`;
    });
    legendHtml += `<span class="tl-legend-item"><span class="tl-legend-today"></span>Today</span>`;
    legendHtml += '</div>';

    container.innerHTML = `
        <div class="tl-chart">
            ${legendHtml}
            <div class="tl-body">
                <div class="tl-labels-col">
                    <div class="tl-label-header"></div>
                    ${labelsHtml}
                </div>
                <div class="tl-tracks-scroll">
                    <div class="tl-tracks-inner" style="min-width:${minTrackWidth}px">
                        ${axisHtml}
                        ${tracksHtml}
                    </div>
                </div>
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

    const critical = bottleneck.stalled.filter(s => s.level === 'critical');
    const warning = bottleneck.stalled.filter(s => s.level === 'warning');

    let html = '';
    if (critical.length) {
        html += `<div class="stalled-group-label stalled-critical-label">🔴 Critical (7+ days) - ${critical.length}</div>`;
        critical.forEach(s => {
            html += `<div class="stalled-item stalled-critical">
                <div class="stalled-info"><span class="stalled-id">${escHtml(s.issue_id)}</span><span class="stalled-status"> - ${escHtml(s.status)}</span></div>
                <div class="stalled-days">${s.days_in_status}d</div>
            </div>`;
        });
    }
    if (warning.length) {
        html += `<div class="stalled-group-label stalled-warning-label">⚠️ Warning (3~6 days) - ${warning.length}</div>`;
        warning.forEach(s => {
            html += `<div class="stalled-item stalled-warning">
                <div class="stalled-info"><span class="stalled-id">${escHtml(s.issue_id)}</span><span class="stalled-status"> - ${escHtml(s.status)}</span></div>
                <div class="stalled-days">${s.days_in_status}d</div>
            </div>`;
        });
    }
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

// === Project Notes ===
function renderNotes(notes) {
    const display = document.getElementById('notesDisplay');
    if (notes && notes.trim()) {
        display.innerHTML = escHtml(notes).replace(/\n/g, '<br>');
    } else {
        display.innerHTML = '<span style="color:#999">메모를 추가하려면 ✎ 버튼을 클릭하세요.</span>';
    }
    document.getElementById('notesEditor').value = notes || '';
}

function toggleNotesEdit() {
    const display = document.getElementById('notesDisplay');
    const editor = document.getElementById('notesEditor');
    const btn = document.getElementById('notesEditBtn');

    if (editor.style.display === 'none') {
        editor.style.display = '';
        display.style.display = 'none';
        btn.innerHTML = '&#10003;';
        btn.title = '저장';
        editor.focus();
    } else {
        saveNotes();
    }
}

async function saveNotes() {
    const editor = document.getElementById('notesEditor');
    const display = document.getElementById('notesDisplay');
    const btn = document.getElementById('notesEditBtn');
    const notes = editor.value;

    try {
        await fetch(`/api/projects/${currentProjectId}/notes`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({notes}),
        });
    } catch (e) {
        console.error('Notes save error:', e);
    }

    renderNotes(notes);
    editor.style.display = 'none';
    display.style.display = '';
    btn.innerHTML = '&#9998;';
    btn.title = '편집';
}

// === Trend Chart ===
function renderTrend(snapshots) {
    const section = document.getElementById('trendSection');
    const container = document.getElementById('trendChart');
    if (!snapshots || snapshots.length < 2) {
        section.style.display = 'none';
        return;
    }
    section.style.display = '';

    const W = 700, H = 260, padL = 50, padR = 20, padT = 20, padB = 60;
    const chartW = W - padL - padR, chartH = H - padT - padB;

    // Data series
    const dates = snapshots.map(s => s.record_date);
    const series = [
        {key: 'total', label: 'Total', color: '#1e3a5f', values: snapshots.map(s => s.total)},
        {key: 'ongoing', label: 'Ongoing', color: '#0d6efd', values: snapshots.map(s => s.ongoing)},
        {key: 'new_count', label: 'Assigned', color: '#28a745', values: snapshots.map(s => s.new_count)},
        {key: 'reopened', label: 'Reopened', color: '#fd7e14', values: snapshots.map(s => s.reopened)},
        {key: 'resolved', label: 'Resolved', color: '#6c757d', values: snapshots.map(s => s.resolved)},
    ];

    const allVals = series.flatMap(s => s.values);
    const maxVal = Math.max(...allVals, 1);
    const n = dates.length;

    const x = (i) => padL + (i / (n - 1)) * chartW;
    const y = (v) => padT + chartH - (v / maxVal) * chartH;

    let svg = '';

    // Grid lines
    const gridSteps = 5;
    for (let i = 0; i <= gridSteps; i++) {
        const val = Math.round((maxVal / gridSteps) * i);
        const yPos = y(val);
        svg += `<line x1="${padL}" y1="${yPos}" x2="${W - padR}" y2="${yPos}" stroke="#eee" stroke-width="1"/>`;
        svg += `<text x="${padL - 8}" y="${yPos + 4}" text-anchor="end" fill="#999" font-size="10">${val}</text>`;
    }

    // Lines for each series
    series.forEach(s => {
        let path = '';
        s.values.forEach((v, i) => {
            const px = x(i), py = y(v);
            path += i === 0 ? `M ${px} ${py}` : ` L ${px} ${py}`;
        });
        const strokeW = s.key === 'total' ? 2.5 : 1.5;
        const dash = s.key === 'total' ? '' : 'stroke-dasharray="none"';
        svg += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${strokeW}" ${dash}/>`;
        // Dots
        s.values.forEach((v, i) => {
            svg += `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${s.color}"><title>${s.label}: ${v} (${dates[i]})</title></circle>`;
        });
    });

    // X axis labels
    const labelStep = n <= 10 ? 1 : n <= 20 ? 2 : Math.ceil(n / 10);
    dates.forEach((d, i) => {
        if (i % labelStep !== 0 && i !== n - 1) return;
        const dt = new Date(d);
        const label = `${dt.getMonth()+1}/${dt.getDate()}`;
        const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
        const color = isWeekend ? '#dc3545' : '#999';
        svg += `<text x="${x(i)}" y="${H - padB + 18}" text-anchor="middle" fill="${color}" font-size="10">${label}</text>`;
    });

    // Legend
    let legendX = padL;
    series.forEach(s => {
        svg += `<line x1="${legendX}" y1="${H - 10}" x2="${legendX + 16}" y2="${H - 10}" stroke="${s.color}" stroke-width="2"/>`;
        svg += `<text x="${legendX + 20}" y="${H - 6}" fill="#555" font-size="10">${s.label}</text>`;
        legendX += 90;
    });

    container.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="overflow:visible">${svg}</svg>`;
}

// === Tab Switching ===
function showTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    if (!currentData) return;
    if (tab === 'active') renderTable(currentData.common.concat(currentData.system_only));
    else renderTable(currentData.vendor_only);
}

// === Timeline-only reload (after Compare) ===
async function loadTimelineData() {
    if (!currentProjectId) return;
    try {
        const resp = await fetch(`/api/projects/${currentProjectId}/dashboard`);
        const data = await resp.json();
        if (data.error) return;
        renderMilestones(data.milestones || []);
        renderNotes(data.notes || '');
        renderTimelines(data.timelines);
        renderTrend(data.snapshots);
        renderBottleneck(data.bottleneck);
    } catch (e) {
        console.error('Timeline load error:', e);
    }
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

        // Milestones & Notes (always show, even without issues)
        renderMilestones(data.milestones || []);
        renderNotes(data.notes || '');

        if (issues.length === 0) {
            // No issues yet - show dashboard only if milestones exist
            document.getElementById('dashboardExportBar').style.display = 'none';
            document.getElementById('exportBtn').style.display = 'none';
            if ((data.milestones || []).length > 0) {
                document.getElementById('dashboard').classList.add('active');
            } else {
                document.getElementById('dashboard').classList.remove('active');
            }
            return;
        }

        // Summary cards - all from issue_events (lifecycle based)
        const evts = data.event_counts || {};
        const assigned = evts.created || 0;
        const reopened = evts.reopened || 0;
        const resolved = evts.resolved || 0;
        const total = summary.total || 0;
        const ongoing = total - assigned - reopened;
        document.getElementById('statTotal').textContent = total;
        document.getElementById('statAssigned').textContent = assigned;
        document.getElementById('statReopened').textContent = reopened;
        document.getElementById('statResolved').textContent = resolved;

        // Tab counts
        document.getElementById('tabCountActive').textContent = total;
        document.getElementById('tabCountResolved').textContent = resolved;

        // Charts
        renderDonutChart('chartStatus', summary.status || {});
        renderDonutChart('chartModule', summary.module || {});
        renderDonutChart('chartOwner', summary.owner || {});
        document.getElementById('chartDays').innerHTML = '<div style="color:#999;font-size:0.9em;">Compare 실행 시 표시됩니다</div>';

        // Table - convert DB format to display format
        const tableIssues = issues.map(i => ({
            ID: i.id,
            HEADLINE: i.headline,
            Status: i.current_status,
            Module: i.module,
            Owner: i.owner,
            Tag: i.tag,
            'Days since Opened': i.days_since_opened || '',
            Comments: i.comments ? i.comments.split('\n').filter(c => c) : [],
        }));
        renderTable(tableIssues);
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.tab-btn').classList.add('active');

        // Timeline, trend & bottleneck
        renderTimelines(data.timelines);
        renderTrend(data.snapshots);
        renderBottleneck(data.bottleneck);

        // Show dashboard & export bar
        document.getElementById('dashboard').classList.add('active');
        document.getElementById('dashboardExportBar').style.display = 'flex';
        document.getElementById('exportBtn').style.display = 'inline-block';
    } catch (e) {
        console.error('Dashboard load error:', e);
    }
}

// === Compare Action ===
async function doCompare() {
    const formData = new FormData();
    if (vendorMode === 'file' && vendorFile.files.length > 0) {
        formData.append('vendor_file', vendorFile.files[0]);
    } else if (vendorMode === 'paste' && vendorPasteArea.value.trim()) {
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

        // Summary cards - lifecycle based (not vendor status)
        const assigned = (data.system_only || []).filter(i => i.Status === 'New').length;
        const reopened = (data.common || []).filter(i => i.Status === 'Reopened').length
                       + (data.system_only || []).filter(i => i.Status === 'Reopened').length;
        const resolved = (data.vendor_only || []).length;
        const total = data.stats.summary.total_active;
        const ongoing = total - assigned - reopened;
        document.getElementById('statTotal').textContent = total;
        document.getElementById('statAssigned').textContent = assigned;
        document.getElementById('statReopened').textContent = reopened;
        document.getElementById('statResolved').textContent = resolved;

        // Tab counts
        document.getElementById('tabCountActive').textContent = total;
        document.getElementById('tabCountResolved').textContent = resolved;

        // Charts
        renderDonutChart('chartStatus', data.stats.status);
        renderBarChart('chartDays', data.stats.days_distribution);
        renderDonutChart('chartModule', data.stats.module);
        renderDonutChart('chartOwner', data.stats.owner);

        // Table
        renderTable(data.common.concat(data.system_only));
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.tab-btn').classList.add('active');

        // Show dashboard
        document.getElementById('dashboard').classList.add('active');
        document.getElementById('dashboardExportBar').style.display = 'flex';
        document.getElementById('exportBtn').style.display = 'inline-block';

        // Show Save button (preview mode - not saved to DB yet)
        document.getElementById('saveBtn').style.display = 'inline-block';
        document.getElementById('previewBanner').style.display = 'block';

    } catch (err) {
        errorMsg.textContent = 'Error: ' + err.message;
        errorMsg.style.display = 'block';
    } finally {
        loading.classList.remove('active');
        compareBtn.disabled = false;
    }
}

async function doSaveCompare() {
    const projectName = document.getElementById('projectSelect')?.selectedOptions[0]?.textContent || '';
    if (!confirm(`"${projectName}" 프로젝트에 저장합니다.\n계속하시겠습니까?`)) return;

    try {
        const resp = await fetch('/compare/save', { method: 'POST' });
        const data = await resp.json();
        if (!resp.ok) {
            alert(data.error || '저장 실패');
            return;
        }
        document.getElementById('saveBtn').style.display = 'none';
        document.getElementById('previewBanner').style.display = 'none';
        loadTimelineData();
    } catch (e) {
        alert('저장 오류: ' + e.message);
    }
}

async function doExportIssues() {
    // Collect data from current table
    const rows = document.querySelectorAll('#issueTableBody tr');
    const issues = [];
    rows.forEach(tr => {
        const cells = tr.querySelectorAll('td');
        if (cells.length >= 9) {
            issues.push({
                id: cells[1].textContent.trim(),
                headline: cells[2].textContent.trim(),
                current_status: cells[3].textContent.trim(),
                comments: cells[8].innerText.trim(),
                module: cells[4].textContent.trim(),
                owner: cells[5].textContent.trim(),
                days: cells[6].textContent.trim(),
                tag: cells[7].textContent.trim(),
            });
        }
    });

    if (!issues.length) {
        alert('내보낼 이슈가 없습니다.');
        return;
    }

    try {
        const resp = await fetch('/export-issues', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({issues}),
        });
        if (!resp.ok) {
            const data = await resp.json();
            alert(data.error || 'Export failed');
            return;
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `issue_list_${todayStr.replace(/-/g,'')}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        alert('Export 오류: ' + e.message);
    }
}

function doPostmortemExport() {
    window.location.href = `/api/projects/${currentProjectId}/postmortem`;
}

// === Copy for Confluence ===
function copyForConfluence() {
    const cs = (k) => document.getElementById(k)?.textContent || '0';
    const projectName = document.getElementById('projectSelect')?.selectedOptions[0]?.textContent || '';

    let html = '';

    // Title
    html += `<h2 style="color:#1e3a5f;border-bottom:3px solid #1e3a5f;padding-bottom:8px">📋 ${escHtml(projectName)} Issue Report (${todayStr})</h2>`;

    // Summary cards - visual colored boxes
    html += `<table style="border-collapse:separate;border-spacing:8px;margin-bottom:20px">
        <tr>
            <td style="padding:16px 28px;text-align:center;background:#1e3a5f;color:white;font-weight:bold;border-radius:8px;min-width:100px"><div style="font-size:2em;margin-bottom:4px">${cs('statTotal')}</div><div style="font-size:0.85em;opacity:0.9">Total Active</div></td>
            <td style="padding:16px 28px;text-align:center;background:#e8f8e8;border-radius:8px;min-width:100px"><div style="font-size:2em;color:#28a745;font-weight:bold;margin-bottom:4px">${cs('statAssigned')}</div><div style="font-size:0.85em;color:#28a745">Assigned</div></td>
            <td style="padding:16px 28px;text-align:center;background:#fff3cd;border-radius:8px;min-width:100px"><div style="font-size:2em;color:#fd7e14;font-weight:bold;margin-bottom:4px">${cs('statReopened')}</div><div style="font-size:0.85em;color:#fd7e14">Reopened</div></td>
            <td style="padding:16px 28px;text-align:center;background:#f0f0f0;border-radius:8px;min-width:100px"><div style="font-size:2em;color:#6c757d;font-weight:bold;margin-bottom:4px">${cs('statResolved')}</div><div style="font-size:0.85em;color:#6c757d">Resolved</div></td>
        </tr>
    </table>`;

    // Milestones with emoji indicators
    const milestoneItems = document.querySelectorAll('.milestone-item');
    if (milestoneItems.length > 0) {
        html += `<h3 style="color:#1e3a5f">🎯 Milestones</h3>`;
        html += `<table style="border-collapse:collapse;margin-bottom:20px;width:auto">
            <tr><th style="padding:8px 16px;border:1px solid #ddd;background:#1e3a5f;color:white">Phase</th><th style="padding:8px 16px;border:1px solid #ddd;background:#1e3a5f;color:white">Due Date</th><th style="padding:8px 16px;border:1px solid #ddd;background:#1e3a5f;color:white">D-Day</th><th style="padding:8px 16px;border:1px solid #ddd;background:#1e3a5f;color:white">Status</th></tr>`;
        milestoneItems.forEach(item => {
            const name = item.querySelector('.milestone-name')?.textContent || '';
            const date = item.querySelector('.milestone-date')?.textContent || '';
            const dday = item.querySelector('.milestone-dday')?.textContent || '';
            const ddayEl = item.querySelector('.milestone-dday');
            let color = '#333', emoji = '🟢', bg = '#f0fff0';
            if (ddayEl?.classList.contains('dday-over')) { color = '#dc3545'; emoji = '🔴'; bg = '#fff0f0'; }
            else if (ddayEl?.classList.contains('dday-danger')) { color = '#dc3545'; emoji = '🔴'; bg = '#fff0f0'; }
            else if (ddayEl?.classList.contains('dday-warn')) { color = '#fd7e14'; emoji = '🟡'; bg = '#fffbe6'; }
            else if (ddayEl?.classList.contains('dday-safe')) { color = '#0d6efd'; emoji = '🟢'; bg = '#f0fff0'; }
            html += `<tr style="background:${bg}"><td style="padding:8px 16px;border:1px solid #ddd;font-weight:600">${escHtml(name)}</td><td style="padding:8px 16px;border:1px solid #ddd">${escHtml(date)}</td><td style="padding:8px 16px;border:1px solid #ddd;font-weight:bold;color:${color}">${escHtml(dday)}</td><td style="padding:8px 16px;border:1px solid #ddd;text-align:center;font-size:1.2em">${emoji}</td></tr>`;
        });
        html += `</table>`;
    }

    // Issue table - status as colored bold text (no background, readable everywhere)
    const issueTable = document.querySelector('.issue-table');
    if (issueTable) {
        html += `<h3 style="color:#1e3a5f">📝 Issue Details</h3>`;
        html += `<table style="border-collapse:collapse;margin-bottom:16px;width:100%">`;
        const ths = issueTable.querySelectorAll('thead th');
        html += '<tr>';
        ths.forEach(th => {
            html += `<th style="padding:8px 10px;border:1px solid #ddd;background:#1e3a5f;color:white;font-size:0.85em;white-space:nowrap">${th.textContent}</th>`;
        });
        html += '</tr>';
        const trs = issueTable.querySelectorAll('tbody tr');
        trs.forEach((tr, i) => {
            const bg = i % 2 === 0 ? '#ffffff' : '#f8f9fa';
            html += `<tr style="background:${bg}">`;
            tr.querySelectorAll('td').forEach((td, ci) => {
                let content;
                if (ci === 8) {
                    // Comments: preserve line breaks (div → br)
                    content = td.innerHTML.replace(/<div>/g, '').replace(/<\/div>/g, '<br>').trim();
                    if (content.endsWith('<br>')) content = content.slice(0, -4);
                } else {
                    content = td.textContent.trim();
                }
                if (ci === 3) {
                    const badge = td.querySelector('.badge');
                    let color = '#0d6efd';
                    if (badge?.classList.contains('badge-new')) color = '#28a745';
                    else if (badge?.classList.contains('badge-reopened')) color = '#fd7e14';
                    else if (badge?.classList.contains('badge-closed')) color = '#6c757d';
                    content = `<strong style="color:${color}">${content}</strong>`;
                }
                html += `<td style="padding:5px 8px;border:1px solid #ddd;font-size:0.85em">${content}</td>`;
            });
            html += '</tr>';
        });
        html += `</table>`;
    }

    // Copy to clipboard as HTML (with fallback for HTTP)
    const onSuccess = () => {
        const btn = document.querySelector('.btn-copy-sm');
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.background = '#28a745';
        setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 2000);
    };

    if (navigator.clipboard && window.ClipboardItem) {
        const blob = new Blob([html], {type: 'text/html'});
        navigator.clipboard.write([new ClipboardItem({'text/html': blob})]).then(onSuccess).catch(() => fallbackCopy(html, onSuccess));
    } else {
        fallbackCopy(html, onSuccess);
    }
}

function fallbackCopy(html, onSuccess) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.style.position = 'fixed';
    tmp.style.left = '-9999px';
    document.body.appendChild(tmp);
    const range = document.createRange();
    range.selectNodeContents(tmp);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    try {
        document.execCommand('copy');
        onSuccess();
    } catch (e) {
        alert('복사 실패: ' + e.message);
    }
    sel.removeAllRanges();
    document.body.removeChild(tmp);
}

// === Landing Screen ===
async function showLanding() {
    try {
        const resp = await fetch('/api/projects');
        const data = await resp.json();
        const projects = data.projects || [];

        // If only 1 project (Default), skip landing
        if (projects.length <= 1) {
            selectProjectFromLanding(projects[0]?.id || 1);
            return;
        }

        const list = document.getElementById('landingProjectList');
        list.innerHTML = '';

        // Group projects by group_name
        const groups = {};
        projects.forEach(p => {
            const g = p.group_name || '미분류';
            if (!groups[g]) groups[g] = [];
            groups[g].push(p);
        });

        Object.entries(groups).forEach(([groupName, items]) => {
            list.innerHTML += `<div class="landing-group-label">${escHtml(groupName)}</div>`;
            items.forEach(p => {
                const dateText = p.last_accessed ? new Date(p.last_accessed).toLocaleDateString() : '';
                list.innerHTML += `
                    <div class="landing-project-item" onclick="selectProjectFromLanding(${p.id})">
                        <span class="landing-project-icon">📁</span>
                        <span class="landing-project-name">${escHtml(p.name)}</span>
                        <span class="landing-project-date">${dateText}</span>
                    </div>`;
            });
        });

        document.getElementById('projectLanding').style.display = 'flex';
        document.getElementById('appMain').style.display = 'none';
    } catch (e) {
        console.error('Landing error:', e);
        selectProjectFromLanding(1);
    }
}

async function selectProjectFromLanding(projectId) {
    currentProjectId = projectId;
    localStorage.setItem('selectedProjectId', projectId);

    document.getElementById('projectLanding').style.display = 'none';
    document.getElementById('appMain').style.display = '';

    await loadProjects();
    document.getElementById('projectSelect').value = projectId;
    currentProjectId = projectId;
    loadDashboard();
}

async function addProjectFromLanding() {
    const group_name = prompt('그룹명 (업체명 등, 생략 가능):') || '';
    const name = prompt('프로젝트 이름:');
    if (!name || !name.trim()) return;
    try {
        const resp = await fetch('/api/projects', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name: name.trim(), group_name: group_name.trim()}),
        });
        const data = await resp.json();
        if (!resp.ok) {
            alert(data.error || '프로젝트 생성 실패');
            return;
        }
        selectProjectFromLanding(data.id);
    } catch (e) {
        alert('오류: ' + e.message);
    }
}

// === Init ===
showLanding();
