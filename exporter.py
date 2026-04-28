import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side


# Style constants
HEADER_FILL = PatternFill(start_color='4472C4', end_color='4472C4', fill_type='solid')
HEADER_FONT = Font(bold=True, color='FFFFFF', size=11)
NEW_FILL = PatternFill(start_color='E2EFDA', end_color='E2EFDA', fill_type='solid')
COMPLETED_FILL = PatternFill(start_color='D9D9D9', end_color='D9D9D9', fill_type='solid')
THIN_BORDER = Border(
    left=Side(style='thin'),
    right=Side(style='thin'),
    top=Side(style='thin'),
    bottom=Side(style='thin'),
)

COLUMNS = ['No', 'IDWORKITEM', 'HEADLINE', 'Status', 'Comments', 'Module', 'Owner', 'Days since Opened', 'Tag']


def _write_header(ws, columns=COLUMNS):
    for col_idx, col_name in enumerate(columns, 1):
        cell = ws.cell(row=1, column=col_idx, value=col_name)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal='center', vertical='center')
        cell.border = THIN_BORDER


def export_vendor_template(system_issues, output_path):
    """Generate standard vendor template from system export data."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Issue List'
    _write_header(ws)

    for idx, issue in enumerate(system_issues, 1):
        row = idx + 1
        values = [
            idx,
            issue.get('ID', ''),
            issue.get('Headline', ''),
            'New',
            '',  # Comments - empty for vendor to fill
            '',  # Module
            '',  # Owner
            issue.get('Days since Opened', ''),
            issue.get('Tag', ''),
        ]
        for col_idx, val in enumerate(values, 1):
            cell = ws.cell(row=row, column=col_idx, value=val)
            cell.border = THIN_BORDER
            cell.alignment = Alignment(vertical='center', wrap_text=True)

    _auto_column_width(ws)
    wb.save(output_path)


def export_issue_list(issues, output_path):
    """Export issue list from displayed table data (includes comments)."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Issue List'

    headers = ['No', 'ID', 'Headline', 'Status', 'Comments', 'Module', 'Owner', 'Days since Opened', 'Tag']
    _write_header(ws, headers)

    for idx, issue in enumerate(issues, 1):
        row = idx + 1
        comments = issue.get('comments', '') or ''
        if comments == '-':
            comments = ''
        values = [
            idx,
            issue.get('id', ''),
            issue.get('headline', ''),
            issue.get('current_status', ''),
            comments,
            issue.get('module', ''),
            issue.get('owner', ''),
            issue.get('days', ''),
            issue.get('tag', ''),
        ]
        for col_idx, val in enumerate(values, 1):
            cell = ws.cell(row=row, column=col_idx, value=val)
            cell.border = THIN_BORDER
            cell.alignment = Alignment(vertical='center', wrap_text=True)

    _auto_column_width(ws)
    wb.save(output_path)


def _auto_column_width(ws):
    for col in ws.columns:
        max_len = 0
        col_letter = col[0].column_letter
        for cell in col:
            if cell.value:
                max_len = max(max_len, len(str(cell.value)))
        ws.column_dimensions[col_letter].width = min(max_len + 2, 50)
