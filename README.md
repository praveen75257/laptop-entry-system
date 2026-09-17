# CPAT College Laptop Gate Management System

A web-based Laptop Entry/Exit Management System replacing the manual notebook at the college gate.
Built with **Flask**, **Neon Serverless PostgreSQL**, **Bootstrap 5**, and **Vanilla JavaScript**, deployed on **Vercel**.

---

## 📌 System Architecture

```text
                 ┌───────────────────────────┐
                 │     ADMIN / SECURITY      │
                 │   Web Browser / Phone     │
                 └─────────────┬─────────────┘
                               │
                             HTTPS
                               │
                               ▼
                 ┌───────────────────────────┐
                 │     VERCEL DEPLOYMENT     │
                 │   Flask REST API Backend  │
                 └─────────────┬─────────────┘
                               │
                           SQL / SSL
                               │
                               ▼
                 ┌───────────────────────────┐
                 │      NEON POSTGRESQL      │
                 │  Authoritative Database   │
                 │                           │
                 │  - Users & Roles          │
                 │  - Students & Laptops     │
                 │  - Gate Entry/Exit Records│
                 │  - Audit System Logs      │
                 └───────────────────────────┘

Dashboard:
Neon PostgreSQL ──> Flask API (/api/dashboard/stats) ──> Admin Browser (Live 2.5s Polling)
```

- **Single Source of Truth**: Neon PostgreSQL stores all users, students, visits, and logs. No external spreadsheets or local files.
- **Serverless-Ready**: Zero local file persistence, zero daemon threads, and a conservative SQLAlchemy connection pool with `pool_pre_ping=True`.
- **Accurate Timestamps**: Server-authoritative timestamps in `Asia/Kolkata` (IST).
- **Live Updating Admin Dashboard**: Automatically polls every 2–3 seconds (2.5s) via `setInterval` calling SQL-backed Flask APIs.
- **Mobile QR Scanner**: Runs locally in the mobile browser over HTTPS on Vercel, requesting the rear camera (`facingMode: "environment"`). Only decoded QR data is transmitted.

---

## 📂 Project Structure

```text
laptop-entry-system/
│
├── app.py                      # Flask app, blueprint registration, health check
├── config.py                   # Environment settings & configuration loader (Asia/Kolkata IST)
├── schema.sql                  # PostgreSQL schema (users, students, gate_records, system_logs)
├── requirements.txt            # Dependencies (Flask, SQLAlchemy, psycopg2-binary, qrcode, pytz, gunicorn)
├── vercel.json                 # Vercel serverless deployment specification (@vercel/python)
├── seed_data.py                # Database seed script for test accounts & sample students
├── test_system.py              # Automated 12-suite end-to-end integration test
├── README.md                   # Complete system documentation
│
├── routes/
│   ├── main_routes.py          # Unified /login and /logout with role routing
│   ├── admin_routes.py         # Dashboard, student CRUD, QR generation, audit logs
│   ├── security_routes.py      # Security guard scanner & inside count badge
│   └── api_routes.py           # Scanner API, records API, students API, dashboard stats
│
├── services/
│   ├── database.py             # SQLAlchemy connection pool, queries, user seeding
│   └── qr_service.py           # In-memory QR code generation (PNG & Base64)
│
├── utils/
│   └── helpers.py              # IST time helpers, role decorators, HMAC verification
│
├── static/
│   ├── css/
│   │   └── style.css           # Clean, modern, responsive CSS styling
│   └── js/
│       ├── admin.js            # Live 2.5s polling, search filter, QR download
│       ├── records.js          # Live records polling & date filtering
│       ├── students.js         # Student search & modal interactions
│       └── security.js         # Camera scanner lifecycle, rear camera, feedback
│
└── templates/
    ├── base.html               # Master layout with Bootstrap 5 & Bootstrap Icons
    ├── auth/
    │   └── login.html          # Unified login page (Admin & Security)
    ├── admin/
    │   ├── base_admin.html     # Admin layout with sidebar navigation
    │   ├── dashboard.html      # Metrics cards, live movements, Currently Inside
    │   ├── students.html       # Student directory & management
    │   ├── add_student.html    # Add student & laptop registration form
    │   ├── edit_student.html   # Edit student profile & laptop details
    │   ├── view_qr.html        # High-resolution printable QR pass
    │   ├── records.html        # Live entry/exit feed with quick date filters
    │   └── logs.html           # System audit trail
    └── security/
        └── dashboard.html      # Mobile-first QR camera scanner & inside counter
```

