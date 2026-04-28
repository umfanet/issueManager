import os
import sys
import webbrowser
import threading
import tempfile

from flask import Flask, render_template, request, send_file, jsonify
from config import VERSION, PORT, MAX_UPLOAD_SIZE, DB_DIR, DB_PATH
from parser import parse_vendor_file, parse_vendor_paste, parse_system_file
from comparator import compare_issues, generate_statistics
from exporter import export_issue_list, export_postmortem
from database import (
    upsert_issues, get_all_timelines, get_bottleneck_analysis,
    get_projects, create_project, rename_project, delete_project,
    get_project_issues, get_project_summary, get_known_issues_map,
    get_milestones, add_milestone, update_milestone, delete_milestone,
    save_daily_snapshot, get_daily_snapshots,
    record_issue_events, get_latest_event_counts, get_postmortem_data,
    update_project_notes, get_project_notes,
)
from datetime import datetime, date as date_cls
import traceback


def get_base_path():
    """Get base path for bundled resources (PyInstaller compatibility)."""
    if getattr(sys, 'frozen', False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


BASE_PATH = get_base_path()
app = Flask(
    __name__,
    template_folder=os.path.join(BASE_PATH, 'templates'),
    static_folder=os.path.join(BASE_PATH, 'static'),
)
app.config['MAX_CONTENT_LENGTH'] = MAX_UPLOAD_SIZE

# Use temp directory for uploads (works regardless of exe location)
UPLOAD_FOLDER = os.path.join(tempfile.gettempdir(), 'issue_manager_uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


@app.route('/')
def index():
    return render_template('index.html', version=VERSION)


# === Project API ===

@app.route('/api/projects', methods=['GET'])
def list_projects():
    return jsonify({'projects': get_projects()})


@app.route('/api/projects', methods=['POST'])
def add_project():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': '프로젝트 이름을 입력해주세요.'}), 400
    try:
        project = create_project(name)
        return jsonify(project), 201
    except Exception as e:
        return jsonify({'error': f'프로젝트 생성 실패: {e}'}), 400


@app.route('/api/projects/<int:project_id>', methods=['PUT'])
def update_project(project_id):
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': '프로젝트 이름을 입력해주세요.'}), 400
    try:
        rename_project(project_id, name)
        return jsonify({'id': project_id, 'name': name})
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/projects/<int:project_id>', methods=['DELETE'])
def remove_project(project_id):
    try:
        delete_project(project_id)
        return jsonify({'ok': True})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/projects/<int:project_id>/dashboard', methods=['GET'])
def project_dashboard(project_id):
    """Get current project state from DB (no file upload needed)."""
    try:
        issues = get_project_issues(project_id)
        summary = get_project_summary(project_id)
        timelines = get_all_timelines(project_id=project_id)
        bottleneck = get_bottleneck_analysis(project_id=project_id)
        milestones = get_milestones(project_id)
        snapshots = get_daily_snapshots(project_id)
        notes = get_project_notes(project_id)
        event_counts = get_latest_event_counts(project_id)
        return jsonify({
            'issues': issues,
            'summary': summary,
            'timelines': timelines,
            'bottleneck': bottleneck,
            'milestones': milestones,
            'snapshots': snapshots,
            'notes': notes,
            'event_counts': event_counts,
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# === Project Notes API ===

@app.route('/api/projects/<int:project_id>/notes', methods=['PUT'])
def save_notes(project_id):
    data = request.get_json(silent=True) or {}
    notes = data.get('notes', '')
    update_project_notes(project_id, notes)
    return jsonify({'ok': True})


# === Milestone API ===

@app.route('/api/projects/<int:project_id>/milestones', methods=['GET'])
def list_milestones(project_id):
    return jsonify({'milestones': get_milestones(project_id)})


@app.route('/api/projects/<int:project_id>/milestones', methods=['POST'])
def create_milestone(project_id):
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    due_date = (data.get('due_date') or '').strip()
    if not name or not due_date:
        return jsonify({'error': '단계 이름과 날짜를 입력해주세요.'}), 400
    try:
        milestone = add_milestone(project_id, name, due_date)
        return jsonify(milestone), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/milestones/<int:milestone_id>', methods=['PUT'])
def edit_milestone(milestone_id):
    data = request.get_json(silent=True) or {}
    try:
        update_milestone(milestone_id,
                         name=data.get('name'),
                         due_date=data.get('due_date'),
                         sort_order=data.get('sort_order'))
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/milestones/<int:milestone_id>', methods=['DELETE'])
def remove_milestone(milestone_id):
    try:
        delete_milestone(milestone_id)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# === Postmortem Export ===

@app.route('/api/projects/<int:project_id>/postmortem', methods=['GET'])
def postmortem_export(project_id):
    try:
        issues, all_statuses = get_postmortem_data(project_id)
        if not issues:
            return jsonify({'error': '데이터가 없습니다.'}), 400
        output_path = os.path.join(UPLOAD_FOLDER, 'postmortem.xlsx')
        export_postmortem(issues, all_statuses, output_path)
        return send_file(
            output_path,
            as_attachment=True,
            download_name=f'postmortem_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx',
        )
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# === Compare / Download / Template ===

@app.route('/compare', methods=['POST'])
def compare():
    """Preview compare results without saving to DB."""
    vendor_file = request.files.get('vendor_file')
    vendor_paste = request.form.get('vendor_paste', '').strip()
    system_file = request.files.get('system_file')
    project_id = request.form.get('project_id', '1')

    try:
        project_id = int(project_id)
    except (TypeError, ValueError):
        project_id = 1

    if not system_file:
        return jsonify({'error': '시스템 파일을 업로드해주세요.'}), 400

    system_bytes = system_file.read()

    try:
        has_vendor = bool(vendor_file or vendor_paste)
        if vendor_paste:
            vendor_issues = parse_vendor_paste(vendor_paste)
        elif vendor_file:
            vendor_bytes = vendor_file.read()
            vendor_issues = parse_vendor_file(vendor_bytes, filename=vendor_file.filename)
        else:
            db_issues = get_project_issues(project_id)
            vendor_issues = [{
                'IDWORKITEM': i['id'], 'HEADLINE': i['headline'],
                'Status': i['current_status'] or '', 'Comments': i['comments'].split('\n') if i.get('comments') else [],
                'Module': i['module'] or '', 'Owner': i['owner'] or '',
                'Days since Opened': i.get('days_since_opened', ''), 'Tag': i['tag'] or '',
            } for i in db_issues]
        system_issues = parse_system_file(system_bytes, filename=system_file.filename)

        record_date = request.form.get('record_date', '').strip() or None
        current_date = record_date or date_cls.today().isoformat()

        known_map = get_known_issues_map(current_date=current_date)
        result = compare_issues(vendor_issues, system_issues, known_map=known_map)
        stats = generate_statistics(result)

        # Store result in session for Save step (don't write to DB yet)
        app.config['PENDING_COMPARE'] = {
            'project_id': project_id,
            'record_date': record_date,
            'current_date': current_date,
            'result': result,
            'stats': stats,
        }

        return jsonify({
            'stats': stats,
            'common': result['common'],
            'vendor_only': result['vendor_only'],
            'system_only': result['system_only'],
            'preview': True,
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': f'처리 중 오류 발생: {str(e)}'}), 500


@app.route('/compare/save', methods=['POST'])
def compare_save():
    """Save the previewed compare result to DB."""
    pending = app.config.get('PENDING_COMPARE')
    if not pending:
        return jsonify({'error': '저장할 Compare 결과가 없습니다.'}), 400

    try:
        project_id = pending['project_id']
        record_date = pending['record_date']
        current_date = pending['current_date']
        result = pending['result']
        stats = pending['stats']

        # Auto-backup DB (once per day)
        _auto_backup_db(current_date)

        # Now save to DB
        all_active = result['common'] + result['system_only']
        db_counts = upsert_issues(all_active, record_date=record_date, project_id=project_id)

        active_ids = [i.get('ID', '') for i in all_active]
        record_issue_events(project_id, current_date, active_ids, result)

        save_daily_snapshot(project_id, current_date, {
            'total': stats['summary']['total_active'],
            'ongoing': stats['summary']['common'],
            'new': stats['summary']['new'],
            'reopened': stats['summary']['reopened'],
            'resolved': stats['summary']['resolved'],
        })

        app.config['PENDING_COMPARE'] = None
        return jsonify({'ok': True, 'db_counts': db_counts})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def _auto_backup_db(current_date):
    """Auto-backup DB once per day before first save."""
    backup_dir = os.path.join(DB_DIR, 'backups')
    os.makedirs(backup_dir, exist_ok=True)
    backup_name = f'issues_{current_date.replace("-","")}.db'
    backup_path = os.path.join(backup_dir, backup_name)

    if not os.path.exists(backup_path):
        import shutil
        if os.path.exists(DB_PATH):
            shutil.copy2(DB_PATH, backup_path)

        # Clean old backups (keep 7 days)
        import glob
        backups = sorted(glob.glob(os.path.join(backup_dir, 'issues_*.db')))
        while len(backups) > 30:
            os.remove(backups.pop(0))


@app.route('/export-issues', methods=['POST'])
def export_issues():
    """Export issue list from currently displayed table data."""
    data = request.get_json(silent=True) or {}
    issues = data.get('issues', [])
    if not issues:
        return jsonify({'error': '내보낼 이슈가 없습니다.'}), 400

    try:
        output_path = os.path.join(UPLOAD_FOLDER, 'issue_list.xlsx')
        export_issue_list(issues, output_path)

        return send_file(
            output_path,
            as_attachment=True,
            download_name=f'issue_list_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx',
        )
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/timeline', methods=['GET'])
def timeline():
    project_id = request.args.get('project_id', None, type=int)
    try:
        timelines = get_all_timelines(project_id=project_id)
        bottleneck = get_bottleneck_analysis(project_id=project_id)
        return jsonify({
            'timelines': timelines,
            'bottleneck': bottleneck,
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def get_local_ip():
    """Get local network IP address."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


def open_browser():
    webbrowser.open(f'http://127.0.0.1:{PORT}')


if __name__ == '__main__':
    local_ip = get_local_ip()
    print(f'\n  Local:   http://127.0.0.1:{PORT}')
    print(f'  Network: http://{local_ip}:{PORT}\n')
    if '--no-browser' not in sys.argv:
        threading.Timer(1.0, open_browser).start()
    app.run(debug=False, port=PORT, host='0.0.0.0')
