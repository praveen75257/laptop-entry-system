import io
import json
import uuid
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, session, send_file
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from services.database import engine, execute_query, execute_one, execute_command
from services.qr_service import QRService
from utils.helpers import (
    format_date, format_time, get_ist_now, 
    verify_qr_signature, log_system_event,
    login_required, admin_required, security_required
)

api_bp = Blueprint('api', __name__, url_prefix='/api')

@api_bp.route('/scan', methods=['POST'])
@security_required
def process_scan():
    """Authoritative QR scan processor with automated ENTRY/EXIT determination.
    Guaranteed transaction-safe and concurrency-safe via row-level locking."""
    data = request.get_json(silent=True) or {}
    qr_data_raw = data.get('qr_data', '')

    if not qr_data_raw:
        return jsonify({"success": False, "error": "Invalid QR Code. No data received."}), 400

    # 1. Parse JSON payload
    try:
        if isinstance(qr_data_raw, str):
            payload = json.loads(qr_data_raw.strip())
        elif isinstance(qr_data_raw, dict):
            payload = qr_data_raw
        else:
            return jsonify({"success": False, "error": "Invalid QR Code format."}), 400
    except Exception:
        return jsonify({"success": False, "error": "Please scan a valid CPAT laptop QR."}), 400

    # 2. Validate mandatory fields
    reg_number = str(payload.get('registration_number', '')).strip().upper()
    student_name = str(payload.get('student_name', '')).strip()

    if not reg_number or not student_name:
        return jsonify({"success": False, "error": "Missing essential student information in QR."}), 400

    # 3. Verify Cryptographic HMAC Signature
    if not verify_qr_signature(payload):
        log_system_event("FORGED_QR_DETECTED", f"Invalid QR signature attempted for {reg_number}", session.get('username'))
        return jsonify({"success": False, "error": "Invalid QR signature. Unauthorized QR code."}), 400

    # 4. Check Student in PostgreSQL Database
    student = execute_one("SELECT * FROM students WHERE registration_number = :r", {"r": reg_number})
    if not student:
        return jsonify({"success": False, "error": "Student not found in college database."}), 404

    if not student.get('active', True):
        return jsonify({"success": False, "error": "Student is inactive. Please contact the administrator."}), 403

    now_ist = get_ist_now()

    # 5. Transaction-safe atomic scan processing with row-level locking & partial unique constraint
    try:
        with engine.begin() as conn:
            # Row-level lock on the student row to serialize concurrent scans for the same student
            conn.execute(
                text("SELECT id FROM students WHERE id = :sid FOR UPDATE"),
                {"sid": student['id']}
            )

            # Check duplicate scan cooldown (4s) within the locked transaction
            last_record_row = conn.execute(text("""
                SELECT EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - updated_at)) AS diff_sec, status 
                FROM gate_records 
                WHERE student_id = :sid 
                ORDER BY updated_at DESC 
                LIMIT 1;
            """), {"sid": student['id']}).fetchone()

            if last_record_row and last_record_row.diff_sec is not None:
                diff_sec = float(last_record_row.diff_sec)
                if abs(diff_sec) < 4.0:
                    return jsonify({"success": False, "error": "Already processed. Please wait before scanning again."}), 429

            # Check for active INSIDE record inside the locked transaction
            active_record_row = conn.execute(text("""
                SELECT * FROM gate_records 
                WHERE student_id = :sid AND status = 'INSIDE' 
                ORDER BY entry_time DESC 
                LIMIT 1;
            """), {"sid": student['id']}).fetchone()

            if active_record_row:
                # --- SCENARIO B: EXIT ---
                active_record = dict(active_record_row._mapping)
                conn.execute(text("""
                    UPDATE gate_records SET
                        exit_time = CURRENT_TIMESTAMP,
                        status = 'OUT',
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = :id;
                """), {"id": active_record['id']})

                log_system_event(
                    action="EXIT_RECORDED",
                    details=f"Exit recorded for {student['student_name']} ({reg_number}).",
                    username=session.get('username', 'security')
                )

                return jsonify({
                    "success": True,
                    "action": "EXIT",
                    "message": "EXIT RECORDED",
                    "record_id": active_record['record_id'],
                    "student_name": active_record['student_name_snapshot'],
                    "registration_number": active_record['registration_number_snapshot'],
                    "department": active_record['department_snapshot'],
                    "laptop_name": active_record['laptop_name_snapshot'],
                    "laptop_model_number": active_record['laptop_model_number_snapshot'],
                    "entry_time": format_time(active_record['entry_time']),
                    "exit_time": format_time(now_ist),
                    "date": format_date(now_ist),
                    "status": "OUT"
                }), 200

            else:
                # --- SCENARIO A: ENTRY (or RE-ENTRY) ---
                new_record_id = str(uuid.uuid4())
                conn.execute(text("""
                    INSERT INTO gate_records (
                        record_id, student_id,
                        student_name_snapshot, registration_number_snapshot,
                        department_snapshot, year_snapshot, phone_number_snapshot,
                        laptop_name_snapshot, laptop_model_number_snapshot,
                        entry_time, exit_time, status, qr_version,
                        created_at, updated_at
                    ) VALUES (
                        :record_id, :student_id,
                        :student_name, :registration_number,
                        :department, :year, :phone_number,
                        :laptop_name, :laptop_model_number,
                        CURRENT_TIMESTAMP, NULL, 'INSIDE', 1,
                        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    );
                """), {
                    "record_id": new_record_id,
                    "student_id": student['id'],
                    "student_name": student['student_name'],
                    "registration_number": student['registration_number'],
                    "department": student['department'],
                    "year": student['year'],
                    "phone_number": student['phone_number'],
                    "laptop_name": student['laptop_name'],
                    "laptop_model_number": student['laptop_model_number']
                })

                log_system_event(
                    action="ENTRY_RECORDED",
                    details=f"Entry recorded for {student['student_name']} ({reg_number}).",
                    username=session.get('username', 'security')
                )

                return jsonify({
                    "success": True,
                    "action": "ENTRY",
                    "message": "ENTRY RECORDED",
                    "record_id": new_record_id,
                    "student_name": student['student_name'],
                    "registration_number": student['registration_number'],
                    "department": student['department'],
                    "laptop_name": student['laptop_name'],
                    "laptop_model_number": student['laptop_model_number'],
                    "entry_time": format_time(now_ist),
                    "date": format_date(now_ist),
                    "status": "INSIDE"
                }), 200

    except IntegrityError:
        return jsonify({
            "success": False, 
            "error": "Concurrent scan detected or student is already recorded INSIDE. Please retry."
        }), 409


