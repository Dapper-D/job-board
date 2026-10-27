"""Decide whether a posting belongs on the board, and where it fits."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from . import salary
from .model import Posting
from .text import any_phrase, days_old, phrase_in

# Phrases that mean the job needs something a non-citizen usually can't provide.
CITIZENSHIP_PHRASES = [
    "must be a canadian citizen", "canadian citizenship is required", "canadian citizenship required",
    "canadian citizens only", "canadian citizens and permanent residents only",
    "citizen or permanent resident of canada", "canadian citizen or permanent resident",
    "must be a u.s. citizen", "must be a us citizen", "u.s. citizenship is required",
    "us citizenship is required", "u.s. citizens only", "us citizens only",
]
CLEARANCE_PHRASES = [
    "secret clearance", "top secret", "ts/sci", "security clearance is required",
    "active security clearance", "must hold a security clearance", "ability to obtain a security clearance",
    "eligible for a security clearance", "enhanced reliability", "nv1", "dv clearance", "sc clearance",
]
FOREIGN_AUTH_PHRASES = [
    "authorized to work in the united states", "authorized to work in the us",
    "authorized to work in the u.s.", "eligible to work in the us", "eligible to work in the u.s.",
    "right to work in the uk", "eligible to work in the eu", "right to work in australia",
    "without sponsorship", "without visa sponsorship", "unable to sponsor", "not able to sponsor",
    "cannot sponsor", "do not sponsor", "does not sponsor", "will not sponsor", "no visa sponsorship",
    "must reside in the us", "must be located in the us", "must be based in the us",
    "us residents only", "u.s. residents only", "must live in the us",
]
SPONSOR_PHRASES = [
    "visa sponsorship available", "visa sponsorship is available", "we sponsor visas",
    "will sponsor", "can sponsor", "offer visa sponsorship", "h-1b sponsorship",
    "h1b sponsorship", "sponsorship available", "relocation and visa", "visa support",
]
US_HINTS = [
    "united states", "usa", "u.s.", " us)", "(us", "new york", "san francisco", "seattle",
    "austin", "boston", "chicago", "los angeles", "denver", "atlanta", "remote - us",
    ", ca", ", ny", ", wa", ", tx", ", ma", ", il", ", co", ", ga", ", va",
]
_YEARS = re.compile(r"(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs?)\b[^.]{0,60}?experience", re.I)
_DEFAULT_CURRENCY = {"Canada": "CAD", "USA": "USD"}


@dataclass
class Decision:
    keep: bool
    reason: str = ""
    region: str = ""
    notes: list[str] = field(default_factory=list)
    pay: dict | None = None
    pay_cad_max: float = 0


def title_ok(title: str, cfg: dict) -> tuple[bool, str]:
    t = cfg.get("titles", {})
    bad = any_phrase(t.get("exclude", []), title)
    if bad:
        return False, f"Title excluded ({bad})"
    if not any_phrase(t.get("include", []), title):
        return False, "Title not a target role"
    return True, ""


def scam_reason(p: Posting, cfg: dict) -> str:
    if not p.company.strip():
        return "No employer named"
    if not p.url.startswith("https://"):
        return "Apply link isn't https"
    hit = any_phrase(cfg.get("scam", {}).get("phrases", []), p.text)
    return f"Scam signal ({hit})" if hit else ""


def years_required(text: str) -> int:
    nums = [int(m.group(1)) for m in _YEARS.finditer(text)]
    return min(nums) if nums else 0


def region_of(p: Posting, profile: dict) -> tuple[str, str, list[str]]:
    """Returns (region, reject_reason, notes)."""
    loc = p.location.lower()
    text = p.text
    lp = profile.get("location", {})
    wa = profile.get("work_authorization", {})
    near = any_phrase(lp.get("onsite_keywords", []), loc)
    home = near or any_phrase(lp.get("home_country_keywords", []), loc)
    remote_ok = any_phrase(lp.get("remote_ok_keywords", []), loc)
    notes: list[str] = []

    if p.remote:
        if home and not remote_ok:
            return "Canada", "", notes
        if remote_ok:
            if any_phrase(FOREIGN_AUTH_PHRASES, text):
                return "", "Remote, but requires foreign work authorization", notes
            region = "Canada" if (home and phrase_in("canada", loc) and not any_phrase(
                ["anywhere", "worldwide", "global", "americas", "north america", "us or canada", "us/canada"], loc)) else "Remote (worldwide)"
            if region != "Canada":
                notes.append("Remote from Canada: confirm whether they hire you as an employee "
                             "(directly or via an employer of record) or as a contractor.")
            return region, "", notes
        # Remote, but the location doesn't say Canada or anywhere.
        if any_phrase(["canada", "anywhere in the world", "work from anywhere", "worldwide"], text) \
                and not any_phrase(FOREIGN_AUTH_PHRASES, text):
            notes.append("Location line doesn't name Canada; the description does. Confirm before applying.")
            return "Remote (worldwide)", "", notes
        return "", "Remote, but not stated as open to Canada", notes

    if near:
        return "Canada", "", notes
    if home:
        notes.append(f"On-site outside your area ({p.location}); would need relocation within Canada.")
        return "Canada", "", notes

    # On-site or hybrid outside your home country.
    country_ok = False
    us = any_phrase(US_HINTS, " " + loc + " ")
    for c in wa.get("authorized_elsewhere", []):
        if (c.upper() == "US" and us) or phrase_in(c, loc):
            country_ok = True
    region = "USA" if us else "International"
    if country_ok:
        return region, "", notes
    if not wa.get("needs_sponsorship_elsewhere", True):
        return region, "", notes
    if not lp.get("open_to_relocation_with_sponsorship", False):
        return "", "On-site abroad; not open to relocation", notes
    if any_phrase(FOREIGN_AUTH_PHRASES, text) or not any_phrase(SPONSOR_PHRASES, text):
        return "", "On-site abroad without stated visa sponsorship", notes
    notes.append("Requires a work visa: the posting says it sponsors. Confirm it covers this level.")
    return region, "", notes


def decide(p: Posting, cfg: dict, profile: dict, today: str, is_new: bool = True) -> Decision:
    ok, why = title_ok(p.title, cfg)
    if not ok:
        return Decision(False, why)
    scam = scam_reason(p, cfg)
    if scam:
        return Decision(False, scam)

    wa = profile.get("work_authorization", {})
    text = p.text
    if not wa.get("citizen_of_home_country") and not wa.get("permanent_resident"):
        hit = any_phrase(CITIZENSHIP_PHRASES, text)
        if hit:
            return Decision(False, f"Requires citizenship/PR ({hit})")
    if not wa.get("can_hold_security_clearance"):
        hit = any_phrase(CLEARANCE_PHRASES, text)
        if hit:
            return Decision(False, f"Requires security clearance ({hit})")

    region, reason, notes = region_of(p, profile)
    if reason:
        return Decision(False, reason)

    run = cfg.get("run", {})
    if is_new:
        age = days_old(p.posted, today)
        if age is not None and age > int(run.get("max_age_days", 21)):
            return Decision(False, f"Posted {age} days ago")

    yrs = years_required(p.description)
    if yrs >= 6:
        return Decision(False, f"Asks for {yrs}+ years")
    have = int(profile.get("years_experience", 0))
    if yrs and yrs > have + 1:
        notes.append(f"Asks for {yrs}+ years; you have about {have}.")

    rates = cfg.get("currency_to_cad", {"CAD": 1})
    pay = p.salary or salary.parse(p.salary_text + "\n" + p.description,
                                   _DEFAULT_CURRENCY.get(region, "USD"))
    cad_max = salary.to_cad_annual(pay, rates)[1] if pay else 0
    floor = float(run.get("pay_floor_cad", 0))
    if pay and cad_max and cad_max < floor:
        return Decision(False, f"Pay tops out at about C${cad_max:,.0f}/yr")

    if profile.get("availability"):
        notes.append(profile["availability"])
    return Decision(True, "", region, notes, pay, cad_max)
