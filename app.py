import os
import sys
import webbrowser
import threading
import tempfile

from flask import Flask, render_template, request, send_file, jsonify
from config import VERSION, PORT, MAX_UPLOAD_SIZE
from parser import parse_vendor_file, parse_vendor_paste, parse_system_file
from comparator import compare_issues, generate_statistics
from exporter import export_updated_vendor_file
from database import upsert_issues, get_all_timelines, get_bottleneck_analysis
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

# Use temp directory for uploads (works regardless of exe location)
UPLOAD_FOLDER = os.path.join(tempfile.gettempdir(), 'issue_manager_uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


@app.route('/')
def index():
    return render_template('index.html', version=VERSION)


@app.route('/compare', methods=['POST'])
def compare():
    vendor_file = request.files.get('vendor_file')
    vendor_paste = request.form.get('vendor_paste', '').strip()
    system_file = request.files.get('system_file')

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

        # Save result for export
        app.config['LAST_RESULT'] = result

        # Record status history in DB
        all_active = result['common'] + result['system_only']
        db_counts = upsert_issues(all_active)

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
    result = app.config.get('LAST_RESULT')

    if not result:
        return jsonify({'error': '먼저 비교를 수행해주세요.'}), 400

    output_path = os.path.join(UPLOAD_FOLDER, 'updated_vendor.xlsx')
    export_updated_vendor_file(result, output_path)

    return send_file(
        output_path,
        as_attachment=True,
        download_name=f'updated_vendor_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx',
    )


@app.route('/timeline', methods=['GET'])
def timeline():
    try:
        timelines = get_all_timelines()
        bottleneck = get_bottleneck_analysis()
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
