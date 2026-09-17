import os
import sys
from flask import Flask, jsonify
from config import Config
from services.database import init_db, test_connection

# Initialize Flask Application
app = Flask(__name__)
app.config.from_object(Config)
app.secret_key = Config.SECRET_KEY

# Register Blueprints
from routes.main_routes import main_bp
from routes.admin_routes import admin_bp
from routes.security_routes import security_bp
from routes.api_routes import api_bp

app.register_blueprint(main_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(security_bp)
app.register_blueprint(api_bp)

# Initialize database schema and default admin/security users on startup
try:
    init_db()
    print("[INIT] PostgreSQL Database initialized and verified.")
except Exception as e:
    print(f"[WARN] Database initialization warning: {e}")

@app.route('/api/health')
def health_check():
    """System and database health check."""
    db_ok = test_connection()
    return jsonify({
        "status": "healthy" if db_ok else "unhealthy",
        "database_connected": db_ok,
        "service": "CPAT Laptop Gate Management System"
    }), 200 if db_ok else 500

# Vercel entrypoint exposes 'app' directly
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"Starting Laptop Gate System on http://127.0.0.1:{port} ...")
    app.run(host='127.0.0.1', port=port, debug=True)

