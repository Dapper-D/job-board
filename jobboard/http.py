"""HTTP helpers with polite defaults."""

from __future__ import annotations

import time

import requests


class Http:
    def __init__(self, user_agent: str, timeout: int = 20, pause: float = 0.5):
        self.s = requests.Session()
        self.s.headers["User-Agent"] = user_agent
        self.timeout = timeout
        self.pause = pause   # seconds between requests, to be gentle on free APIs

    def get(self, url: str, **params) -> requests.Response:
        time.sleep(self.pause)
        r = self.s.get(url, params=params or None, timeout=self.timeout)
        r.raise_for_status()
        return r

    def json(self, url: str, **params):
        return self.get(url, **params).json()

    def text(self, url: str, **params) -> str:
        return self.get(url, **params).text

    def peek(self, url: str, limit: int = 60_000) -> tuple[int, str]:
        """Status code and the start of the page, without raising on 4xx/5xx.
        Used to check whether a posting is still up. Returns (0, "") on network errors."""
        time.sleep(self.pause)
        try:
            r = self.s.get(url, timeout=self.timeout, allow_redirects=True)
            return r.status_code, r.text[:limit]
        except requests.RequestException:
            return 0, ""

    def post_json(self, url: str, payload: dict, headers: dict) -> dict:
        r = self.s.post(url, json=payload, headers=headers, timeout=max(self.timeout, 90))
        if r.status_code >= 400:
            # Show the provider's error message, never the request headers (they hold the key).
            raise RuntimeError(f"HTTP {r.status_code} from {url.split('?')[0]}: {r.text[:300]}")
        return r.json()
