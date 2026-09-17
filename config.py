import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

class Config:
    # Flask Secret Key (Strictly required from environment variables for production security)
    SECRET_KEY = os.environ.get('SECRET_KEY')
    if not SECRET_KEY:
        raise RuntimeError("SECRET_KEY environment variable is required and cannot be empty. Please configure it in .env or Vercel environment variables.")

    # PostgreSQL Database URL
    DATABASE_URL = os.environ.get('DATABASE_URL')
    if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

    # Authentication credentials (used for seeding / fallback)
    ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
    ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin123')
    SECURITY_USERNAME = os.environ.get('SECURITY_USERNAME', 'security')
    SECURITY_PASSWORD = os.environ.get('SECURITY_PASSWORD', 'security123')

    # Authoritative Timezone
    TIMEZONE = os.environ.get('TIMEZONE', 'Asia/Kolkata')

    # Session Security
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    PERMANENT_SESSION_LIFETIME = 86400  # 24 hours
