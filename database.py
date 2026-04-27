import os
import sqlite3
from datetime import datetime, date
from config import DB_DIR, DB_PATH, STALLED_DAYS_THRESHOLD


def get_db():
    """Get database connection, creating tables if needed."""
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    _init_tables(conn)
    _migrate(conn)
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
    ''')
    conn.commit()


def _migrate(conn):
    """Handle schema migrations for existing databases."""
    # Ensure Default project exists
    conn.execute(
        "INSERT OR IGNORE INTO projects (id, name, created_at) VALUES (1, 'Default', ?)",
        (datetime.now().isoformat(),)
    )

    # Add project_id column if missing (for DBs created before v0.5.0)
    columns = [row[1] for row in conn.execute('PRAGMA table_info(issues)').fetchall()]
    if 'project_id' not in columns:
        conn.execute('ALTER TABLE issues ADD COLUMN project_id INTEGER NOT NULL DEFAULT 1')

    # Create index after column is guaranteed to exist
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
    conn.execute('DELETE FROM projects WHERE id = ?', (project_id,))
    conn.commit()
    conn.close()


# === Issue Operations ===

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

        # Check if issue exists
        existing = conn.execute(
            'SELECT id, current_status FROM issues WHERE id = ?',
            (issue_id,)
        ).fetchone()

        if existing is None:
            # New issue
            conn.execute(
                '''INSERT INTO issues (id, project_id, headline, module, owner, tag, current_status, first_seen_date, last_updated)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (issue_id, project_id, headline, module, owner, tag, status, today, now)
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
            # Existing issue - update fields
            conn.execute(
                '''UPDATE issues SET headline=?, module=?, owner=?, tag=?, current_status=?, last_updated=?, project_id=?
                   WHERE id=?''',
                (headline, module or existing['module'] if hasattr(existing, '__getitem__') else module,
                 owner, tag, status, now, project_id, issue_id)
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

    conn.commit()
    conn.close()
    return counts


# === Timeline & Analysis ===

def get_issue_timeline(issue_id):
    """Get status history timeline for a specific issue."""
    conn = get_db()
    today = date.today().isoformat()

    rows = conn.execute(
        '''SELECT status, started_at, ended_at,
                  CASE WHEN ended_at IS NULL
                       THEN CAST(julianday(?) - julianday(started_at) AS INTEGER)
                       ELSE duration_days
                  END as days
           FROM status_history
           WHERE issue_id = ?
           ORDER BY started_at''',
        (today, issue_id)
    ).fetchall()

    conn.close()
    return [dict(r) for r in rows]


def get_all_timelines(project_id=None):
    """Get status timelines for all issues, optionally filtered by project."""
    conn = get_db()
    today = date.today().isoformat()

    if project_id:
        issues = conn.execute(
            'SELECT id, headline, current_status, first_seen_date FROM issues WHERE project_id = ? ORDER BY first_seen_date',
            (project_id,)
        ).fetchall()
    else:
        issues = conn.execute(
            'SELECT id, headline, current_status, first_seen_date FROM issues ORDER BY first_seen_date'
        ).fetchall()

    result = []
    for issue in issues:
        history = conn.execute(
            '''SELECT status, started_at, ended_at,
                      CASE WHEN ended_at IS NULL
                           THEN MAX(1, CAST(julianday(?) - julianday(started_at) AS INTEGER))
                           ELSE MAX(1, duration_days)
                      END as days
               FROM status_history
               WHERE issue_id = ?
               ORDER BY started_at''',
            (today, issue['id'])
        ).fetchall()

        result.append({
            'id': issue['id'],
            'headline': issue['headline'],
            'current_status': issue['current_status'],
            'first_seen_date': issue['first_seen_date'],
            'history': [dict(h) for h in history],
        })

    conn.close()
    return result


def get_bottleneck_analysis(project_id=None):
    """Get bottleneck analysis - average days per status and stalled issues."""
    conn = get_db()
    today = date.today().isoformat()

    if project_id:
        avg_by_status = conn.execute(
            '''SELECT sh.status,
                      COUNT(*) as count,
                      ROUND(AVG(
                          CASE WHEN sh.ended_at IS NULL
                               THEN julianday(?) - julianday(sh.started_at)
                               ELSE sh.duration_days
                          END
                      ), 1) as avg_days
               FROM status_history sh
               JOIN issues i ON i.id = sh.issue_id
               WHERE i.project_id = ?
               GROUP BY sh.status
               ORDER BY avg_days DESC''',
            (today, project_id)
        ).fetchall()

        stalled = conn.execute(
            '''SELECT sh.issue_id, i.headline, sh.status,
                      CAST(julianday(?) - julianday(sh.started_at) AS INTEGER) as days_in_status
               FROM status_history sh
               JOIN issues i ON i.id = sh.issue_id
               WHERE sh.ended_at IS NULL
                 AND i.project_id = ?
                 AND julianday(?) - julianday(sh.started_at) >= ?
               ORDER BY days_in_status DESC''',
            (today, project_id, today, STALLED_DAYS_THRESHOLD)
        ).fetchall()
    else:
        avg_by_status = conn.execute(
            '''SELECT status,
                      COUNT(*) as count,
                      ROUND(AVG(
                          CASE WHEN ended_at IS NULL
                               THEN julianday(?) - julianday(started_at)
                               ELSE duration_days
                          END
                      ), 1) as avg_days
               FROM status_history
               GROUP BY status
               ORDER BY avg_days DESC''',
            (today,)
        ).fetchall()

        stalled = conn.execute(
            '''SELECT sh.issue_id, i.headline, sh.status,
                      CAST(julianday(?) - julianday(sh.started_at) AS INTEGER) as days_in_status
               FROM status_history sh
               JOIN issues i ON i.id = sh.issue_id
               WHERE sh.ended_at IS NULL
                 AND julianday(?) - julianday(sh.started_at) >= ?
               ORDER BY days_in_status DESC''',
            (today, today, STALLED_DAYS_THRESHOLD)
        ).fetchall()

    conn.close()
    return {
        'avg_by_status': [dict(r) for r in avg_by_status],
        'stalled': [dict(r) for r in stalled],
    }
