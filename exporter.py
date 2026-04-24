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


def export_updated_vendor_file(result, output_path):
    """Export updated vendor file with comparison results."""
    wb = openpyxl.Workbook()

    # Sheet 1: Active issues (common + new)
    ws_active = wb.active
    ws_active.title = 'Active Issues'
    _write_active_sheet(ws_active, result)

    # Sheet 2: Completed (vendor only - removed from system)
    ws_completed = wb.create_sheet('Completed')
    _write_completed_sheet(ws_completed, result['vendor_only'])

    # Sheet 3: Summary
    ws_summary = wb.create_sheet('Summary')
    _write_summary_sheet(ws_summary, result)

    wb.save(output_path)


def _write_header(ws, columns=COLUMNS):
    for col_idx, col_name in enumerate(columns, 1):
        cell = ws.cell(row=1, column=col_idx, value=col_name)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal='center', vertical='center')
        cell.border = THIN_BORDER


def _write_active_sheet(ws, result):
    """Write active issues: common first, then new (system only)."""
    _write_header(ws)

    row_num = 2
    issue_no = 1

    # Common issues first
    for issue in result['common']:
        row_num = _write_issue_rows(ws, row_num, issue_no, issue)
        issue_no += 1

    # New issues (from system) - highlighted
    for issue in result['system_only']:
        start_row = row_num
        row_num = _write_issue_rows(ws, row_num, issue_no, issue, fill=NEW_FILL)
        issue_no += 1

    _auto_column_width(ws)


def _write_completed_sheet(ws, vendor_only):
    """Write completed/removed issues."""
    _write_header(ws)

    for idx, issue in enumerate(vendor_only, 1):
        _write_issue_rows(ws, idx + 1, idx, issue, fill=COMPLETED_FILL)

    _auto_column_width(ws)


def _write_issue_rows(ws, start_row, no, issue, fill=None):
    """Write an issue (possibly spanning multiple rows for comments). Returns next available row."""
    comments = issue.get('Comments', [])
    if not comments:
        comments = ['']

    row_count = len(comments)
    end_row = start_row + row_count - 1

    # Column values (excluding Comments at index 4)
    values = [
        no,
        issue['ID'],
        issue['HEADLINE'],
        issue['Status'],
        None,  # placeholder for Comments
        issue.get('Module', ''),
        issue.get('Owner', ''),
        issue.get('Days since Opened', ''),
        issue.get('Tag', ''),
    ]

    # Write first row values and apply styles to all rows
    for i in range(row_count):
        row = start_row + i
        for col_idx in range(1, len(COLUMNS) + 1):
            cell = ws.cell(row=row, column=col_idx)
            cell.border = THIN_BORDER
            if fill:
                cell.fill = fill
            if i == 0 and col_idx != 5:
                cell.value = values[col_idx - 1]
                cell.alignment = Alignment(vertical='center', wrap_text=True)
        # Write comment for each row
        ws.cell(row=row, column=5, value=comments[i]).alignment = Alignment(wrap_text=True)

    # Merge cells for non-comment columns when multiple comment rows exist
    if row_count > 1:
        for col_idx in range(1, len(COLUMNS) + 1):
            if col_idx == 5:  # Skip Comments column
                continue
            ws.merge_cells(
                start_row=start_row, start_column=col_idx,
                end_row=end_row, end_column=col_idx,
            )

    return end_row + 1


def _write_summary_sheet(ws, result):
    """Write summary statistics."""
    ws.cell(row=1, column=1, value='Category').font = Font(bold=True)
    ws.cell(row=1, column=2, value='Count').font = Font(bold=True)

    rows = [
        ('Active (진행중)', len(result['common'])),
        ('New (신규/재유입)', len(result['system_only'])),
        ('Resolved (처리완료)', len(result['vendor_only'])),
        ('Total Active', len(result['common']) + len(result['system_only'])),
    ]
    for i, (cat, count) in enumerate(rows, 2):
        ws.cell(row=i, column=1, value=cat)
        ws.cell(row=i, column=2, value=count)

    _auto_column_width(ws)


def _auto_column_width(ws):
    for col in ws.columns:
        max_len = 0
        col_letter = col[0].column_letter
        for cell in col:
            if cell.value:
                max_len = max(max_len, len(str(cell.value)))
        ws.column_dimensions[col_letter].width = min(max_len + 2, 50)
