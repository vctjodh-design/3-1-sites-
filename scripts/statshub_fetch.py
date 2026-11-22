#!/usr/bin/env python3
"""Fetch StatsHub JSON endpoints with a Chrome TLS fingerprint.

StatsHub sits behind a Cloudflare bot check that rejects plain HTTP clients
(including Node's fetch). curl_cffi reproduces Chrome's TLS/HTTP2 fingerprint,
which the site accepts, so this small bridge does the transport for the Node app.

Usage: echo '{"urls": ["https://www.statshub.com/api/..."]}' | python3 statshub_fetch.py
"""

import base64
import json
import sys
from concurrent.futures import ThreadPoolExecutor


def _fetch(url, timeout, binary=False, headers=None):
    from curl_cffi import requests

    try:
        with requests.Session(impersonate="chrome") as session:
            response = session.get(url, timeout=timeout, headers=headers or {})
            if binary:
                return {
                    "url": url,
                    "status": response.status_code,
                    "contentType": response.headers.get("content-type", ""),
                    "base64": base64.b64encode(response.content).decode("ascii"),
                }
            return {"url": url, "status": response.status_code, "body": response.text}
    except Exception as error:  # noqa: BLE001 - reported back to Node as data
        return {"url": url, "error": f"{type(error).__name__}: {error}"}


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception as error:  # noqa: BLE001
        json.dump({"error": f"Invalid request payload: {error}"}, sys.stdout)
        return 2

    urls = [str(url) for url in (payload.get("urls") or []) if str(url).startswith("https://")]
    timeout = float(payload.get("timeout") or 30)
    binary = bool(payload.get("binary"))
    headers = payload.get("headers") or {}
    if not isinstance(headers, dict):
        headers = {}
    if not urls:
        json.dump({"results": []}, sys.stdout)
        return 0

    workers = 12 if binary else 6
    with ThreadPoolExecutor(max_workers=min(workers, len(urls))) as pool:
        results = list(pool.map(lambda url: _fetch(url, timeout, binary, headers), urls))

    json.dump({"results": results}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
