import hmac
import hashlib
import json
import pytz
from datetime import datetime
from functools import wraps
from flask import session, redirect, flash, jsonify, request
from config import Config
from services.database import execute_command

def get_ist_now():
    """Return current datetime in Asia/Kolkata timezone."""
    tz = pytz.timezone(Config.TIMEZONE)
    return datetime.now(tz)

def format_time(dt=None):
    """Format datetime to HH:MM:SS AM/PM in IST."""
    tz = pytz.timezone(Config.TIMEZONE)
    if dt is None:
        dt = get_ist_now()
    elif isinstance(dt, str):
        return dt
    # Convert UTC-aware or any tz-aware datetime to IST before formatting
    if hasattr(dt, 'tzinfo') and dt.tzinfo is not None:
        dt = dt.astimezone(tz)
    return dt.strftime('%I:%M:%S %p')

def format_date(dt=None):
    """Format datetime to DD-MM-YYYY in IST."""
    tz = pytz.timezone(Config.TIMEZONE)
    if dt is None:
        dt = get_ist_now()
    elif isinstance(dt, str):
        return dt
    # Convert to IST before formatting
    if hasattr(dt, 'tzinfo') and dt.tzinfo is not None:
        dt = dt.astimezone(tz)
    return dt.strftime('%d-%m-%Y')

def format_display_datetime(dt=None):
    """Format datetime to: 16 Sep 2026, 09:32 PM in IST."""
    tz = pytz.timezone(Config.TIMEZONE)
    if dt is None:
        dt = get_ist_now()
    if isinstance(dt, str):
        return dt
    # Convert to IST before formatting
    if hasattr(dt, 'tzinfo') and dt.tzinfo is not None:
        dt = dt.astimezone(tz)
    return dt.strftime('%d %b %Y, %I:%M %p')


def log_system_event(action, details=None, username=None):
    """Record an important event into the system_logs table."""
    try:
        execute_command(
            """
            INSERT INTO system_logs (action, details, username, created_at)
            VALUES (:a, :d, :u, CURRENT_TIMESTAMP)
            """,
            {"a": action, "d": str(details) if details else None, "u": username}
        )
    except Exception as e:
        print(f"[LOG ERROR] Failed to record system log: {e}")

def login_required(f):
    """Ensure user is authenticated (Admin or Security)."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in') or not session.get('role'):
            if request.path.startswith('/api/'):
                return jsonify({"success": False, "error": "Authentication required. Please sign in."}), 401
            flash('Please log in to continue.', 'warning')
            return redirect('/login')
        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    """Ensure user is authenticated as Admin."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            if request.path.startswith('/api/'):
                return jsonify({"success": False, "error": "Authentication required. Please sign in as admin."}), 401
            flash('Admin access required. Please sign in as admin.', 'error')
            return redirect('/login')
        if session.get('role') != 'admin':
            if request.path.startswith('/api/'):
                return jsonify({"success": False, "error": "Forbidden: Admin privileges required."}), 403
            flash('Admin access required. Please sign in as admin.', 'error')
            return redirect('/login')
        return f(*args, **kwargs)
    return decorated

def security_required(f):
    """Ensure user is authenticated as Security or Admin."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            if request.path.startswith('/api/'):
                return jsonify({"success": False, "error": "Authentication required. Please sign in with security credentials."}), 401
            flash('Security access required. Please sign in with security credentials.', 'error')
            return redirect('/login')
        if session.get('role') not in ('security', 'admin'):
            if request.path.startswith('/api/'):
                return jsonify({"success": False, "error": "Forbidden: Security or Admin privileges required."}), 403
            flash('Security access required. Please sign in with security credentials.', 'error')
            return redirect('/login')
        return f(*args, **kwargs)
    return decorated

def validate_student_data(data):
    """Validate student registration and edit inputs."""
    required_fields = [
        'student_name', 'registration_number', 'department', 
        'year', 'phone_number', 'laptop_name', 'laptop_model_number'
    ]
    errors = []
    cleaned = {}
    for field in required_fields:
        val = str(data.get(field, '')).strip()
        if not val:
            field_label = field.replace('_', ' ').title()
            errors.append(f'{field_label} is required.')
        cleaned[field] = val
    
    phone = cleaned.get('phone_number', '')
    if phone:
        digits = ''.join(filter(str.isdigit, phone))
        if len(digits) < 10:
            errors.append('Phone number must contain at least 10 valid digits.')
        cleaned['phone_number'] = digits

    cleaned['registration_number'] = cleaned.get('registration_number', '').upper()
    return len(errors) == 0, cleaned, errors

def generate_qr_signature(payload_dict):
    """Generate HMAC-SHA256 signature for student QR payload."""
    canonical = f"{payload_dict.get('qr_version', 1)}|{payload_dict.get('registration_number', '').strip().upper()}|{payload_dict.get('student_name', '').strip()}|{payload_dict.get('laptop_name', '').strip()}|{payload_dict.get('laptop_model_number', '').strip()}"
    secret = Config.SECRET_KEY.encode('utf-8')
    sig = hmac.new(secret, canonical.encode('utf-8'), hashlib.sha256).hexdigest()
    return sig

def verify_qr_signature(payload_dict):
    """Verify HMAC-SHA256 signature of decoded QR payload."""
    provided_sig = payload_dict.get('signature', '')
    if not provided_sig:
        return False
    expected_sig = generate_qr_signature(payload_dict)
    return hmac.compare_digest(provided_sig, expected_sig)

