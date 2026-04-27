import os
import sys
import webbrowser
import threading
import tempfile

from flask import Flask, render_template, request, send_file, jsonify
from config import VERSION, PORT, MAX_UPLOAD_SIZE
from parser import parse_vendor_file, parse_vendor_paste, parse_system_file
from comparator import compare_issues, generate_statistics
from exporter import export_updated_vendor_file, export_vendor_template
from database import (
    upsert_issues, get_all_timelines, get_bottleneck_analysis,
    get_projects, create_project, rename_project, delete_project,
    get_project_issues, get_project_summary,
    get_milestones, add_milestone, update_milestone, delete_milestone,
)
from datetime import datetime


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
app.config['LAST_RESULTS'] = {}  # keyed by project_id

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
        return jsonify({
            'issues': issues,
            'summary': summary,
            'timelines': timelines,
            'bottleneck': bottleneck,
            'milestones': milestones,
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


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


# === Compare / Download / Template ===

@app.route('/compare', methods=['POST'])
def compare():
    vendor_file = request.files.get('vendor_file')
    vendor_paste = request.form.get('vendor_paste', '').strip()
    system_file = request.files.get('system_file')
    project_id = request.form.get('project_id', '1')

    try:
        project_id = int(project_id)
    except (TypeError, ValueError):
        project_id = 1

    if (not vendor_file and not vendor_paste) or not system_file:
        return jsonify({'error': '업체 파일(또는 붙여넣기)과 시스템 파일을 모두 입력해주세요.'}), 400

    system_bytes = system_file.read()

    try:
        if vendor_paste:
            vendor_issues = parse_vendor_paste(vendor_paste)
        else:
            vendor_bytes = vendor_file.read()
            vendor_issues = parse_vendor_file(vendor_bytes, filename=vendor_file.filename)
        system_issues = parse_system_file(system_bytes, filename=system_file.filename)
        result = compare_issues(vendor_issues, system_issues)
        stats = generate_statistics(result)

        # Save result for export (keyed by project)
        app.config['LAST_RESULTS'][project_id] = result

        # Record status history in DB
        record_date = request.form.get('record_date', '').strip() or None
        all_active = result['common'] + result['system_only']
        db_counts = upsert_issues(all_active, record_date=record_date, project_id=project_id)

        return jsonify({
            'stats': stats,
            'common': result['common'],
            'vendor_only': result['vendor_only'],
            'system_only': result['system_only'],
            'db_counts': db_counts,
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'처리 중 오류 발생: {str(e)}'}), 500


@app.route('/download', methods=['GET'])
def download():
    project_id = request.args.get('project_id', 1, type=int)
    result = app.config['LAST_RESULTS'].get(project_id)

    if not result:
        return jsonify({'error': '먼저 비교를 수행해주세요.'}), 400

    output_path = os.path.join(UPLOAD_FOLDER, 'updated_vendor.xlsx')
    export_updated_vendor_file(result, output_path)

    return send_file(
        output_path,
        as_attachment=True,
        download_name=f'updated_vendor_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx',
    )


@app.route('/generate-template', methods=['POST'])
def generate_template():
    system_file = request.files.get('system_file')
    if not system_file:
        return jsonify({'error': '시스템 파일을 업로드해주세요.'}), 400

    try:
        system_bytes = system_file.read()
        system_issues = parse_system_file(system_bytes, filename=system_file.filename)

        if not system_issues:
            return jsonify({'error': '시스템 파일에서 이슈를 찾을 수 없습니다.'}), 400

        output_path = os.path.join(UPLOAD_FOLDER, 'vendor_template.xlsx')
        export_vendor_template(system_issues, output_path)

        return send_file(
            output_path,
            as_attachment=True,
            download_name=f'vendor_template_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx',
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'처리 중 오류 발생: {str(e)}'}), 500


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
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def open_browser():
    webbrowser.open(f'http://127.0.0.1:{PORT}')


if __name__ == '__main__':
    if '--no-browser' not in sys.argv:
        threading.Timer(1.0, open_browser).start()
    app.run(debug=False, port=PORT)
