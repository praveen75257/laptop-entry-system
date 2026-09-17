import uuid
from flask import Blueprint, render_template, request, redirect, flash, session, url_for, jsonify
from config import Config
from services.database import execute_query, execute_one, execute_command
from services.qr_service import QRService
from utils.helpers import (
    validate_student_data, format_date, format_time, 
    format_display_datetime, get_ist_now, log_system_event,
    generate_qr_signature
)

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')

@admin_bp.before_request
def check_admin_session():
    """Protect all admin routes."""
    if not session.get('logged_in') or session.get('role') != 'admin':
        flash('Admin privileges required. Please sign in.', 'error')
        return redirect('/login')

@admin_bp.route('/')
@admin_bp.route('/dashboard')
def dashboard():
    """Admin dashboard with live PostgreSQL statistics and recent activity."""
    # 1. Total Students
    total_students = execute_one("SELECT COUNT(*) as count FROM students")['count']

    # 2. Currently Inside
    currently_inside = execute_one("SELECT COUNT(*) as count FROM gate_records WHERE status = 'INSIDE'")['count']

    # 3. Today's Entries (IST)
    today_ist = format_date()
    today_entries = execute_one(
        "SELECT COUNT(*) as count FROM gate_records WHERE TO_CHAR(entry_time AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY') = :d",
        {"d": today_ist}
    )['count']

    # 4. Today's Exits (IST)
    today_exits = execute_one(
        "SELECT COUNT(*) as count FROM gate_records WHERE exit_time IS NOT NULL AND TO_CHAR(exit_time AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY') = :d",
        {"d": today_ist}
    )['count']

    # Recent activity (latest 10 gate scans)
    recent_activity = execute_query("""
        SELECT 
            id, record_id, student_name_snapshot, registration_number_snapshot,
            department_snapshot, laptop_name_snapshot, laptop_model_number_snapshot,
            entry_time, exit_time, status
        FROM gate_records
        ORDER BY entry_time DESC
        LIMIT 10;
    """)

    # Format timestamps for display
    for r in recent_activity:
        r['entry_time_fmt'] = format_time(r['entry_time'])
        r['exit_time_fmt'] = format_time(r['exit_time']) if r['exit_time'] else '—'
        r['date_fmt'] = format_date(r['entry_time'])

    # Currently inside students list
    currently_inside_list = execute_query("""
        SELECT 
            id, record_id, student_name_snapshot, registration_number_snapshot,
            department_snapshot, laptop_name_snapshot, entry_time
        FROM gate_records
        WHERE status = 'INSIDE'
        ORDER BY entry_time DESC
        LIMIT 10;
    """)
    for r in currently_inside_list:
        r['entry_time_fmt'] = format_time(r['entry_time'])

    stats = {
        "total_students": total_students,
        "currently_inside": currently_inside,
        "today_entries": today_entries,
        "today_exits": today_exits
    }

    return render_template(
        'admin/dashboard.html', 
        stats=stats, 
        recent_activity=recent_activity,
        currently_inside_list=currently_inside_list
    )

@admin_bp.route('/students')
def students():
    """List all students with search and filter capabilities."""
    search = request.args.get('search', '').strip()
    if search:
        query = """
            SELECT * FROM students 
            WHERE student_name ILIKE :s 
               OR registration_number ILIKE :s 
               OR department ILIKE :s 
               OR laptop_name ILIKE :s
            ORDER BY student_name ASC;
        """
        student_list = execute_query(query, {"s": f"%{search}%"})
    else:
        student_list = execute_query("SELECT * FROM students ORDER BY id DESC;")

    return render_template('admin/students.html', students=student_list, search=search)

@admin_bp.route('/students/add', methods=['GET', 'POST'])
def add_student():
    """Register a new student."""
    if request.method == 'POST':
        raw_data = {
            'student_name': request.form.get('student_name', ''),
            'registration_number': request.form.get('registration_number', ''),
            'department': request.form.get('department', ''),
            'year': request.form.get('year', ''),
            'phone_number': request.form.get('phone_number', ''),
            'laptop_name': request.form.get('laptop_name', ''),
            'laptop_model_number': request.form.get('laptop_model_number', '')
        }

        is_valid, cleaned, errors = validate_student_data(raw_data)
        if not is_valid:
            for err in errors:
                flash(err, 'danger')
            return render_template('admin/add_student.html', form_data=raw_data)

        # Check unique registration number
        existing = execute_one(
            "SELECT id FROM students WHERE registration_number = :reg",
            {"reg": cleaned['registration_number']}
        )
        if existing:
            flash('Registration number already exists.', 'danger')
            return render_template('admin/add_student.html', form_data=raw_data)

        # Generate QR signature
        sig = generate_qr_signature(cleaned)

        # Insert student record
        execute_command("""
            INSERT INTO students (
                student_name, registration_number, department, year,
                phone_number, laptop_name, laptop_model_number,
                qr_version, qr_signature, active, created_at, updated_at
            ) VALUES (
                :student_name, :registration_number, :department, :year,
                :phone_number, :laptop_name, :laptop_model_number,
                1, :sig, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            );
        """, {**cleaned, "sig": sig})

        log_system_event(
            action="STUDENT_CREATED",
            details=f"Student {cleaned['student_name']} ({cleaned['registration_number']}) registered.",
            username=session.get('username')
        )

        flash('Student registered successfully.', 'success')
        return redirect(f"/admin/generate-qr/{cleaned['registration_number']}")

    return render_template('admin/add_student.html', form_data={})

