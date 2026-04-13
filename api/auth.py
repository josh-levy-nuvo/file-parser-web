"""
api/auth.py
POST /api/auth — validates password, sets HttpOnly JWT cookie.
"""

import os
import json
import time
from http.cookies import SimpleCookie
from jose import jwt

APP_PASSWORD = os.environ.get("APP_PASSWORD", "")
JWT_SECRET   = os.environ.get("JWT_SECRET", "dev-secret")
COOKIE_NAME  = "fp_session"
EXPIRE_SECS  = 60 * 60 * 24  # 24 hours


def handler(request):
    if request.method != "POST":
        return Response({"error": "Method not allowed"}, status=405)

    try:
        body = json.loads(request.body)
    except Exception:
        return Response({"error": "Invalid JSON"}, status=400)

    password = body.get("password", "")
    if not APP_PASSWORD or password != APP_PASSWORD:
        return Response({"error": "Invalid password"}, status=401)

    token = jwt.encode(
        {"sub": "user", "exp": int(time.time()) + EXPIRE_SECS},
        JWT_SECRET,
        algorithm="HS256",
    )

    resp = Response({"ok": True}, status=200)
    resp.set_cookie(
        COOKIE_NAME,
        token,
        http_only=True,
        same_site="Strict",
        max_age=EXPIRE_SECS,
        path="/",
    )
    return resp


class Response:
    def __init__(self, body: dict, status: int = 200):
        self.body   = body
        self.status = status
        self._cookies: dict = {}

    def set_cookie(self, name, value, **kwargs):
        self._cookies[name] = {"value": value, **kwargs}

    def to_vercel(self):
        headers = {"Content-Type": "application/json"}
        for name, opts in self._cookies.items():
            val     = opts["value"]
            parts   = [f"{name}={val}"]
            if opts.get("http_only"):   parts.append("HttpOnly")
            if opts.get("same_site"):   parts.append(f"SameSite={opts['same_site']}")
            if opts.get("max_age"):     parts.append(f"Max-Age={opts['max_age']}")
            if opts.get("path"):        parts.append(f"Path={opts['path']}")
            headers["Set-Cookie"] = "; ".join(parts)
        return {
            "statusCode": self.status,
            "headers": headers,
            "body": json.dumps(self.body),
        }


def vercel_handler(request):
    resp = handler(request)
    return resp.to_vercel()