def _fetch_records_payload(filter_date=None, search=None, status=None):
    """Internal helper to query records with normalized fields and summary stats."""
    # Default to today if no date provided
    if not filter_date:
        filter_date = format_date()
    else:
        # Convert YYYY-MM-DD to DD-MM-YYYY if needed
        if '-' in filter_date and len(filter_date.split('-')[0]) == 4:
            parts = filter_date.split('-')
            filter_date = f"{parts[2]}-{parts[1]}-{parts[0]}"

    sql = """
        SELECT 
            id, record_id, student_name_snapshot, registration_number_snapshot,
            department_snapshot, year_snapshot, phone_number_snapshot,
            laptop_name_snapshot, laptop_model_number_snapshot,
            entry_time, exit_time, status, qr_version
        FROM gate_records
        WHERE TO_CHAR(entry_time AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY') = :d
    """
    params = {"d": filter_date}

    if status in ('INSIDE', 'OUT'):
        sql += " AND status = :status"
        params["status"] = status

    if search:
        sql += """ AND (
            student_name_snapshot ILIKE :s OR
            registration_number_snapshot ILIKE :s OR
            laptop_name_snapshot ILIKE :s OR
            record_id ILIKE :s
        )"""
        params["s"] = f"%{search}%"

    sql += " ORDER BY entry_time DESC;"

    records = execute_query(sql, params)

    total_records = len(records)
    inside_count = sum(1 for r in records if r['status'] == 'INSIDE')
    out_count = sum(1 for r in records if r['status'] == 'OUT')

    for r in records:
        r['date_fmt'] = format_date(r['entry_time'])
        r['entry_time_fmt'] = format_time(r['entry_time'])
        r['exit_time_fmt'] = format_time(r['exit_time']) if r['exit_time'] else '—'
        # Provide canonical aliases
        r['student_name'] = r['student_name_snapshot']
        r['registration_number'] = r['registration_number_snapshot']
        r['department'] = r['department_snapshot']
        r['year'] = r['year_snapshot']
        r['phone_number'] = r['phone_number_snapshot']
        r['laptop_name'] = r['laptop_name_snapshot']
        r['laptop_model_number'] = r['laptop_model_number_snapshot']

    return {
        "success": True,
        "date": filter_date,
        "records": records,
        "summary": {
            "total": total_records,
            "inside": inside_count,
            "out": out_count,
            "entries": total_records,
            "exits": out_count
        },
        "last_updated": format_time(get_ist_now())
    }

