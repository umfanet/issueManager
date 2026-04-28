import os
import sqlite3
from datetime import datetime, date
from config import DB_DIR, DB_PATH, STALLED_WARNING_DAYS, STALLED_CRITICAL_DAYS


_db_initialized = False


def get_db():
    """Get database connection. Init/migrate only on first call."""
    global _db_initialized
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    if not _db_initialized:
        _init_tables(conn)
        _migrate(conn)
        _db_initialized = True
    return conn


def _init_tables(conn):
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            last_accessed TEXT
        );

        CREATE TABLE IF NOT EXISTS issues (
            id TEXT PRIMARY KEY,
            headline TEXT,
            module TEXT,
            owner TEXT,
            tag TEXT,
            current_status TEXT,
            first_seen_date TEXT,
            last_updated TEXT
        );

        CREATE TABLE IF NOT EXISTS status_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_id TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            duration_days INTEGER,
            FOREIGN KEY (issue_id) REFERENCES issues(id)
        );

        CREATE INDEX IF NOT EXISTS idx_history_issue
            ON status_history(issue_id);
        CREATE INDEX IF NOT EXISTS idx_history_status
            ON status_history(status);

        CREATE TABLE IF NOT EXISTS milestones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            due_date TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        CREATE INDEX IF NOT EXISTS idx_milestones_project
            ON milestones(project_id);

        CREATE TABLE IF NOT EXISTS daily_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            record_date TEXT NOT NULL,
            total INTEGER NOT NULL DEFAULT 0,
            ongoing INTEGER NOT NULL DEFAULT 0,
            new_count INTEGER NOT NULL DEFAULT 0,
            reopened INTEGER NOT NULL DEFAULT 0,
            resolved INTEGER NOT NULL DEFAULT 0,
            UNIQUE(project_id, record_date),
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        CREATE TABLE IF NOT EXISTS issue_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_id TEXT NOT NULL,
            project_id INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            event_date TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_events_issue
            ON issue_events(issue_id);
        CREATE INDEX IF NOT EXISTS idx_events_project_date
            ON issue_events(project_id, event_date);
    ''')
    conn.commit()


def _migrate(conn):
    """Handle schema migrations for existing databases."""
    # Ensure Default project exists
    conn.execute(
        "INSERT OR IGNORE INTO projects (id, name, created_at) VALUES (1, 'Default', ?)",
        (datetime.now().isoformat(),)
    )

    # Add columns if missing (for DBs created before v0.5.0+)
    columns = [row[1] for row in conn.execute('PRAGMA table_info(issues)').fetchall()]
    if 'project_id' not in columns:
        conn.execute('ALTER TABLE issues ADD COLUMN project_id INTEGER NOT NULL DEFAULT 1')
    if 'last_record_date' not in columns:
        conn.execute("ALTER TABLE issues ADD COLUMN last_record_date TEXT NOT NULL DEFAULT ''")
    if 'comments' not in columns:
        conn.execute("ALTER TABLE issues ADD COLUMN comments TEXT NOT NULL DEFAULT ''")
    if 'days_since_opened' not in columns:
        conn.execute("ALTER TABLE issues ADD COLUMN days_since_opened TEXT NOT NULL DEFAULT ''")

    # Add notes column to projects if missing
    proj_columns = [row[1] for row in conn.execute('PRAGMA table_info(projects)').fetchall()]
    if 'notes' not in proj_columns:
        conn.execute("ALTER TABLE projects ADD COLUMN notes TEXT NOT NULL DEFAULT ''")

    # Create index after columns are guaranteed to exist
    conn.execute('CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id)')

    conn.commit()


# === Project CRUD ===

def get_projects():
    """Return list of all projects."""
    conn = get_db()
    rows = conn.execute(
        'SELECT id, name, created_at, last_accessed FROM projects ORDER BY id'
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_project(name):
    """Create a new project. Returns the new project dict."""
    conn = get_db()
    now = datetime.now().isoformat()
    cursor = conn.execute(
        'INSERT INTO projects (name, created_at) VALUES (?, ?)',
        (name.strip(), now)
    )
    project_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return {'id': project_id, 'name': name.strip(), 'created_at': now}


def rename_project(project_id, new_name):
    """Rename a project."""
    conn = get_db()
    conn.execute(
        'UPDATE projects SET name = ? WHERE id = ?',
        (new_name.strip(), project_id)
    )
    conn.commit()
    conn.close()


def update_project_notes(project_id, notes):
    """Update project notes."""
    conn = get_db()
    conn.execute('UPDATE projects SET notes = ? WHERE id = ?', (notes, project_id))
    conn.commit()
    conn.close()


def get_project_notes(project_id):
    """Get project notes."""
    conn = get_db()
    row = conn.execute('SELECT notes FROM projects WHERE id = ?', (project_id,)).fetchone()
    conn.close()
    return row['notes'] if row and row['notes'] else ''


def delete_project(project_id):
    """Delete project and all its issues + status_history. Cannot delete Default (id=1)."""
    if project_id == 1:
        raise ValueError('Default 프로젝트는 삭제할 수 없습니다.')
    conn = get_db()
    # Delete status_history for issues in this project
    conn.execute(
        'DELETE FROM status_history WHERE issue_id IN (SELECT id FROM issues WHERE project_id = ?)',
        (project_id,)
    )
    conn.execute('DELETE FROM issues WHERE project_id = ?', (project_id,))
    conn.execute('DELETE FROM issue_events WHERE project_id = ?', (project_id,))
    conn.execute('DELETE FROM milestones WHERE project_id = ?', (project_id,))
    conn.execute('DELETE FROM daily_snapshots WHERE project_id = ?', (project_id,))
    conn.execute('DELETE FROM projects WHERE id = ?', (project_id,))
    conn.commit()
    conn.close()


# === Milestone Operations ===

def get_milestones(project_id):
    """Get milestones for a project with calculated D-day."""
    conn = get_db()
    rows = conn.execute(
        'SELECT id, project_id, name, due_date, sort_order FROM milestones WHERE project_id = ? ORDER BY sort_order, due_date',
        (project_id,)
    ).fetchall()
    conn.close()

    today = date.today()
    result = []
    for r in rows:
        due = date.fromisoformat(r['due_date'])
        d_day = (due - today).days
        item = dict(r)
        item['d_day'] = d_day
        result.append(item)
    return result


def add_milestone(project_id, name, due_date):
    """Add a milestone to a project."""
    conn = get_db()
    # Auto sort_order: append at end
    max_order = conn.execute(
        'SELECT COALESCE(MAX(sort_order), -1) FROM milestones WHERE project_id = ?',
        (project_id,)
    ).fetchone()[0]
    cursor = conn.execute(
        'INSERT INTO milestones (project_id, name, due_date, sort_order) VALUES (?, ?, ?, ?)',
        (project_id, name.strip(), due_date, max_order + 1)
    )
    milestone_id = cursor.lastrowid
    conn.commit()
    conn.close()

    d_day = (date.fromisoformat(due_date) - date.today()).days
    return {'id': milestone_id, 'project_id': project_id, 'name': name.strip(),
            'due_date': due_date, 'sort_order': max_order + 1, 'd_day': d_day}


def update_milestone(milestone_id, **kwargs):
    """Update milestone fields (name, due_date, sort_order)."""
    conn = get_db()
    allowed = {'name', 'due_date', 'sort_order'}
    updates = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
    if not updates:
        conn.close()
        return
    set_clause = ', '.join(f'{k} = ?' for k in updates)
    values = list(updates.values()) + [milestone_id]
    conn.execute(f'UPDATE milestones SET {set_clause} WHERE id = ?', values)
    conn.commit()
    conn.close()


def delete_milestone(milestone_id):
    """Delete a milestone."""
    conn = get_db()
    conn.execute('DELETE FROM milestones WHERE id = ?', (milestone_id,))
    conn.commit()
    conn.close()


# === Issue Operations ===

def get_known_issues_map(current_date=None):
    """Return dict of issue IDs -> {module, owner} for issues that existed BEFORE the given date.
    Uses first_seen_date to distinguish:
      - first_seen_date < current_date → was known before → Reopened
      - first_seen_date = current_date → first appeared today → New (even on re-compare)
    """
    conn = get_db()
    if current_date:
        rows = conn.execute(
            "SELECT id, module, owner FROM issues WHERE first_seen_date < ?",
            (current_date,)
        ).fetchall()
    else:
        rows = conn.execute('SELECT id, module, owner FROM issues').fetchall()
    conn.close()
    return {r['id']: {'module': r['module'] or '', 'owner': r['owner'] or ''} for r in rows}


def _latest_record_date(conn, project_id):
    """Get the most recent record_date for a project."""
    row = conn.execute(
        "SELECT MAX(last_record_date) FROM issues WHERE project_id = ? AND last_record_date != ''",
        (project_id,)
    ).fetchone()
    return row[0] if row and row[0] else None


def get_project_issues(project_id):
    """Get active issues for a project (only those seen on the latest record date)."""
    conn = get_db()
    latest = _latest_record_date(conn, project_id)

    if latest:
        rows = conn.execute(
            '''SELECT id, headline, module, owner, tag, current_status, first_seen_date, comments, days_since_opened
               FROM issues
               WHERE project_id = ? AND last_record_date = ?
               ORDER BY first_seen_date''',
            (project_id, latest)
        ).fetchall()
    else:
        rows = conn.execute(
            '''SELECT id, headline, module, owner, tag, current_status, first_seen_date, comments, days_since_opened
               FROM issues
               WHERE project_id = ?
               ORDER BY first_seen_date''',
            (project_id,)
        ).fetchall()

    conn.close()
    return [dict(r) for r in rows]


def get_project_summary(project_id):
    """Get summary statistics for a project (based on latest record date)."""
    conn = get_db()
    latest = _latest_record_date(conn, project_id)
    date_filter = "AND last_record_date = ?" if latest else ""
    params = (project_id, latest) if latest else (project_id,)

    total = conn.execute(
        f'SELECT COUNT(*) FROM issues WHERE project_id = ? {date_filter}', params
    ).fetchone()[0]

    status_counts = conn.execute(
        f'''SELECT current_status, COUNT(*) as cnt
           FROM issues WHERE project_id = ? {date_filter}
           GROUP BY current_status ORDER BY cnt DESC''',
        params
    ).fetchall()

    module_counts = conn.execute(
        f'''SELECT module, COUNT(*) as cnt
           FROM issues WHERE project_id = ? {date_filter}
           GROUP BY module ORDER BY cnt DESC''',
        params
    ).fetchall()

    owner_counts = conn.execute(
        f'''SELECT owner, COUNT(*) as cnt
           FROM issues WHERE project_id = ? {date_filter}
           GROUP BY owner ORDER BY cnt DESC''',
        params
    ).fetchall()

    conn.close()
    return {
        'total': total,
        'status': {r['current_status']: r['cnt'] for r in status_counts},
        'module': {r['module']: r['cnt'] for r in module_counts if r['module']},
        'owner': {r['owner']: r['cnt'] for r in owner_counts if r['owner']},
    }


def upsert_issues(issues, record_date=None, project_id=1):
    """Update or insert issues and track status changes.

    issues: list of dicts with keys: ID/IDWORKITEM, HEADLINE, Status, Module, Owner, Tag
    record_date: date string (YYYY-MM-DD) to use for history. Defaults to today.
    project_id: project to associate issues with.
    Returns: dict with counts of new, updated, status_changed
    """
    conn = get_db()
    today = record_date or date.today().isoformat()
    now = datetime.now().isoformat()

    # Update project last_accessed
    conn.execute('UPDATE projects SET last_accessed = ? WHERE id = ?', (now, project_id))

    counts = {'new': 0, 'updated': 0, 'status_changed': 0}

    for issue in issues:
        issue_id = issue.get('ID') or issue.get('IDWORKITEM', '')
        if not issue_id:
            continue

        status = issue.get('Status', '')
        headline = issue.get('HEADLINE', issue.get('Headline', ''))
        module = issue.get('Module', '')
        owner = issue.get('Owner', '')
        tag = issue.get('Tag', '')
        comments_list = issue.get('Comments', [])
        comments = '\n'.join(comments_list) if isinstance(comments_list, list) else str(comments_list or '')
        days = issue.get('Days since Opened', '')

        # Check if issue exists
        existing = conn.execute(
            'SELECT id, current_status FROM issues WHERE id = ?',
            (issue_id,)
        ).fetchone()

        if existing is None:
            # New issue
            conn.execute(
                '''INSERT INTO issues (id, project_id, headline, module, owner, tag, current_status, first_seen_date, last_updated, last_record_date, comments, days_since_opened)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (issue_id, project_id, headline, module, owner, tag, status, today, now, today, comments, days)
            )
            # Start first status history
            if status:
                conn.execute(
                    '''INSERT INTO status_history (issue_id, status, started_at)
                       VALUES (?, ?, ?)''',
                    (issue_id, status, today)
                )
            counts['new'] += 1

        else:
            # Existing issue - update fields, only update last_record_date if this date is newer
            conn.execute(
                '''UPDATE issues SET headline=?, module=?, owner=?, tag=?, current_status=?, last_updated=?, project_id=?,
                          last_record_date = MAX(COALESCE(last_record_date, ''), ?),
                          comments=?, days_since_opened=?
                   WHERE id=?''',
                (headline, module or existing['module'] if hasattr(existing, '__getitem__') else module,
                 owner, tag, status, now, project_id, today, comments, days, issue_id)
            )
            counts['updated'] += 1

            # Check if status changed
            old_status = existing['current_status']
            if status and status != old_status:
                # Close previous status history
                conn.execute(
                    '''UPDATE status_history
                       SET ended_at = ?,
                           duration_days = CAST(julianday(?) - julianday(started_at) AS INTEGER)
                       WHERE issue_id = ? AND ended_at IS NULL''',
                    (today, today, issue_id)
                )
                # Start new status history
                conn.execute(
                    '''INSERT INTO status_history (issue_id, status, started_at)
                       VALUES (?, ?, ?)''',
                    (issue_id, status, today)
                )
                counts['status_changed'] += 1

    # Clear last_record_date for issues NOT in this Compare (same project, same date)
    active_ids = [issue.get('ID') or issue.get('IDWORKITEM', '') for issue in issues if issue.get('ID') or issue.get('IDWORKITEM')]
    if active_ids:
        placeholders = ','.join('?' * len(active_ids))
        conn.execute(
            f"UPDATE issues SET last_record_date = '' WHERE project_id = ? AND last_record_date = ? AND id NOT IN ({placeholders})",
            [project_id, today] + active_ids
        )

    conn.commit()
    conn.close()
    return counts


