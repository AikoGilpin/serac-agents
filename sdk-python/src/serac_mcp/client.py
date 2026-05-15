"""
Serac Agent SDK — HTTP Client (zero dependencies)

Uses only Python 3.10+ stdlib: urllib, json, ssl, hashlib.
No requests, no httpx, no aiohttp.
"""

from __future__ import annotations

import json
import urllib.request
import urllib.error
import urllib.parse
import time
from typing import Any, Optional


class SeracError(Exception):
    """Serac API error."""

    def __init__(self, code: str, message: str, status_code: int | None = None, details: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details


ERROR_CODES = {
    400: "VALIDATION_FAILED",
    401: "AUTH_FAILED",
    402: "PAYMENT_REQUIRED",
    403: "AUTH_FAILED",
    404: "NOT_FOUND",
    409: "ALREADY_EXISTS",
    429: "RATE_LIMITED",
}


class HttpClient:
    """Low-level HTTP client for the Serac Agent API."""

    DEFAULT_BASE_URL = "https://serac.cloud/api/agent"
    DEFAULT_TIMEOUT = 30  # seconds
    MAX_RETRIES = 3
    RETRY_DELAY = 1.0  # seconds (base, exponential backoff)
    RETRY_STATUS_CODES = {429, 502, 503, 504}

    def __init__(
        self,
        api_key: str,
        base_url: str | None = None,
        timeout: int | None = None,
        max_retries: int | None = None,
    ):
        self.api_key = api_key
        self.base_url = (base_url or self.DEFAULT_BASE_URL).rstrip("/")
        self.timeout = timeout or self.DEFAULT_TIMEOUT
        self.max_retries = max_retries or self.MAX_RETRIES
        self.jwt: str | None = None
        self.jwt_expiry: float = 0

    def _get_auth_headers(self) -> dict[str, str]:
        """Get authorization headers — JWT if available, else API key."""
        if self.jwt and time.time() < self.jwt_expiry:
            return {"Authorization": f"Bearer {self.jwt}"}
        return {"X-API-Key": self.api_key}

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Make an HTTP request with retry logic."""
        url = f"{self.base_url}{path}"

        if params:
            # Filter None values
            filtered = {k: v for k, v in params.items() if v is not None}
            if filtered:
                url += "?" + urllib.parse.urlencode(filtered)

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            **self._get_auth_headers(),
        }

        data = json.dumps(body).encode("utf-8") if body else None
        if method == "GET":
            data = None

        last_error: Exception | None = None

        for attempt in range(self.max_retries):
            try:
                req = urllib.request.Request(url, data=data, headers=headers, method=method)
                ctx = urllib.request.ssl.create_default_context()

                with urllib.request.urlopen(req, timeout=self.timeout, context=ctx) as resp:
                    response_data = json.loads(resp.read().decode("utf-8"))
                    return response_data

            except urllib.error.HTTPError as e:
                error_body = ""
                try:
                    error_body = e.read().decode("utf-8")
                    error_json = json.loads(error_body)
                except Exception:
                    error_json = {}

                if e.code in self.RETRY_STATUS_CODES and attempt < self.max_retries - 1:
                    delay = self.RETRY_DELAY * (2 ** attempt)
                    time.sleep(delay)
                    continue

                code = ERROR_CODES.get(e.code, "SERVER_ERROR")
                raise SeracError(
                    code=code,
                    message=error_json.get("error", f"HTTP {e.code}: {e.reason}"),
                    status_code=e.code,
                    details=error_json,
                )

            except urllib.error.URLError as e:
                if attempt < self.max_retries - 1:
                    delay = self.RETRY_DELAY * (2 ** attempt)
                    time.sleep(delay)
                    continue
                raise SeracError(
                    code="NETWORK_ERROR",
                    message=str(e.reason),
                    status_code=None,
                )

        # Should not reach here, but just in case
        raise SeracError(code="NETWORK_ERROR", message="Max retries exceeded", status_code=None)

    def get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._request("GET", path, params=params)

    def post(self, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._request("POST", path, body=body)

    def delete(self, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._request("DELETE", path, body=body)

    def refresh_auth(self) -> dict[str, Any]:
        """
        Re-authenticate using the API key to get a fresh JWT.
        The server exchanges the API key for a JWT with 1-hour expiry.
        """
        return self.post("/auth/api-key", {"api_key": self.api_key})