---

## ⚙️ Environment Configuration

Create a `.env` file in the root directory (see `.env.example`):

```ini
# Flask Secret Key (used for sessions and QR signatures)
SECRET_KEY=change_this_to_a_long_random_secret_in_production

# PostgreSQL Database URL (Neon Serverless Connection String)
DATABASE_URL=postgresql://username:password@ep-xyz.region.neon.tech/neondb?sslmode=require

# Application Timezone
TIMEZONE=Asia/Kolkata

# Default Credentials (auto-seeded on first run)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
SECURITY_USERNAME=security
SECURITY_PASSWORD=security123
```

---

## 🏃 Local Run & Installation

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Configure Database & Seed Users
The database tables and default accounts (`admin`, `security`) are automatically initialized on startup.
To seed sample students:
```bash
python seed_data.py
```

### 3. Start the Server
```bash
python app.py
```
Open **http://localhost:5000** in your browser.

---

## 🔐 Default Credentials & Portals

| Role | Username | Password | Direct Portal |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin` | `admin123` | `/admin/dashboard` |
| **Security Guard** | `security` | `security123` | `/security/dashboard` |

- **One Login Page**: `/login` handles both roles seamlessly.
- **Admin**: Has full access to students, QR generation, records, audit logs, and dashboard metrics.
- **Security Guard**: Directly opens the mobile-first camera scanner to scan QR passes at the gate. Cannot access admin-only student management pages.

---

## 📱 How Security Scans at the Gate

1. Security officer logs in at `/login` on a phone or browser.
2. The **Camera Scanner** opens immediately, requesting rear camera permission.
3. The guard points the camera at the student's QR code pass.
4. **ENTRY scan**:
   - Creates a new record in Neon with `status = 'INSIDE'` and `entry_time = CURRENT_TIMESTAMP`.
   - Displays a green **ENTRY RECORDED** banner.
   - Currently Inside counter increments.
5. **EXIT scan**:
   - Updates the existing record to `status = 'OUT'` and sets `exit_time = CURRENT_TIMESTAMP`.
   - Displays a yellow **EXIT RECORDED** banner with both entry and exit times.
   - Currently Inside counter decrements.
6. **Re-entry**: If the student returns later, scanning again creates a brand new visit record (`status = 'INSIDE'`). Full visit history is preserved.
7. **Duplicate Prevention**: A 4-second server-authoritative cooldown prevents accidental repeated scans (HTTP 429).
8. **Power & Hardware Efficiency**: Camera video tracks automatically stop when navigating between tabs or leaving the page (`pagehide`/`beforeunload`).

---

## ☁️ Deploying to Vercel

1. Push this repository to GitHub or GitLab.
2. Open [Vercel](https://vercel.com) and click **Import Project**.
3. Select your repository.
4. Add the following **Environment Variables** in Vercel Project Settings:
   - `DATABASE_URL` = your Neon PostgreSQL pooled URL
   - `SECRET_KEY` = a long random secret string
   - `TIMEZONE` = `Asia/Kolkata`
   - `ADMIN_USERNAME` = `admin`
   - `ADMIN_PASSWORD` = `admin123`
   - `SECURITY_USERNAME` = `security`
   - `SECURITY_PASSWORD` = `security123`
5. Click **Deploy**. Vercel uses `vercel.json` and `@vercel/python` to deploy the Flask application as a serverless service.
6. Camera scanning works immediately on mobile devices over the resulting HTTPS URL (`https://your-app.vercel.app`).

---

## 🧪 Automated Testing

Run the full end-to-end 12-suite test:
```bash
python test_system.py
```
This verifies:
1. Database Connection (`SELECT 1` & `/api/health`)
2. Login Authentication & Role-based Redirection
3. Authorization & Strict Endpoint Protection
4. Student Registration & Neon Persistence
5. In-Memory QR Generation & Cryptographic HMAC Verification
6. First Scan (ENTRY with `status='INSIDE'` & Cooldown Debounce)
7. Second Scan (EXIT with `status='OUT'`)
8. Third Scan (RE-ENTRY with new record, complete history preserved)
9. Admin Dashboard Live SQL Data & Statistics
10. Automatic Polling Verification (New scan reflected without page refresh)
11. Data Persistence in Neon PostgreSQL
12. Simultaneous Multi-User Sessions (Admin + Security)
