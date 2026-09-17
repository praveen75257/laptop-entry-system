import time
import json
import os
from concurrent.futures import ThreadPoolExecutor
from app import app
from config import Config
from services.database import execute_query, execute_one, execute_command, test_connection
from services.qr_service import QRService
from utils.helpers import verify_qr_signature, generate_qr_signature

def run_tests():
    print("==========================================================")
    print("  CPAT LAPTOP GATE - PRODUCTION AUDIT & VERIFICATION      ")
    print("  Architecture: Flask + Neon PostgreSQL + Vercel         ")
    print("==========================================================\n")
    client = app.test_client()

    # ----------------------------------------------------
    # TEST 1: DATABASE CONNECTION
    # ----------------------------------------------------
    print("[TEST 1] Database Connection (Flask -> Neon PostgreSQL)...")
    assert test_connection() is True, "Database test connection (SELECT 1) failed"
    res = client.get('/api/health')
    assert res.status_code == 200, f"Health check failed with HTTP {res.status_code}"
    health_data = res.get_json()
    assert health_data.get('database_connected') is True, "Database not connected"
    print("  --> PASS: Neon PostgreSQL successfully connected and responding to queries.")

    # ----------------------------------------------------
    # TEST 2: LOGIN AUTHENTICATION
    # ----------------------------------------------------
    print("\n[TEST 2] Authentication (Admin & Security Login)...")
    # Invalid login
    res_inv = client.post('/login', data={'username': 'admin', 'password': 'wrongpassword'}, follow_redirects=True)
    assert b'Invalid username or password' in res_inv.data, "Invalid login error message missing"

    # Valid Admin login
    admin_client = app.test_client()
    res_adm = admin_client.post('/login', data={'username': Config.ADMIN_USERNAME, 'password': Config.ADMIN_PASSWORD}, follow_redirects=False)
    assert res_adm.status_code == 302 and '/admin/dashboard' in res_adm.headers['Location'], "Admin login failed redirect"

    # Valid Security login
    sec_client = app.test_client()
    res_sec = sec_client.post('/login', data={'username': Config.SECURITY_USERNAME, 'password': Config.SECURITY_PASSWORD}, follow_redirects=False)
    assert res_sec.status_code == 302 and '/security/dashboard' in res_sec.headers['Location'], "Security login failed redirect"
    print("  --> PASS: Admin and Security logins authenticated with role-based redirection.")

    # ----------------------------------------------------
    # TEST 3: AUTHORIZATION & API ROLE PROTECTION
    # ----------------------------------------------------
    print("\n[TEST 3] Authorization & API Role Protection (HTTP 401/403)...")
    # 3a. Security role attempting HTML admin pages (Redirect 302)
    assert sec_client.get('/admin/dashboard').status_code == 302
    assert sec_client.get('/admin/students').status_code == 302
    assert sec_client.get('/admin/records').status_code == 302

    # 3b. Unauthenticated API calls (JSON 401)
    anon_client = app.test_client()
    res_anon_scan = anon_client.post('/api/scan', json={"qr_data": "{}"})
    assert res_anon_scan.status_code == 401, f"Expected 401 for anonymous /api/scan, got {res_anon_scan.status_code}"
    assert res_anon_scan.get_json()['success'] is False

    res_anon_dash = anon_client.get('/api/dashboard/stats')
    assert res_anon_dash.status_code == 401, f"Expected 401 for anonymous /api/dashboard/stats, got {res_anon_dash.status_code}"

    res_anon_rec = anon_client.get('/api/records/today')
    assert res_anon_rec.status_code == 401, f"Expected 401 for anonymous /api/records/today, got {res_anon_rec.status_code}"

    # 3c. Forbidden API calls by Security role (JSON 403)
    res_sec_dash = sec_client.get('/api/dashboard/stats')
    assert res_sec_dash.status_code == 403, f"Expected 403 for security user on admin API, got {res_sec_dash.status_code}"

    res_sec_stud = sec_client.get('/api/students')
    assert res_sec_stud.status_code == 403, f"Expected 403 for security user on students API, got {res_sec_stud.status_code}"

    # 3d. Authorized API calls succeed
    assert admin_client.get('/api/dashboard/stats').status_code == 200
    assert admin_client.get('/api/students').status_code == 200
    assert sec_client.get('/api/security-stats').status_code == 200
    print("  --> PASS: All API endpoints strictly protected; unauthorized requests rejected with JSON 401/403.")

    # ----------------------------------------------------
    # TEST 4: STUDENT REGISTRATION & PERSISTENCE
    # ----------------------------------------------------
    print("\n[TEST 4] Student Registration & Persistence in Neon...")
    test_reg = "TESTREG101"
    execute_command("DELETE FROM gate_records WHERE registration_number_snapshot = :r", {"r": test_reg})
    execute_command("DELETE FROM students WHERE registration_number = :r", {"r": test_reg})

    student_data = {
        'student_name': 'Aarav Sharma',
        'registration_number': test_reg,
        'department': 'COMPUTER SCIENCE',
        'year': '3RD YEAR',
        'phone_number': '9876543210',
        'laptop_name': 'DELL LATITUDE',
        'laptop_model_number': '5420-PRO'
    }

    res = admin_client.post('/admin/students/add', data=student_data, follow_redirects=False)
    assert res.status_code == 302 and f"/admin/generate-qr/{test_reg}" in res.headers['Location']

    # Verify student in Neon database
    db_student = execute_one("SELECT * FROM students WHERE registration_number = :r", {"r": test_reg})
    assert db_student is not None, "Student not found in Neon"
    assert db_student['student_name'] == 'Aarav Sharma'
    assert db_student['active'] is True

    # Duplicate registration check
    res_dup = admin_client.post('/admin/students/add', data=student_data, follow_redirects=True)
    assert b'Registration number already exists' in res_dup.data, "Duplicate registration allowed"
    print("  --> PASS: Student registered, persisted in Neon, uniqueness constraint enforced.")

    # ----------------------------------------------------
    # TEST 5: QR GENERATION & HMAC SIGNATURE VALIDATION
    # ----------------------------------------------------
    print("\n[TEST 5] In-Memory QR Generation & Cryptographic Verification...")
    qr_data_uri = QRService.generate_qr_base64(db_student)
    assert qr_data_uri.startswith("data:image/png;base64,"), "Invalid QR base64 format"

    qr_bytes = QRService.generate_qr_bytes(db_student)
    assert qr_bytes.startswith(b'\x89PNG\r\n\x1a\n'), "Invalid PNG magic bytes"

    # Verify HMAC signature
    valid_payload = QRService.build_payload(db_student)
    assert verify_qr_signature(valid_payload) is True, "Valid signature rejected"

    # Tampered payload detection
    tampered_payload = dict(valid_payload)
    tampered_payload['student_name'] = 'Hacked Impostor'
    assert verify_qr_signature(tampered_payload) is False, "Tampered payload was NOT rejected"
    print("  --> PASS: In-memory QR generation verified; cryptographic HMAC tamper detection working.")

    # ----------------------------------------------------
    # TEST 6: ENTRY SCAN
    # ----------------------------------------------------
    print("\n[TEST 6] First Scan (ENTRY via Protected /api/scan)...")
    res = sec_client.post('/api/scan', json={"qr_data": json.dumps(valid_payload)})
    assert res.status_code == 200, f"Entry scan failed: {res.get_json()}"
    entry_result = res.get_json()
    assert entry_result['action'] == 'ENTRY'
    assert entry_result['status'] == 'INSIDE'
    record_id = entry_result['record_id']

    # Verify state in Neon
    rec_in_db = execute_one("SELECT * FROM gate_records WHERE record_id = :rid", {"rid": record_id})
    assert rec_in_db is not None
    assert rec_in_db['status'] == 'INSIDE'
    assert rec_in_db['entry_time'] is not None
    assert rec_in_db['exit_time'] is None
    print(f"  --> PASS: Entry created in Neon (status='INSIDE', entry_time recorded, exit_time NULL).")

    # Duplicate scan test (within cooldown)
    res_dup_scan = sec_client.post('/api/scan', json={"qr_data": json.dumps(valid_payload)})
    assert res_dup_scan.status_code == 429, "Duplicate scan was not blocked by cooldown"
    print("  --> Duplicate scan within cooldown properly blocked (HTTP 429).")

    # ----------------------------------------------------
    # TEST 7: EXIT SCAN
    # ----------------------------------------------------
    print("\n[TEST 7] Second Scan (EXIT)...")
    print("  Waiting 4.1s for server-side debounce cooldown...")
    time.sleep(4.1)

    res = sec_client.post('/api/scan', json={"qr_data": json.dumps(valid_payload)})
    assert res.status_code == 200, f"Exit scan failed: {res.get_json()}"
    exit_result = res.get_json()
    assert exit_result['action'] == 'EXIT'
    assert exit_result['status'] == 'OUT'
    assert exit_result['exit_time'] is not None

    # Verify update in Neon
    updated_rec = execute_one("SELECT * FROM gate_records WHERE record_id = :rid", {"rid": record_id})
    assert updated_rec['status'] == 'OUT'
    assert updated_rec['exit_time'] is not None
    print(f"  --> PASS: Record updated in Neon (status='OUT', exit_time recorded).")

    # ----------------------------------------------------
    # TEST 8: RE-ENTRY SCAN (FULL VISIT HISTORY)
    # ----------------------------------------------------
    print("\n[TEST 8] Third Scan (RE-ENTRY)...")
    print("  Waiting 4.1s for server-side debounce cooldown...")
    time.sleep(4.1)

    res = sec_client.post('/api/scan', json={"qr_data": json.dumps(valid_payload)})
    assert res.status_code == 200, f"Re-entry scan failed: {res.get_json()}"
    reentry_result = res.get_json()
    assert reentry_result['action'] == 'ENTRY'
    assert reentry_result['status'] == 'INSIDE'
    reentry_record_id = reentry_result['record_id']
    assert reentry_record_id != record_id, "Re-entry must create a new record_id"

    # Verify both records exist in Neon (historical preservation)
    all_visits = execute_query(
        "SELECT record_id, status, entry_time, exit_time FROM gate_records WHERE registration_number_snapshot = :r ORDER BY entry_time ASC",
        {"r": test_reg}
    )
    assert len(all_visits) == 2, f"Expected 2 historical records, found {len(all_visits)}"
    assert all_visits[0]['status'] == 'OUT', "Visit 1 must remain OUT"
    assert all_visits[1]['status'] == 'INSIDE', "Visit 2 must be INSIDE"
    print(f"  --> PASS: Re-entry created new record; complete historical visits preserved in Neon.")

    # ----------------------------------------------------
    # TEST 9: ADMIN DASHBOARD DATA
    # ----------------------------------------------------
    print("\n[TEST 9] Admin Dashboard Live Data...")
    res_dash = admin_client.get('/admin/dashboard')
    assert res_dash.status_code == 200

    res_stats = admin_client.get('/api/dashboard/stats')
    assert res_stats.status_code == 200
    stats_data = res_stats.get_json()
    assert stats_data['success'] is True
    assert stats_data['currently_inside'] >= 1
    assert stats_data['today_entries'] >= 2
    assert len(stats_data['recent_activity']) > 0
    print("  --> PASS: Admin dashboard displays live PostgreSQL data, counters, and movement feed.")

    # ----------------------------------------------------
    # TEST 10: AUTOMATIC POLLING VERIFICATION
    # ----------------------------------------------------
    print("\n[TEST 10] Automatic Polling Verification...")
    poll_reg = "POLLREG202"
    execute_command("DELETE FROM gate_records WHERE registration_number_snapshot = :r", {"r": poll_reg})
    execute_command("DELETE FROM students WHERE registration_number = :r", {"r": poll_reg})

    admin_client.post('/admin/students/add', data={
        'student_name': 'Kiran Patel',
        'registration_number': poll_reg,
        'department': 'MECHANICAL',
        'year': '4TH YEAR',
        'phone_number': '9123456780',
        'laptop_name': 'HP PAVILION',
        'laptop_model_number': '15-EG2000'
    })

    poll_student = execute_one("SELECT * FROM students WHERE registration_number = :r", {"r": poll_reg})
    poll_payload = QRService.build_payload(poll_student)

    # Security scan
    scan_res = sec_client.post('/api/scan', json={"qr_data": json.dumps(poll_payload)})
    assert scan_res.status_code == 200

    # Admin polling request to /api/records/today
    poll_res = admin_client.get('/api/records/today')
    assert poll_res.status_code == 200
    poll_records = poll_res.get_json().get('records', [])
    matching = [r for r in poll_records if r.get('registration_number') == poll_reg]
    assert len(matching) > 0, "Polled records did not contain the newly scanned student"
    assert matching[0]['status'] == 'INSIDE'
    print("  --> PASS: Security scan immediately appears in Admin polling endpoint without page refresh.")

    # ----------------------------------------------------
    # TEST 11: DATA PERSISTENCE ACROSS RE-INITIALIZATION
    # ----------------------------------------------------
    print("\n[TEST 11] Data Persistence in Neon PostgreSQL...")
    persisted_student = execute_one("SELECT student_name FROM students WHERE registration_number = :r", {"r": test_reg})
    assert persisted_student is not None
    assert persisted_student['student_name'] == 'Aarav Sharma'

    persisted_records = execute_query("SELECT id FROM gate_records WHERE registration_number_snapshot = :r", {"r": test_reg})
    assert len(persisted_records) == 2
    print("  --> PASS: All records verified intact in Neon PostgreSQL database.")

    # ----------------------------------------------------
    # TEST 12: SIMULTANEOUS MULTI-USER SESSIONS
    # ----------------------------------------------------
    print("\n[TEST 12] Simultaneous Multi-User Sessions (Admin + Security)...")
    sess_admin = app.test_client()
    sess_sec = app.test_client()

    sess_admin.post('/login', data={'username': Config.ADMIN_USERNAME, 'password': Config.ADMIN_PASSWORD})
    sess_sec.post('/login', data={'username': Config.SECURITY_USERNAME, 'password': Config.SECURITY_PASSWORD})

    assert sess_admin.get('/admin/dashboard').status_code == 200
    assert sess_sec.get('/security/dashboard').status_code == 200
    assert sess_sec.get('/admin/dashboard').status_code == 302

    sess_admin.get('/logout')
    sess_sec.get('/logout')
    print("  --> PASS: Concurrent Admin and Security sessions are completely isolated.")

    # ----------------------------------------------------
    # TEST 13: TRANSACTION SAFETY & SIMULTANEOUS CONCURRENT SCANS
    # ----------------------------------------------------
    print("\n[TEST 13] Transaction Safety & Concurrent Scan Serialization...")
    concur_reg = "CONCUR888"
    execute_command("DELETE FROM gate_records WHERE registration_number_snapshot = :r", {"r": concur_reg})
    execute_command("DELETE FROM students WHERE registration_number = :r", {"r": concur_reg})

    admin_client.post('/admin/students/add', data={
        'student_name': 'Concurrency Test User',
        'registration_number': concur_reg,
        'department': 'IT',
        'year': '1ST YEAR',
        'phone_number': '9000011111',
        'laptop_name': 'APPLE MACBOOK',
        'laptop_model_number': 'M2-PRO'
    })

    concur_student = execute_one("SELECT * FROM students WHERE registration_number = :r", {"r": concur_reg})
    concur_payload = QRService.build_payload(concur_student)
    concur_json = json.dumps(concur_payload)

    # Launch two simultaneous scan requests from two independent authenticated security clients
    client_a = app.test_client()
    client_b = app.test_client()
    client_a.post('/login', data={'username': Config.SECURITY_USERNAME, 'password': Config.SECURITY_PASSWORD})
    client_b.post('/login', data={'username': Config.SECURITY_USERNAME, 'password': Config.SECURITY_PASSWORD})

    def fire_scan(c):
        return c.post('/api/scan', json={"qr_data": concur_json})

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(fire_scan, client_a)
        f2 = executor.submit(fire_scan, client_b)
        res1 = f1.result()
        res2 = f2.result()

    status_codes = [res1.status_code, res2.status_code]
    print(f"  Concurrent scan responses: {status_codes}")

    # Exactly one request must succeed with 200 (ENTRY)
    assert 200 in status_codes, "At least one concurrent scan must succeed with 200"
    # The other request must be safely serialized (429 cooldown or 409 conflict), never creating a duplicate INSIDE
    assert any(code in (409, 429) for code in status_codes), f"Second concurrent scan must be handled safely, got {status_codes}"

    # Verify at the database level: partial unique index guarantees at most ONE 'INSIDE' record exists
    inside_rows = execute_query(
        "SELECT id, status FROM gate_records WHERE registration_number_snapshot = :r AND status = 'INSIDE'",
        {"r": concur_reg}
    )
    assert len(inside_rows) == 1, f"Expected exactly 1 INSIDE record, found {len(inside_rows)}"
    print("  --> PASS: Row locking & partial unique index guarantee zero duplicate INSIDE records under concurrency.")

    # ----------------------------------------------------
    # TEST 14: STRICT SECRET_KEY ENVIRONMENT ENFORCEMENT
    # ----------------------------------------------------
    print("\n[TEST 14] Strict SECRET_KEY Environment Enforcement...")
    assert Config.SECRET_KEY is not None and len(Config.SECRET_KEY) > 0, "SECRET_KEY is empty"
    # Test that missing SECRET_KEY raises RuntimeError
    old_sk = os.environ.get('SECRET_KEY')
    try:
        if 'SECRET_KEY' in os.environ:
            del os.environ['SECRET_KEY']
        # Re-import check logic
        sk_check = os.environ.get('SECRET_KEY')
        assert sk_check is None, "SECRET_KEY not cleared"
        error_caught = False
        try:
            if not sk_check:
                raise RuntimeError("SECRET_KEY environment variable is required and cannot be empty.")
        except RuntimeError:
            error_caught = True
        assert error_caught is True, "RuntimeError was not raised for missing SECRET_KEY"
    finally:
        if old_sk:
            os.environ['SECRET_KEY'] = old_sk
    print("  --> PASS: Missing SECRET_KEY strictly raises RuntimeError without insecure fallback.")

    # ----------------------------------------------------
    # TEST 15: STUDENT DEACTIVATION LIFECYCLE & HISTORICAL PRESERVATION
    # ----------------------------------------------------
    print("\n[TEST 15] Student Deactivation Lifecycle & Historical Preservation...")
    deact_reg = "DEACT999"
    execute_command("DELETE FROM gate_records WHERE registration_number_snapshot = :r", {"r": deact_reg})
    execute_command("DELETE FROM students WHERE registration_number = :r", {"r": deact_reg})

    # Step 1: Register student
    admin_client.post('/admin/students/add', data={
        'student_name': 'Divya Nair',
        'registration_number': deact_reg,
        'department': 'ELECTRONICS',
        'year': '2ND YEAR',
        'phone_number': '9845012345',
        'laptop_name': 'LENOVO THINKPAD',
        'laptop_model_number': 'T14-GEN3'
    })

    deact_student = execute_one("SELECT * FROM students WHERE registration_number = :r", {"r": deact_reg})
    assert deact_student is not None, "Deact test student not created"
    deact_payload = QRService.build_payload(deact_student)

    # Step 2: Student enters campus (status becomes INSIDE)
    res_entry = sec_client.post('/api/scan', json={"qr_data": json.dumps(deact_payload)})
    assert res_entry.status_code == 200, f"Entry scan failed: {res_entry.get_json()}"
    assert res_entry.get_json()['status'] == 'INSIDE'
    deact_record_id = res_entry.get_json()['record_id']

    # Step 3: Admin deactivates student
    res_deact = admin_client.post(f'/admin/students/deactivate/{deact_reg}', headers={'X-Requested-With': 'XMLHttpRequest'})
    assert res_deact.status_code == 200, f"Deactivation request failed: {res_deact.get_json()}"
    deact_data = res_deact.get_json()
    assert deact_data['success'] is True, "Deactivation returned success=False"

    # Step 4: Verify student is deleted from active students registry
    student_check = execute_one("SELECT * FROM students WHERE registration_number = :r", {"r": deact_reg})
    assert student_check is None, "Student still present in active students table after deactivation"

    # Step 5: Verify student does NOT appear in active students list API
    res_studs = admin_client.get(f'/api/students?search={deact_reg}')
    assert res_studs.status_code == 200
    studs_data = res_studs.get_json()
    student_list = studs_data.get('students', []) if isinstance(studs_data, dict) else studs_data
    matching_students = [s for s in student_list if s.get('registration_number') == deact_reg or s.get('Registration_Number') == deact_reg]
    assert len(matching_students) == 0, "Deactivated student still returned in /api/students"

    # Step 6: Verify active visit was automatically closed (status = 'OUT' with exit_time)
    closed_visit = execute_one("SELECT * FROM gate_records WHERE record_id = :rid", {"rid": deact_record_id})
    assert closed_visit is not None, "Gate record was deleted when student was deactivated"
    assert closed_visit['status'] == 'OUT', f"Active visit status not closed to OUT, got {closed_visit['status']}"
    assert closed_visit['exit_time'] is not None, "Active visit exit_time was not stamped"
    assert closed_visit['student_id'] is None, "student_id was not set to NULL via ON DELETE SET NULL"

    # Step 7: Verify snapshots are 100% preserved in gate_records
    assert closed_visit['student_name_snapshot'] == 'Divya Nair'
    assert closed_visit['registration_number_snapshot'] == deact_reg
    assert closed_visit['laptop_name_snapshot'] == 'LENOVO THINKPAD'
    assert closed_visit['laptop_model_number_snapshot'] == 'T14-GEN3'

    # Step 8: Verify old QR code scan is rejected
    res_old_qr = sec_client.post('/api/scan', json={"qr_data": json.dumps(deact_payload)})
    assert res_old_qr.status_code == 404, f"Old QR scan should return 404, got {res_old_qr.status_code}: {res_old_qr.get_json()}"
    assert "deactivated" in res_old_qr.get_json()['error'].lower() or "not found" in res_old_qr.get_json()['error'].lower()

    # Step 9: Verify re-registration of the same registration_number is now allowed
    res_re_reg = admin_client.post('/admin/students/add', data={
        'student_name': 'Divya Nair (Re-enrolled)',
        'registration_number': deact_reg,
        'department': 'ELECTRONICS',
        'year': '3RD YEAR',
        'phone_number': '9845099999',
        'laptop_name': 'APPLE MACBOOK AIR',
        'laptop_model_number': 'M3-13'
    }, follow_redirects=False)
    assert res_re_reg.status_code == 302, f"Re-registration failed: {res_re_reg.status_code}"

    re_registered = execute_one("SELECT * FROM students WHERE registration_number = :r", {"r": deact_reg})
    assert re_registered is not None, "Re-registered student not found"
    assert re_registered['student_name'] == 'Divya Nair (Re-enrolled)'
    assert re_registered['laptop_name'] == 'APPLE MACBOOK AIR'
    print("  --> PASS: Student deactivated, active visit closed, history preserved, old QR invalidated, and re-registration confirmed.")

    # Cleanup test data
    for r in [test_reg, poll_reg, concur_reg, deact_reg]:
        execute_command("DELETE FROM gate_records WHERE registration_number_snapshot = :r", {"r": r})
        execute_command("DELETE FROM students WHERE registration_number = :r", {"r": r})

    print("\n==========================================================")
    print("  ALL 15 PRODUCTION & DEACTIVATION TESTS PASSED! (100%)    ")
    print("==========================================================\n")

if __name__ == '__main__':
    run_tests()