# === Timeline & Analysis ===


def get_all_timelines(project_id=None):
    """Get status timelines for active issues only (latest record date). Single JOIN query."""
    conn = get_db()
    today = date.today().isoformat()

    # Build issue filter
    if project_id:
        latest = _latest_record_date(conn, project_id)
        if latest:
            issue_filter = 'WHERE i.project_id = ? AND i.last_record_date = ?'
            params = (today, project_id, latest)
        else:
            issue_filter = 'WHERE i.project_id = ?'
            params = (today, project_id)
    else:
        issue_filter = ''
        params = (today,)

    rows = conn.execute(
        f'''SELECT i.id, i.headline, i.current_status, i.first_seen_date,
                   sh.status as sh_status, sh.started_at, sh.ended_at,
                   CASE WHEN sh.ended_at IS NULL
                        THEN MAX(1, CAST(julianday(?) - julianday(sh.started_at) AS INTEGER))
                        ELSE MAX(1, sh.duration_days)
                   END as days
            FROM issues i
            LEFT JOIN status_history sh ON sh.issue_id = i.id
            {issue_filter}
            ORDER BY i.first_seen_date, sh.started_at''',
        params
    ).fetchall()

    # Group by issue
    issues_map = {}
    for r in rows:
        iid = r['id']
        if iid not in issues_map:
            issues_map[iid] = {
                'id': iid, 'headline': r['headline'],
                'current_status': r['current_status'],
                'first_seen_date': r['first_seen_date'],
                'history': [],
            }
        if r['sh_status']:
            issues_map[iid]['history'].append({
                'status': r['sh_status'], 'started_at': r['started_at'],
                'ended_at': r['ended_at'], 'days': r['days'],
            })

    conn.close()
    return list(issues_map.values())