@admin_bp.route('/students/edit/<reg_number>', methods=['GET', 'POST'])
def edit_student(reg_number):
    """Edit student details and refresh QR signature."""
    student = execute_one("SELECT * FROM students WHERE registration_number = :reg", {"reg": reg_number.upper()})
    if not student:
        flash('Student not found.', 'danger')
        return redirect('/admin/students')

    if request.method == 'POST':
        raw_data = {
            'student_name': request.form.get('student_name', ''),
            'registration_number': reg_number.upper(),
            'department': request.form.get('department', ''),
            'year': request.form.get('year', ''),
            'phone_number': request.form.get('phone_number', ''),
            'laptop_name': request.form.get('laptop_name', ''),
            'laptop_model_number': request.form.get('laptop_model_number', '')
        }

        is_valid, cleaned, errors = validate_student_data(raw_data)
        if not is_valid:
            for err in errors:
                flash(err, 'danger')
            return render_template('admin/edit_student.html', student=raw_data)

        sig = generate_qr_signature(cleaned)

        execute_command("""
            UPDATE students SET
                student_name = :student_name,
                department = :department,
                year = :year,
                phone_number = :phone_number,
                laptop_name = :laptop_name,
                laptop_model_number = :laptop_model_number,
                qr_signature = :sig,
                updated_at = CURRENT_TIMESTAMP
            WHERE registration_number = :reg;
        """, {**cleaned, "sig": sig, "reg": reg_number.upper()})

        log_system_event(
            action="STUDENT_EDITED",
            details=f"Student {cleaned['registration_number']} details updated.",
            username=session.get('username')
        )

        flash('Student updated successfully.', 'success')
        return redirect('/admin/students')

    return render_template('admin/edit_student.html', student=student)

@admin_bp.route('/students/toggle/<reg_number>', methods=['POST'])
@admin_bp.route('/students/deactivate/<reg_number>', methods=['POST'])
def deactivate_student(reg_number):
    """Deactivate a student:
    1. Close any ongoing INSIDE visit.
    2. Remove from active students registry (old QR permanently invalidated).
    3. Preserve all historical gate records via immutable snapshots.
    """
    student = execute_one(
        "SELECT id, student_name, registration_number FROM students WHERE registration_number = :reg", 
        {"reg": reg_number.upper()}
    )
    if not student:
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest' or request.is_json:
            return jsonify({"success": False, "error": "Student not found in active registry."}), 404
        flash('Student not found in active registry.', 'danger')
        return redirect('/admin/students')

    # 1. Close any active INSIDE visit in gate_records so campus inside counter is accurate
    execute_command("""
        UPDATE gate_records SET
            exit_time = CURRENT_TIMESTAMP,
            status = 'OUT',
            updated_at = CURRENT_TIMESTAMP
        WHERE student_id = :sid AND status = 'INSIDE';
    """, {"sid": student['id']})

    # 2. Delete student record from students table
    # (gate_records.student_id becomes NULL via ON DELETE SET NULL, preserving all snapshot columns)
    execute_command("DELETE FROM students WHERE id = :id", {"id": student['id']})

    # 3. Log audit event
    log_system_event(
        action="STUDENT_DEACTIVATED",
        details=f"Student {student['student_name']} ({reg_number.upper()}) deactivated and removed from active registry. Old QR permanently invalidated. Historical gate records preserved.",
        username=session.get('username')
    )

    msg = f"Student {student['student_name']} ({reg_number.upper()}) deactivated and removed from active listings. Old QR is invalidated."
    if request.headers.get('X-Requested-With') == 'XMLHttpRequest' or request.is_json:
        return jsonify({
            "success": True, 
            "deactivated": True,
            "message": msg
        })

    flash(msg, 'info')
    return redirect('/admin/students')

@admin_bp.route('/generate-qr/<reg_number>')
def view_qr(reg_number):
    """Display student QR printable card."""
    student = execute_one("SELECT * FROM students WHERE registration_number = :reg", {"reg": reg_number.upper()})
    if not student:
        flash('Student not found.', 'danger')
        return redirect('/admin/students')

    qr_base64 = QRService.generate_qr_base64(student)

    log_system_event(
        action="QR_GENERATED",
        details=f"QR code viewed/generated for {student['registration_number']}.",
        username=session.get('username')
    )

    return render_template('admin/qr_display.html', student=student, qr_data_uri=qr_base64)

@admin_bp.route('/records')
def records():
    """Historical and live Entry/Exit gate records page."""
    default_date = format_date()
    return render_template(
        'admin/records.html',
        default_date=default_date
    )

@admin_bp.route('/logs')
def view_system_logs():
    """View system event logs."""
    logs = execute_query("SELECT * FROM system_logs ORDER BY created_at DESC LIMIT 100;")
    for log in logs:
        log['time_fmt'] = format_display_datetime(log['created_at'])
    return render_template('admin/logs.html', logs=logs)
