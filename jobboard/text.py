"""Small text helpers."""

from __future__ import annotations

import html
import re
from datetime import datetime, timezone

_TAG = re.compile(r"<[^>]+>")
_BLOCK = re.compile(r"</?(p|div|br|li|ul|ol|h[1-6]|tr)\b[^>]*>", re.I)
_SPACES = re.compile(r"[ \t\r\f\v]+")
_BLANKS = re.compile(r"\n\s*\n+")


def strip_html(raw: str | None) -> str:
    """HTML (possibly entity-escaped, as Greenhouse sends it) to plain text."""
    if not raw:
        return ""
    s = html.unescape(html.unescape(raw))
    s = _BLOCK.sub("\n", s)
    s = _TAG.sub("", s)
    s = _SPACES.sub(" ", s)
    s = _BLANKS.sub("\n\n", s)
    return s.strip()


def phrase_in(phrase: str, text: str) -> bool:
    """Case-insensitive phrase match that respects word edges,
    so "lead" doesn't match "leading" and "ios" doesn't match "bios"."""
    p = phrase.lower().strip()
    if not p:
        return False
    start = r"\b" if p[0].isalnum() else ""
    end = r"\b" if p[-1].isalnum() else ""
    return re.search(start + re.escape(p) + end, text.lower()) is not None


def any_phrase(phrases, text: str) -> str | None:
    """The first phrase found in text, or None."""
    for p in phrases:
        if phrase_in(p, text):
            return p
    return None


def to_date(value) -> str:
    """Best-effort conversion of the many date formats sources use to YYYY-MM-DD."""
    if value in (None, ""):
        return ""
    try:
        if isinstance(value, (int, float)):
            ts = float(value)
            if ts > 1e12:          # milliseconds
                ts /= 1000
            return datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()
        s = str(value).strip()
        if s.isdigit():
            return to_date(int(s))
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            pass
        from email.utils import parsedate_to_datetime  # RSS dates
        return parsedate_to_datetime(s).date().isoformat()
    except Exception:
        return ""


def days_old(date_str: str, today: str) -> int | None:
    if not date_str:
        return None
    try:
        a = datetime.fromisoformat(date_str).date()
        b = datetime.fromisoformat(today).date()
        return (b - a).days
    except ValueError:
        return None


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:80]