# === Daily Snapshots ===

def record_issue_events(project_id, record_date, active_ids, compare_result):
    """Record lifecycle events (created/resolved/reopened) based on Compare result."""
    conn = get_db()

    # Get already-recorded events for this project+date to avoid duplicates
    existing = conn.execute(
        'SELECT issue_id, event_type FROM issue_events WHERE project_id = ? AND event_date = ?',
        (project_id, record_date)
    ).fetchall()
    existing_set = {(r['issue_id'], r['event_type']) for r in existing}

    def add_event(issue_id, event_type):
        if (issue_id, event_type) not in existing_set:
            conn.execute(
                'INSERT INTO issue_events (issue_id, project_id, event_type, event_date) VALUES (?, ?, ?, ?)',
                (issue_id, project_id, event_type, record_date)
            )

    # New issues → 'created'
    for issue in compare_result.get('system_only', []):
        iid = issue.get('ID', '')
        if issue.get('Status') == 'New':
            add_event(iid, 'created')
        elif issue.get('Status') == 'Reopened':
            add_event(iid, 'reopened')

    # Reopened common issues (system Rejected)
    for issue in compare_result.get('common', []):
        if issue.get('Status') == 'Reopened':
            add_event(issue.get('ID', ''), 'reopened')

    # Resolved issues (in vendor but not in system)
    for issue in compare_result.get('vendor_only', []):
        add_event(issue.get('ID', ''), 'resolved')

    conn.commit()
    conn.close()


