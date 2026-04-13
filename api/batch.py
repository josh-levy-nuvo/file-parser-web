"""
api/batch.py
POST /api/batch
Vercel Python serverless function (handler class format).

Body (JSON):
  {
    "files":    [{"name": "foo.xlsx", "data": "<base64>"}],
    "benefits": ["LIFE", "WOP", "CI"],
    "dry_run":  true
  }

Returns (JSON):
  {
    "results": [
      {
        "file":         "foo.xlsx",
        "tabs_before":  [...],
        "tabs_kept":    [...],
        "tabs_removed": [...],
        "tabs_renamed": [...],
        "status":       "ok"|"skipped"|"error",
        "note":         "",
        "cleaned_data": "<base64>"
      }
    ]
  }
"""

import os
import sys
import json
import base64
import time
from http.server import BaseHTTPRequestHandler

# Ensure xlsx_parser is importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from xlsx_parser.sheet_cleaner import clean_file_bytes

COOKIE_NAME = "fp_session"
JWT_SECRET  = os.environ.get("JWT_SECRET", "dev-secret")


def _verify_auth(cookie_header: str) -> bool:
    """Verify JWT cookie without python-jose (use stdlib hmac)."""
    if not cookie_header:
        return False
    import hmac
    import hashlib
    for part in cookie_header.split(";"):
        part = part.strip()
        if part.startswith(f"{COOKIE_NAME}="):
            token = part[len(f"{COOKIE_NAME}="):]
            try:
                # JWT: header.payload.signature (all base64url)
                parts = token.split(".")
                if len(parts) != 3:
                    return False
                header_payload = f"{parts[0]}.{parts[1]}"
                # Verify signature
                expected_sig = hmac.new(
                    JWT_SECRET.encode(),
                    header_payload.encode(),
                    hashlib.sha256
                ).digest()
                # base64url decode signature
                sig_b64 = parts[2] + "=="  # pad
                sig_b64 = sig_b64.replace("-", "+").replace("_", "/")
                actual_sig = base64.b64decode(sig_b64)
                if not hmac.compare_digest(expected_sig, actual_sig):
                    return False
                # Check expiry from payload
                pad = len(parts[1]) % 4
                payload_b64 = parts[1] + ("=" * (4 - pad) if pad else "")
                payload_b64 = payload_b64.replace("-", "+").replace("_", "/")
                payload = json.loads(base64.b64decode(payload_b64))
                return payload.get("exp", 0) > int(time.time())
            except Exception:
                return False
    return False


def _json_response(handler, status: int, body: dict):
    payload = json.dumps(body).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


class handler(BaseHTTPRequestHandler):

    def do_POST(self):
        # Auth
        cookie_header = self.headers.get("cookie", "")
        if not _verify_auth(cookie_header):
            _json_response(self, 401, {"error": "Unauthorized"})
            return

        # Read body
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length))
        except Exception:
            _json_response(self, 400, {"error": "Invalid JSON"})
            return

        files    = body.get("files", [])
        benefits = [b.strip() for b in body.get("benefits", []) if b.strip()]
        dry_run  = body.get("dry_run", True)

        if not benefits:
            _json_response(self, 400, {"error": "No benefits provided"})
            return

        results = []
        for f in files:
            name     = f.get("name", "unknown.xlsx")
            raw_data = f.get("data", "")
            try:
                file_bytes = base64.b64decode(raw_data)
            except Exception as e:
                results.append({
                    "file": name, "tabs_before": [], "tabs_kept": [],
                    "tabs_removed": [], "tabs_renamed": [],
                    "status": "error", "note": f"Base64 decode error: {e}"
                })
                continue

            result = clean_file_bytes(file_bytes, name, benefits, dry_run=dry_run)

            if not dry_run and result["status"] == "ok" and "cleaned_bytes" in result:
                result["cleaned_data"] = base64.b64encode(result["cleaned_bytes"]).decode()
            result.pop("cleaned_bytes", None)
            results.append(result)

        _json_response(self, 200, {"results": results})

    def log_message(self, format, *args):
        pass  # Suppress default request logging
