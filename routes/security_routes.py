from flask import Blueprint, render_template, redirect, flash, session, url_for
from services.database import execute_one, execute_query
from utils.helpers import format_date, format_time

security_bp = Blueprint('security', __name__, url_prefix='/security')

@security_bp.before_request
def check_security_session():
    """Protect all security routes."""
    if not session.get('logged_in') or session.get('role') != 'security':
        flash('Security privileges required. Please sign in.', 'error')
        return redirect('/login')

@security_bp.route('/')
@security_bp.route('/dashboard')
@security_bp.route('/scanner')
def dashboard():
    """Mobile-first gate security portal with camera scanner and live counts."""
    today_ist = format_date()

    # Inside count
    currently_inside = execute_one(
        "SELECT COUNT(*) as count FROM gate_records WHERE status = 'INSIDE'"
    )['count']

    # Today's entries
    today_entries = execute_one(
        "SELECT COUNT(*) as count FROM gate_records WHERE TO_CHAR(entry_time AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY') = :d",
        {"d": today_ist}
    )['count']

    # Today's exits
    today_exits = execute_one(
        "SELECT COUNT(*) as count FROM gate_records WHERE exit_time IS NOT NULL AND TO_CHAR(exit_time AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY') = :d",
        {"d": today_ist}
    )['count']

    # Recent scans for the guard
    recent_scans = execute_query("""
        SELECT 
            student_name_snapshot, registration_number_snapshot,
            laptop_name_snapshot, entry_time, exit_time, status
        FROM gate_records
        WHERE TO_CHAR(entry_time AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY') = :d
        ORDER BY updated_at DESC
        LIMIT 5;
    """, {"d": today_ist})

    for s in recent_scans:
        s['entry_fmt'] = format_time(s['entry_time'])
        s['exit_fmt'] = format_time(s['exit_time']) if s['exit_time'] else '—'

    stats = {
        "currently_inside": currently_inside,
        "today_entries": today_entries,
        "today_exits": today_exits
    }

    return render_template('security/dashboard.html', stats=stats, recent_scans=recent_scans)