def get_resolved_count(project_id, record_date):
    """Get count of issues resolved on a specific date."""
    conn = get_db()
    row = conn.execute(
        "SELECT COUNT(*) FROM issue_events WHERE project_id = ? AND event_date = ? AND event_type = 'resolved'",
        (project_id, record_date)
    ).fetchone()
    conn.close()
    return row[0] if row else 0


def get_latest_event_counts(project_id):
    """Get event counts from the latest record date for dashboard display."""
    conn = get_db()
    latest = _latest_record_date(conn, project_id)
    if not latest:
        conn.close()
        return {'resolved': 0, 'created': 0, 'reopened': 0}

    rows = conn.execute(
        'SELECT event_type, COUNT(*) as cnt FROM issue_events WHERE project_id = ? AND event_date = ? GROUP BY event_type',
        (project_id, latest)
    ).fetchall()
    conn.close()
    counts = {r['event_type']: r['cnt'] for r in rows}
    return {'resolved': counts.get('resolved', 0), 'created': counts.get('created', 0), 'reopened': counts.get('reopened', 0)}


def save_daily_snapshot(project_id, record_date, stats):
    """Save or update daily snapshot for trend tracking."""
    conn = get_db()
    conn.execute(
        '''INSERT INTO daily_snapshots (project_id, record_date, total, ongoing, new_count, reopened, resolved)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(project_id, record_date)
           DO UPDATE SET total=?, ongoing=?, new_count=?, reopened=?, resolved=?''',
        (project_id, record_date,
         stats['total'], stats['ongoing'], stats['new'], stats['reopened'], stats['resolved'],
         stats['total'], stats['ongoing'], stats['new'], stats['reopened'], stats['resolved'])
    )
    conn.commit()
    conn.close()


