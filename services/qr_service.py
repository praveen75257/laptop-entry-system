import io
import json
import base64
import qrcode
from utils.helpers import generate_qr_signature

class QRService:
    @staticmethod
    def build_payload(student_data):
        """Build canonical dictionary for student QR with signature."""
        payload = {
            "qr_version": 1,
            "student_name": student_data.get('student_name') or student_data.get('name', ''),
            "registration_number": str(student_data.get('registration_number', '')).strip().upper(),
            "department": student_data.get('department', ''),
            "year": student_data.get('year', ''),
            "phone_number": str(student_data.get('phone_number', '')).strip(),
            "laptop_name": student_data.get('laptop_name', ''),
            "laptop_model_number": student_data.get('laptop_model_number', '')
        }
        payload["signature"] = generate_qr_signature(payload)
        return payload

    @staticmethod
    def generate_qr_base64(student_data):
        """Generate base64 Data URL directly in memory for HTML preview."""
        payload = QRService.build_payload(student_data)
        json_str = json.dumps(payload, separators=(',', ':'))

        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=8,
            border=3
        )
        qr.add_data(json_str)
        qr.make(fit=True)

        img = qr.make_image(fill_color='black', back_color='white')
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        buf.seek(0)
        encoded = base64.b64encode(buf.getvalue()).decode('utf-8')
        return f"data:image/png;base64,{encoded}"

    @staticmethod
    def generate_qr_bytes(student_data):
        """Generate raw PNG bytes in memory for streaming download."""
        payload = QRService.build_payload(student_data)
        json_str = json.dumps(payload, separators=(',', ':'))

        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=10,
            border=4
        )
        qr.add_data(json_str)
        qr.make(fit=True)

        img = qr.make_image(fill_color='black', back_color='white')
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        buf.seek(0)
        return buf.getvalue()
