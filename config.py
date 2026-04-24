import os

# App
VERSION = 'v0.3.0'
PORT = 5000
MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50MB

# Database
DB_DIR = os.path.join(os.path.expanduser('~'), '.issue_manager')
DB_PATH = os.path.join(DB_DIR, 'issues.db')

# Issue tracking
ID_COLUMN_NAMES = ['IDWORKITEM', 'ID']  # Accepted ID column names (priority order)
HEADLINE_COLUMN_NAMES = ['HEADLINE', 'Headline']
SYSTEM_HEADER_ROW = 1  # 0-based: row index of header in system export (row 2)

# Bottleneck threshold
STALLED_DAYS_THRESHOLD = 7
