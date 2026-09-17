import os
import logging
from contextlib import contextmanager
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.security import generate_password_hash
from config import Config

logger = logging.getLogger(__name__)

if not Config.DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is not configured. Please set it in .env.")

# Create SQLAlchemy engine with connection pool settings optimized for Serverless / Neon
engine = create_engine(
    Config.DATABASE_URL,
    pool_pre_ping=True,      # Tests connection liveness before checkout to prevent dead sockets
    pool_recycle=300,        # Recycle connections every 5 minutes
    pool_size=3,             # Conservative pool for serverless execution
    max_overflow=2,          # Max burst overflow
    pool_timeout=10          # Fast timeout to prevent hung lambdas
)

@contextmanager
def get_db_connection():
    """Context manager for acquiring a database connection."""
    connection = engine.connect()
    try:
        yield connection
    finally:
        connection.close()

def test_connection():
    """Verify that the database responds to a simple query."""
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1")).scalar()
            return result == 1
    except Exception as e:
        logger.error(f"Database test connection failed: {e}")
        return False

def execute_query(sql_statement, params=None):
    """Execute a parameterized SELECT query and return list of dicts."""
    with engine.connect() as conn:
        result = conn.execute(text(sql_statement), params or {})
        return [dict(row._mapping) for row in result]

def execute_one(sql_statement, params=None):
    """Execute a parameterized SELECT query and return a single dict or None."""
    rows = execute_query(sql_statement, params)
    return rows[0] if rows else None

def execute_command(sql_statement, params=None):
    """Execute an INSERT, UPDATE, or DELETE query within an atomic transaction."""
    with engine.begin() as conn:
        result = conn.execute(text(sql_statement), params or {})
        return result

def init_db():
    """Initialize tables from schema.sql if needed and seed default admin/security accounts."""
    schema_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'schema.sql')
    if os.path.exists(schema_path):
        with open(schema_path, 'r', encoding='utf-8-sig') as f:
            sql_content = f.read().lstrip('\ufeff')
        with engine.begin() as conn:
            for statement in sql_content.split(';'):
                stmt = statement.strip()
                if stmt:
                    conn.execute(text(stmt))

    # Seed initial users if they do not exist
    seed_users()

def seed_users():
    """Ensure default admin and security users exist with secure password hashes."""
    try:
        with engine.begin() as conn:
            # Check Admin
            admin_check = conn.execute(
                text("SELECT id FROM users WHERE username = :u"),
                {"u": Config.ADMIN_USERNAME}
            ).fetchone()
            if not admin_check:
                admin_hash = generate_password_hash(Config.ADMIN_PASSWORD)
                conn.execute(
                    text("""
                        INSERT INTO users (username, password_hash, role, active)
                        VALUES (:u, :p, 'admin', TRUE)
                    """),
                    {"u": Config.ADMIN_USERNAME, "p": admin_hash}
                )
                logger.info(f"Seeded admin user: {Config.ADMIN_USERNAME}")

            # Check Security
            sec_check = conn.execute(
                text("SELECT id FROM users WHERE username = :u"),
                {"u": Config.SECURITY_USERNAME}
            ).fetchone()
            if not sec_check:
                sec_hash = generate_password_hash(Config.SECURITY_PASSWORD)
                conn.execute(
                    text("""
                        INSERT INTO users (username, password_hash, role, active)
                        VALUES (:u, :p, 'security', TRUE)
                    """),
                    {"u": Config.SECURITY_USERNAME, "p": sec_hash}
                )
                logger.info(f"Seeded security user: {Config.SECURITY_USERNAME}")
    except Exception as e:
        logger.error(f"Error seeding users: {e}")