def get_daily_snapshots(project_id):
    """Get all daily snapshots for trend chart."""
    conn = get_db()
    rows = conn.execute(
        'SELECT record_date, total, ongoing, new_count, reopened, resolved FROM daily_snapshots WHERE project_id = ? ORDER BY record_date',
        (project_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_bottleneck_analysis(project_id=None):
    """Get bottleneck analysis - average days per status and stalled issues (active only)."""
    conn = get_db()
    today = date.today().isoformat()

    # Only include active issues (matching latest record date)
    active_filter = ''
    active_params = ()
    if project_id:
        latest = _latest_record_date(conn, project_id)
        if latest:
            active_filter = 'AND i.project_id = ? AND i.last_record_date = ?'
            active_params = (project_id, latest)
        else:
            active_filter = 'AND i.project_id = ?'
            active_params = (project_id,)

    avg_by_status = conn.execute(
        f'''SELECT sh.status,
                  COUNT(*) as count,
                  ROUND(AVG(
                      CASE WHEN sh.ended_at IS NULL
                           THEN julianday(?) - julianday(sh.started_at)
                           ELSE sh.duration_days
                      END
                  ), 1) as avg_days
           FROM status_history sh
           JOIN issues i ON i.id = sh.issue_id
           WHERE 1=1 {active_filter}
           GROUP BY sh.status
           ORDER BY avg_days DESC''',
        (today,) + active_params
    ).fetchall()

    stalled_rows = conn.execute(
        f'''SELECT sh.issue_id, i.headline, sh.status,
                  CAST(julianday(?) - julianday(sh.started_at) AS INTEGER) as days_in_status
           FROM status_history sh
           JOIN issues i ON i.id = sh.issue_id
           WHERE sh.ended_at IS NULL
             {active_filter}
             AND julianday(?) - julianday(sh.started_at) >= ?
           ORDER BY days_in_status DESC''',
        (today,) + active_params + (today, STALLED_WARNING_DAYS)
    ).fetchall()

    # Classify into warning (3-6d) and critical (7d+)
    warning = []
    critical = []
    for r in stalled_rows:
        item = dict(r)
        if item['days_in_status'] >= STALLED_CRITICAL_DAYS:
            item['level'] = 'critical'
            critical.append(item)
        else:
            item['level'] = 'warning'
            warning.append(item)

    conn.close()
    return {
        'avg_by_status': [dict(r) for r in avg_by_status],
        'stalled': critical + warning,
        'critical_count': len(critical),
        'warning_count': len(warning),
    }
