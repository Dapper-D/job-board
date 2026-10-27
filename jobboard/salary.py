"""Find pay in a posting and convert it to annual CAD."""

from __future__ import annotations

import re

HOURS_PER_YEAR = 2080

_CUR = (
    r"(?P<{n}>CA\$|C\$|CAD\s?\$?|US\$|USD\s?\$?|AU\$|A\$|AUD\s?\$?|NZ\$|NZD\s?\$?|S\$|SGD\s?\$?"
    r"|GBP\s?£?|£|EUR\s?€?|€|CHF\s?|AED\s?|\$)"
)
_NUM = r"(?P<{n}>\d{{1,3}}(?:[,\s]\d{{3}})+|\d+(?:\.\d+)?)\s?(?P<{k}>[kK])?"
_DASH = r"\s?(?:-|–|—|to)\s?"
_TAIL = r"(?P<tail>\s?(?:CAD|USD|AUD|NZD|SGD|GBP|EUR|CHF|AED))?"

RANGE_RE = re.compile(
    _CUR.format(n="c1") + r"\s?" + _NUM.format(n="a", k="ka")
    + _DASH + r"(?:" + _CUR.format(n="c2") + r"\s?)?" + _NUM.format(n="b", k="kb") + _TAIL,
    re.I,
)
SINGLE_RE = re.compile(_CUR.format(n="c1") + r"\s?" + _NUM.format(n="a", k="ka") + _TAIL, re.I)

_HOUR = re.compile(r"^\s{0,3}(?:/\s?h(?:ou)?r|per\s+hour|an\s+hour|hourly|/\s?hour)", re.I)
_YEAR = re.compile(r"^\s{0,3}(?:/\s?y(?:ea)?r|per\s+(?:year|annum)|a\s+year|annually|yearly|/\s?annum)", re.I)
_MONTH = re.compile(r"^\s{0,3}(?:/\s?mo(?:nth)?|per\s+month|a\s+month|monthly)", re.I)
_BIG = re.compile(r"^\s{0,2}(?:bn|billion|m\b|million|mm\b)", re.I)
_PAY_WORDS = re.compile(r"salary|pay|compensation|base|wage|rate|range|ote", re.I)


def _currency(token: str | None, tail: str | None, default: str) -> str:
    t = (tail or token or "").upper().replace(" ", "")
    for code, keys in {
        "CAD": ("CA$", "C$", "CAD"),
        "USD": ("US$", "USD"),
        "AUD": ("AU$", "A$", "AUD"),
        "NZD": ("NZ$", "NZD"),
        "SGD": ("S$", "SGD"),
        "GBP": ("£", "GBP"),
        "EUR": ("€", "EUR"),
        "CHF": ("CHF",),
        "AED": ("AED",),
    }.items():
        if any(t.startswith(k) for k in keys):
            return code
    return default


def _num(raw: str, k: str | None) -> float:
    v = float(re.sub(r"[,\s]", "", raw))
    return v * 1000 if k else v


def _interval(after: str, top: float) -> str:
    if _HOUR.match(after):
        return "hour"
    if _MONTH.match(after):
        return "month"
    if _YEAR.match(after):
        return "year"
    return "hour" if top < 500 else "year"


def annual(amount: float, interval: str) -> float:
    return amount * {"hour": HOURS_PER_YEAR, "month": 12}.get(interval, 1)


def parse(text: str, default_currency: str = "USD") -> dict | None:
    """The first plausible posted pay range (or single figure next to pay words).

    Returns {"min", "max", "currency", "interval"} or None.
    """
    if not text:
        return None
    candidates = []
    for m in RANGE_RE.finditer(text):
        after = text[m.end(): m.end() + 20]
        if _BIG.match(after):
            continue
        lo, hi = _num(m["a"], m["ka"]), _num(m["b"], m["kb"])
        if m["ka"] and not m["kb"] and hi < 1000:   # "$90k-110"
            hi *= 1000
        if m["kb"] and not m["ka"] and lo < 1000:   # "$90-110k"
            lo *= 1000
        if hi < lo:
            lo, hi = hi, lo
        cur = _currency(m["c1"] or m["c2"], m["tail"], default_currency)
        candidates.append({"min": lo, "max": hi, "currency": cur, "interval": _interval(after, hi)})
    if not candidates:
        for m in SINGLE_RE.finditer(text):
            after = text[m.end(): m.end() + 20]
            before = text[max(0, m.start() - 80): m.start()]
            if _BIG.match(after) or not _PAY_WORDS.search(before + after):
                continue
            v = _num(m["a"], m["ka"])
            cur = _currency(m["c1"], m["tail"], default_currency)
            candidates.append({"min": v, "max": v, "currency": cur, "interval": _interval(after, v)})
    for c in candidates:
        yearly = annual(c["max"], c["interval"])
        if 20_000 <= yearly <= 1_000_000:   # skip perks, budgets, market sizes
            return c
    return None


def to_cad_annual(pay: dict, rates: dict) -> tuple[float, float]:
    rate = float(rates.get(pay["currency"], 0) or 0)
    if not rate:
        return 0.0, 0.0
    return (
        round(annual(pay["min"], pay["interval"]) * rate),
        round(annual(pay["max"], pay["interval"]) * rate),
    )


def display(pay: dict | None, rates: dict) -> str:
    if not pay:
        return "Salary not posted"
    cur = pay["currency"]
    sym = {"CAD": "C$", "USD": "US$", "GBP": "£", "EUR": "€", "AUD": "A$", "NZD": "NZ$", "SGD": "S$"}.get(cur, cur + " ")
    if pay["interval"] == "hour":
        fmt, unit = (lambda v: f"{v:,.2f}"), "/hr"
    elif pay["interval"] == "month":
        fmt, unit = (lambda v: f"{v:,.0f}"), "/mo"
    else:
        fmt, unit = (lambda v: f"{v / 1000:,.0f}k"), "/yr"
    span = fmt(pay["min"]) if pay["min"] == pay["max"] else f"{fmt(pay['min'])}–{fmt(pay['max'])}"
    out = sym + span + unit
    if cur != "CAD":
        lo, hi = to_cad_annual(pay, rates)
        if hi:
            approx = f"C${lo / 1000:,.0f}k" if lo == hi else f"C${lo / 1000:,.0f}k–{hi / 1000:,.0f}k"
            out += f" (≈ {approx}/yr)"
    return out
