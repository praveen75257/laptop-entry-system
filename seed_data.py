import sys
from services.database import execute_query, execute_command, execute_one, init_db
from utils.helpers import generate_qr_signature

def seed():
    print("--- Seeding Database ---")
    init_db()

    sample_students = [
        {
            "student_name": "Praveen",
            "registration_number": "23CSE001",
            "department": "CSE",
            "year": "2ND YEAR",
            "phone_number": "9876543210",
            "laptop_name": "ASUS VIVOBOOK",
            "laptop_model_number": "X1502ZA"
        },
        {
            "student_name": "Rahul Sharma",
            "registration_number": "23IT045",
            "department": "IT",
            "year": "2ND YEAR",
            "phone_number": "9123456780",
            "laptop_name": "DELL INSPIRON",
            "laptop_model_number": "15-3520"
        },
        {
            "student_name": "Ananya Iyer",
            "registration_number": "22ECE012",
            "department": "ECE",
            "year": "3RD YEAR",
            "phone_number": "9988776655",
            "laptop_name": "HP PAVILION",
            "laptop_model_number": "14-DV2014TU"
        }
    ]

    for s in sample_students:
        existing = execute_one(
            "SELECT id FROM students WHERE registration_number = :r",
            {"r": s["registration_number"]}
        )
        if not existing:
            sig = generate_qr_signature(s)
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
            """, {**s, "sig": sig})
            print(f"  + Added student: {s['student_name']} ({s['registration_number']})")
        else:
            print(f"  . Student {s['registration_number']} already exists.")

    print("[SUCCESS] Database seeding complete!")

if __name__ == '__main__':
    seed()