@api_bp.route('/records', methods=['GET'])
@login_required
def get_records():
    """Live entry/exit records with filtering and polling support."""
    filter_date = request.args.get('date', '').strip()
    search = request.args.get('search', '').strip()
    status = request.args.get('status', '').strip().upper()
    return jsonify(_fetch_records_payload(filter_date, search, status))

@api_bp.route('/records/today', methods=['GET'])
@login_required
def get_records_today():
    """Convenience endpoint to get today's gate records."""
    today = format_date()
    search = request.args.get('search', '').strip()
    status = request.args.get('status', '').strip().upper()
    return jsonify(_fetch_records_payload(today, search, status))

@api_bp.route('/records/yesterday', methods=['GET'])
@login_required
def get_records_yesterday():
    """Convenience endpoint to get yesterday's gate records."""
    yesterday_ist = get_ist_now() - timedelta(days=1)
    yesterday = format_date(yesterday_ist)
    search = request.args.get('search', '').strip()
    status = request.args.get('status', '').strip().upper()
    return jsonify(_fetch_records_payload(yesterday, search, status))

@api_bp.route('/records/date/<date_str>', methods=['GET'])
@login_required
def get_records_by_date(date_str):
    """Convenience endpoint to get gate records by specific date."""
    search = request.args.get('search', '').strip()
    status = request.args.get('status', '').strip().upper()
    return jsonify(_fetch_records_payload(date_str, search, status))

@api_bp.route('/students', methods=['GET'])
@admin_required
def get_students():
    """List students as clean JSON with optional search filter."""
    search = request.args.get('search', '').strip()
    if search:
        query = """
            SELECT id, student_name, registration_number, department, year,
                   phone_number, laptop_name, laptop_model_number, qr_version,
                   active, created_at, updated_at
            FROM students
            WHERE student_name ILIKE :s
               OR registration_number ILIKE :s
               OR department ILIKE :s
               OR laptop_name ILIKE :s
            ORDER BY student_name ASC;
        """
        students = execute_query(query, {"s": f"%{search}%"})
    else:
        students = execute_query("""
            SELECT id, student_name, registration_number, department, year,
                   phone_number, laptop_name, laptop_model_number, qr_version,
                   active, created_at, updated_at
            FROM students
            ORDER BY id DESC;
        """)
    return jsonify({"success": True, "students": students, "count": len(students)})

@api_bp.route('/students/<student_identifier>', methods=['GET'])
@admin_required
def get_student_detail(student_identifier):
    """Get single student details by ID or registration number."""
    student_identifier = str(student_identifier).strip()
    if student_identifier.isdigit():
        student = execute_one("SELECT * FROM students WHERE id = :i", {"i": int(student_identifier)})
    else:
        student = execute_one("SELECT * FROM students WHERE registration_number = :r", {"r": student_identifier.upper()})

    if not student:
        return jsonify({"success": False, "error": "Student not found"}), 404

    return jsonify({"success": True, "student": student})

