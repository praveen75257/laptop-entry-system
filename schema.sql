-- ==========================================================
-- CPAT LAPTOP GATE MANAGEMENT SYSTEM
-- PostgreSQL Database Schema (Neon Compatible)
-- ==========================================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'security')),
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. STUDENTS TABLE
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    student_name VARCHAR(150) NOT NULL,
    registration_number VARCHAR(50) UNIQUE NOT NULL,
    department VARCHAR(100) NOT NULL,
    year VARCHAR(50) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    laptop_name VARCHAR(100) NOT NULL,
    laptop_model_number VARCHAR(100) NOT NULL,
    qr_version INT DEFAULT 1,
    qr_signature TEXT,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. GATE RECORDS TABLE
CREATE TABLE IF NOT EXISTS gate_records (
    id SERIAL PRIMARY KEY,
    record_id VARCHAR(64) UNIQUE NOT NULL,
    student_id INT REFERENCES students(id) ON DELETE SET NULL,
    student_name_snapshot VARCHAR(150) NOT NULL,
    registration_number_snapshot VARCHAR(50) NOT NULL,
    department_snapshot VARCHAR(100) NOT NULL,
    year_snapshot VARCHAR(50) NOT NULL,
    phone_number_snapshot VARCHAR(20) NOT NULL,
    laptop_name_snapshot VARCHAR(100) NOT NULL,
    laptop_model_number_snapshot VARCHAR(100) NOT NULL,
    entry_time TIMESTAMPTZ NOT NULL,
    exit_time TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL CHECK (status IN ('INSIDE', 'OUT')),
    qr_version INT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. SYSTEM LOGS TABLE
CREATE TABLE IF NOT EXISTS system_logs (
    id SERIAL PRIMARY KEY,
    action VARCHAR(50) NOT NULL,
    details TEXT,
    username VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================================
-- INDEXES FOR HIGH-PERFORMANCE QUERYING & SCANNING
-- ==========================================================
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_students_reg_no ON students(registration_number);
CREATE INDEX IF NOT EXISTS idx_gate_records_record_id ON gate_records(record_id);
CREATE INDEX IF NOT EXISTS idx_gate_records_student_id ON gate_records(student_id);
CREATE INDEX IF NOT EXISTS idx_gate_records_status ON gate_records(status);
CREATE INDEX IF NOT EXISTS idx_gate_records_student_status ON gate_records(student_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gate_records_unique_inside ON gate_records(student_id) WHERE status = 'INSIDE';
CREATE INDEX IF NOT EXISTS idx_gate_records_entry_time ON gate_records(entry_time DESC);
CREATE INDEX IF NOT EXISTS idx_gate_records_reg_snapshot ON gate_records(registration_number_snapshot);
CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs(created_at DESC);
