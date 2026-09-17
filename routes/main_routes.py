from flask import Blueprint, render_template, request, redirect, session, flash, url_for
from werkzeug.security import check_password_hash
from services.database import execute_one
from utils.helpers import log_system_event

main_bp = Blueprint('main', __name__)

@main_bp.route('/')
def index():
    """Route landing to appropriate portal based on session."""
    if session.get('logged_in'):
        role = session.get('role')
        if role == 'admin':
            return redirect('/admin/dashboard')
        elif role == 'security':
            return redirect('/security/dashboard')
    return redirect('/login')

@main_bp.route('/login', methods=['GET', 'POST'])
def login():
    """Unified login page for both Admin and Security."""
    if session.get('logged_in'):
        role = session.get('role')
        if role == 'admin':
            return redirect('/admin/dashboard')
        elif role == 'security':
            return redirect('/security/dashboard')

    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')

        if not username or not password:
            flash('Please provide both username and password.', 'warning')
            return render_template('login.html')

        # Query user securely from PostgreSQL
        user = execute_one(
            "SELECT id, username, password_hash, role, active FROM users WHERE username = :u",
            {"u": username}
        )

        if user and check_password_hash(user['password_hash'], password):
            if not user.get('active', True):
                flash('Account is deactivated. Please contact an administrator.', 'danger')
                return render_template('login.html')

            # Populate session
            session.clear()
            session['user_id'] = user['id']
            session['username'] = user['username']
            session['user'] = user['username']
            session['role'] = user['role']
            session['logged_in'] = True
            session.permanent = True

            log_system_event(
                action=f"{user['role'].upper()}_LOGIN",
                details=f"User '{user['username']}' logged in successfully.",
                username=user['username']
            )

            if user['role'] == 'admin':
                return redirect('/admin/dashboard')
            else:
                return redirect('/security/dashboard')
        else:
            # Generic message without revealing username existence
            log_system_event(
                action="FAILED_LOGIN",
                details=f"Failed login attempt for username '{username}'.",
                username=username
            )
            flash('Invalid username or password', 'danger')
            return render_template('login.html')

    return render_template('login.html')

@main_bp.route('/logout')
def logout():
    """Clear session and log the event."""
    username = session.get('username')
    if username:
        log_system_event(action="LOGOUT", details=f"User '{username}' logged out.", username=username)
    session.clear()
    flash('You have been logged out successfully.', 'info')
    return redirect('/login')
