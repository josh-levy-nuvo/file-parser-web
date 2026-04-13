"""
api/batch.py
POST /api/batch
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
        "cleaned_data": "<base64>"   // only when dry_run=false and status=ok
      }
    ]
  }
"""

import os
import json
import base64
import time

from jose import jwt, JWTError
from parser.sheet_cleaner import clean_file_bytes

COOKIE_NAME = "fp_session"
JWT_SECRET  = os.environ.get("JWT_SECRET", "dev-secret")


def _verify_auth(cookie_header: str) -> bool:
    if not cookie_header:
        return False
    for part in cookie_header.split(";"):
        part = part.strip()
        if part.startswith(f"{COOKIE_NAME}="):
            token = part[len(f"{COOKIE_NAME}="):]
            try:
                payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
                return payload.get("exp", 0) > int(time.time())
            except JWTError:
                return False
    return False


def handler(request):
    # Auth check
    cookies = request.headers.get("cookie", "")
    if not _verify_auth(cookies):
        return {"statusCode": 401, "body": json.dumps({"error": "Unauthorized"}),
                "headers": {"Content-Type": "application/json"}}

    if request.method != "POST":
        return {"statusCode": 405, "body": json.dumps({"error": "Method not allowed"}),
                "headers": {"Content-Type": "application/json"}}

    try:
        body = json.loads(request.body)
    except Exception:
        return {"statusCode": 400, "body": json.dumps({"error": "Invalid JSON"}),
                "headers": {"Content-Type": "application/json"}}

    files    = body.get("files", [])
    benefits = [b.strip() for b in body.get("benefits", []) if b.strip()]
    dry_run  = body.get("dry_run", True)

    if not benefits:
        return {"statusCode": 400, "body": json.dumps({"error": "No benefits provided"}),
                "headers": {"Content-Type": "application/json"}}

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

        # Encode cleaned file as base64 for transport (full run only)
        if not dry_run and result["status"] == "ok" and "cleaned_bytes" in result:
            result["cleaned_data"] = base64.b64encode(result["cleaned_bytes"]).decode()
        result.pop("cleaned_bytes", None)

        results.append(result)

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"results": results}),
    }
