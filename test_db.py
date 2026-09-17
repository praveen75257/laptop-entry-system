import os
import sys

from dotenv import load_dotenv
from sqlalchemy import create_engine, text


# Load variables from .env
load_dotenv()

database_url = os.environ.get("DATABASE_URL")

if not database_url:
    print("\n[ERROR] DATABASE_URL is not set in your .env file!")
    print("Please add DATABASE_URL=postgresql://... to your .env file.")
    sys.exit(1)


# Convert old postgres:// format if necessary
if database_url.startswith("postgres://"):
    database_url = database_url.replace(
        "postgres://",
        "postgresql://",
        1
    )


print("\n--- Testing Neon PostgreSQL Connection ---")

# Don't print the password
if "@" in database_url:
    safe_database_url = database_url.split("@")[-1]
else:
    safe_database_url = "configured database"

print(f"Connecting to: {safe_database_url} ...")


try:
    # Create database engine
    engine = create_engine(
        database_url,
        pool_pre_ping=True
    )

    # Test connection
    with engine.connect() as conn:

        version = conn.execute(
            text("SELECT version();")
        ).scalar()

        print("[SUCCESS] Connected successfully!")
        print(f"Server version: {version[:80]}...\n")


    # Apply database schema
    schema_file = os.path.join(
        os.path.dirname(__file__),
        "schema.sql"
    )

    if not os.path.exists(schema_file):
        print("[ERROR] schema.sql was not found!")
        sys.exit(1)

    print("Applying schema.sql to create/verify tables...")

    with open(schema_file, "r", encoding="utf-8-sig") as file:
        sql_content = file.read()

    # Execute each SQL statement
    with engine.begin() as conn:

        statements = sql_content.split(";")

        for statement in statements:

            statement = statement.strip()

            if statement:
                conn.execute(text(statement))

    print("[SUCCESS] Schema executed successfully!\n")


    # Verify required tables
    print("Verifying tables:")

    required_tables = [
        "users",
        "students",
        "gate_records",
        "system_logs"
    ]

    with engine.connect() as conn:

        for table in required_tables:

            result = conn.execute(
                text("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables
                        WHERE table_schema = 'public'
                        AND table_name = :table_name
                    );
                """),
                {"table_name": table}
            ).scalar()

            if result:
                print(f"  - Table '{table}': FOUND (OK)")
            else:
                print(f"  - Table '{table}': MISSING")


    print("\n[COMPLETE] Phase 1 Database setup is verified and ready!")


except Exception as error:

    print("\n[FAILURE] Connection or schema execution failed:")
    print(error)
    sys.exit(1)