import os
import sys

# App
VERSION = 'v1.2.2'
PORT = 5000
MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50MB

# Database - stored next to the exe (portable)
if getattr(sys, 'frozen', False):
    _APP_DIR = os.path.dirname(sys.executable)
else:
    _APP_DIR = os.path.dirname(os.path.abspath(__file__))

DB_DIR = _APP_DIR
DB_PATH = os.path.join(DB_DIR, 'issues.db')

# Issue tracking
ID_COLUMN_NAMES = ['IDWORKITEM', 'ID']  # Accepted ID column names (priority order)
HEADLINE_COLUMN_NAMES = ['HEADLINE', 'Headline']
SYSTEM_HEADER_ROW = 1  # 0-based: row index of header in system export (row 2)

# Bottleneck thresholds
STALLED_WARNING_DAYS = 3   # Warning: 3~6 days
STALLED_CRITICAL_DAYS = 7  # Critical: 7+ days