@api_bp.route('/dashboard/stats', methods=['GET'])
@api_bp.route('/dashboard-stats', methods=['GET'])
@admin_required
def dashboard_stats():
    """Live JSON endpoint for Admin dashboard AJAX polling."""
    total_students = execute_one("SELECT COUNT(*) as count FROM students")['count']
    currently_inside = execute_one("SELECT COUNT(*) as count FROM gate_records WHERE status = 'INSIDE'")['count']
    today_ist = format_date()
    today_entries = execute_one(
        "SELECT COUNT(*) as count FROM gate_records WHERE TO_CHAR(entry_time AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY') = :d",
        {"d": today_ist}
    )['count']
    today_exits = execute_one(
        "SELECT COUNT(*) as count FROM gate_records WHERE exit_time IS NOT NULL AND TO_CHAR(exit_time AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY') = :d",
        {"d": today_ist}
    )['count']

    # Recent activity for dashboard table
    recent_activity = execute_query("""
        SELECT 
            id, record_id, student_name_snapshot, registration_number_snapshot,
            department_snapshot, laptop_name_snapshot, laptop_model_number_snapshot,
            entry_time, exit_time, status
        FROM gate_records
        ORDER BY entry_time DESC
        LIMIT 10;
    """)
    for r in recent_activity:
        r['entry_time_fmt'] = format_time(r['entry_time'])
        r['exit_time_fmt'] = format_time(r['exit_time']) if r['exit_time'] else '—'
        r['date_fmt'] = format_date(r['entry_time'])

    # Currently inside list for dashboard table
    inside_list = execute_query("""
        SELECT 
            id, record_id, student_name_snapshot, registration_number_snapshot,
            department_snapshot, laptop_name_snapshot, laptop_model_number_snapshot,
            entry_time
        FROM gate_records
        WHERE status = 'INSIDE'
        ORDER BY entry_time DESC
        LIMIT 10;
    """)
    for r in inside_list:
        r['entry_time_fmt'] = format_time(r['entry_time'])

    return jsonify({
        "success": True,
        "total_students": total_students,
        "currently_inside": currently_inside,
        "today_entries": today_entries,
        "today_exits": today_exits,
        "recent_activity": recent_activity,
        "inside_list": inside_list,
        "last_updated": format_time(get_ist_now())
    })

@api_bp.route('/security-stats', methods=['GET'])
@security_required
def security_stats():
    """Live JSON endpoint for Security dashboard counters."""
    currently_inside = execute_one("SELECT COUNT(*) as count FROM gate_records WHERE status = 'INSIDE'")['count']
    today_ist = format_date()
    today_entries = execute_one(
        "SELECT COUNT(*) as count FROM gate_records WHERE TO_CHAR(entry_time AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY') = :d",
        {"d": today_ist}
    )['count']
    today_exits = execute_one(
        "SELECT COUNT(*) as count FROM gate_records WHERE exit_time IS NOT NULL AND TO_CHAR(exit_time AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY') = :d",
        {"d": today_ist}
    )['count']

    return jsonify({
        "success": True,
        "currently_inside": currently_inside,
        "today_entries": today_entries,
        "today_exits": today_exits,
        "last_updated": format_time(get_ist_now())
    })

@api_bp.route('/qr-image/<reg_number>', methods=['GET'])
@admin_required
def get_qr_image(reg_number):
    """Dynamic in-memory QR image stream."""
    student = execute_one("SELECT * FROM students WHERE registration_number = :reg", {"reg": reg_number.upper()})
    if not student:
        return jsonify({"error": "Student not found"}), 404

    qr_bytes = QRService.generate_qr_bytes(student)
    return send_file(io.BytesIO(qr_bytes), mimetype='image/png')

@api_bp.route('/qr-download/<reg_number>', methods=['GET'])
@admin_required
def download_qr_image(reg_number):
    """Download student QR PNG attachment."""
    student = execute_one("SELECT * FROM students WHERE registration_number = :reg", {"reg": reg_number.upper()})
    if not student:
        return jsonify({"error": "Student not found"}), 404

    qr_bytes = QRService.generate_qr_bytes(student)
    return send_file(
        io.BytesIO(qr_bytes),
        mimetype='image/png',
        as_attachment=True,
        download_name=f"CPAT_QR_{student['registration_number']}.png"
    )
