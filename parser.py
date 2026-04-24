import io
import os
import tempfile
import pandas as pd
from datetime import datetime
from config import ID_COLUMN_NAMES, HEADLINE_COLUMN_NAMES, SYSTEM_HEADER_ROW


# === Utility Functions ===

def _clean(value):
    """Convert value to cleaned string. Returns '' for None/NaN/None-like values."""
    s = str(value or '').strip()
    return '' if s.lower() in ('nan', 'none') else s


def _get_field(row, candidates):
    """Get first matching field from a list of candidate column names."""
    for name in candidates:
        val = _clean(row.get(name, ''))
        if val:
            return val
    return ''


def _get_id_column(df):
    """Find the ID column name from configured candidates."""
    for name in ID_COLUMN_NAMES:
        if name in df.columns:
            return name
    raise ValueError(
        f"ID 컬럼을 찾을 수 없습니다. {ID_COLUMN_NAMES} 중 하나가 필요합니다. "
        f"(현재 컬럼: {list(df.columns)})"
    )


# === File Reading ===

def _save_upload_to_temp(file_data, filename):
    """Save uploaded bytes to a temp file and return the path."""
    temp_dir = os.path.join(tempfile.gettempdir(), 'issue_manager_uploads')
    os.makedirs(temp_dir, exist_ok=True)
    if isinstance(file_data, bytes):
        filepath = os.path.join(temp_dir, filename)
        with open(filepath, 'wb') as f:
            f.write(file_data)
        return filepath
    return file_data  # Already a file path


def _read_via_excel_com(filepath, header_row=0):
    """Read Excel file using Excel COM automation (bypasses NASCA DRM)."""
    import win32com.client
    import pythoncom

    pythoncom.CoInitialize()
    excel = None
    wb = None
    try:
        excel = win32com.client.Dispatch('Excel.Application')
        excel.Visible = False
        excel.DisplayAlerts = False

        wb = excel.Workbooks.Open(os.path.abspath(filepath), ReadOnly=True)
        ws = wb.Sheets(1)

        used = ws.UsedRange
        data = used.Value
        if not isinstance(data, tuple):
            data = ((data,),)
        elif not isinstance(data[0], tuple):
            data = (data,)

        data_list = [list(row) for row in data]
        headers = [str(v).strip() if v is not None else f'Col{i}'
                   for i, v in enumerate(data_list[header_row])]
        df = pd.DataFrame(data_list[header_row + 1:], columns=headers)
        return df.astype(str)
    finally:
        if wb:
            wb.Close(SaveChanges=False)
        if excel:
            excel.Quit()
        pythoncom.CoUninitialize()


def _read_excel_auto(filepath, filename='', header=0):
    """Try to read Excel file. Falls back to Excel COM for NASCA DRM files."""
    errors = {}

    for engine in ['openpyxl', 'xlrd']:
        try:
            return pd.read_excel(filepath, engine=engine, header=header, dtype=str)
        except Exception as e:
            errors[engine] = str(e)

    try:
        return _read_via_excel_com(filepath, header_row=header)
    except Exception as e:
        errors['excel_com'] = str(e)

    detail = ' | '.join(f'[{k}] {v}' for k, v in errors.items())
    raise ValueError(f'Cannot read: {filename or filepath}. Errors: {detail}')


# === Vendor File Parsing ===

def _extract_vendor_issues(df):
    """Extract vendor issues from a DataFrame. Shared by file and paste parsers."""
    id_col = _get_id_column(df)
    issues = []
    current_issue = None

    for _, row in df.iterrows():
        id_val = _clean(row.get(id_col, ''))
        comment = _clean(row.get('Comments', ''))

        if id_val:
            if current_issue:
                issues.append(current_issue)
            current_issue = {
                'No': _clean(row.get('No', '')),
                'IDWORKITEM': id_val,
                'HEADLINE': _get_field(row, HEADLINE_COLUMN_NAMES),
                'Status': _clean(row.get('Status', '')),
                'Comments': [comment] if comment else [],
                'Module': _clean(row.get('Module', '')),
                'Owner': _clean(row.get('Owner', '')),
                'Days since Opened': _clean(row.get('Days since Opened', '')),
                'Tag': _clean(row.get('Tag', '')),
            }
        elif current_issue and comment:
            current_issue['Comments'].append(comment)

    if current_issue:
        issues.append(current_issue)
    return issues


def parse_vendor_file(file_data, filename='vendor.xlsx'):
    """Parse vendor exchange Excel file."""
    filepath = _save_upload_to_temp(file_data, filename)
    df = _read_excel_auto(filepath, filename=filename, header=0)
    df.columns = [str(c).strip() for c in df.columns]
    return _extract_vendor_issues(df)


def parse_vendor_paste(paste_text):
    """Parse vendor data from tab-separated pasted text (copied from Excel)."""
    lines = paste_text.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    lines = [l for l in lines if l.strip()]

    if not lines:
        raise ValueError('붙여넣기 데이터가 비어있습니다.')

    headers = [h.strip() for h in lines[0].split('\t')]
    rows = []
    for line in lines[1:]:
        cols = line.split('\t')
        while len(cols) < len(headers):
            cols.append('')
        rows.append(cols[:len(headers)])

    df = pd.DataFrame(rows, columns=headers)
    return _extract_vendor_issues(df)


# === System File Parsing ===

def parse_system_file(file_data, filename='system.xls'):
    """Parse system export Excel file."""
    filepath = _save_upload_to_temp(file_data, filename)
    df = _read_excel_auto(filepath, filename=filename, header=SYSTEM_HEADER_ROW)
    df.columns = [str(c).strip() for c in df.columns]

    id_col = _get_id_column(df)
    issues = []

    for _, row in df.iterrows():
        id_val = _clean(row.get(id_col, ''))
        if not id_val:
            continue

        # Calculate Days since Opened
        opened_str = _clean(row.get('Opened Time', ''))
        days_since_opened = ''
        if opened_str:
            try:
                delta = datetime.now() - pd.to_datetime(opened_str)
                days_since_opened = str(delta.days)
            except (ValueError, TypeError):
                pass

        issues.append({
            'ID': id_val,
            'Headline': _get_field(row, HEADLINE_COLUMN_NAMES),
            'Status': _clean(row.get('Status', '')),
            'Tag': _clean(row.get('Tag', '')),
            'Opened Time': opened_str,
            'Days since Opened': days_since_opened,
            'Seriousness': _clean(row.get('Seriousness', '')),
            'Frequency': _clean(row.get('Frequency', '')),
            'Module': '',
            'Work Assignment': _clean(row.get('Work Assignment', '')),
            'State Owner': _clean(row.get('State Owner', '')),
            'Model Code': _clean(row.get('Model Code', '')),
        })

    return issues
