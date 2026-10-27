"""One refresh: fetch every source, drop what doesn't fit, score what's new,
retire what has closed, and write the site's data files."""

from __future__ import annotations

import hashlib
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from . import salary, store
from .filters import decide
from .llm import LLM
from .model import Posting
from .scoring import projects_for, score
from .sources import Source, build_sources
from .text import any_phrase, days_old, slug

# Sources that list every open job for one company. If a posting disappears
# from one of these, the company took it down.
COMPANY_BOARDS = ("greenhouse", "lever", "ashby")

CLOSED_PHRASES = [
    "no longer accepting applications", "no longer accepting", "position has been filled",
    "this job is no longer available", "job is no longer available", "this job has expired",
    "posting has closed", "position closed", "job not found", "this position is closed",
    "sorry, this job was removed", "the job you are looking for is no longer open",
]


@dataclass
class Report:
    added: list[str] = field(default_factory=list)
    closed: list[str] = field(default_factory=list)
    kept: int = 0
    skipped: Counter = field(default_factory=Counter)
    sources: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def today_in(tz_name: str) -> str:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo(tz_name)).date().isoformat()
    except Exception:
        return datetime.now(timezone.utc).date().isoformat()


def same_job_key(company: str, title: str) -> str:
    return slug(company) + "|" + slug(title)


def job_id(p: Posting) -> str:
    digest = hashlib.sha1(p.uid.encode()).hexdigest()[:8]
    return f"{slug(p.company)[:30]}-{slug(p.title)[:40]}-{digest}".strip("-")


def mode_of(p: Posting) -> str:
    if p.remote:
        return "Remote"
    if "hybrid" in p.text:
        return "Hybrid"
    return "On-site"


def to_job(p: Posting, source_key: str, d, fields: dict, cfg: dict, profile: dict, today: str) -> dict:
    rates = cfg.get("currency_to_cad", {"CAD": 1})
    show = cfg.get("site", {}).get("show_evidence", True)
    req = fields["req"] if show else [{**r, "e": ""} for r in fields["req"]]
    return {
        "id": job_id(p),
        "uid": p.uid,
        "sourceKey": source_key,
        "company": p.company,
        "title": p.title,
        "location": p.location,
        "mode": mode_of(p),
        "region": d.region,
        "salary": salary.display(d.pay, rates),
        "salaryMax": int(d.pay_cad_max or 0),
        "posted": p.posted,
        "firstSeen": today,
        "checked": today,
        "verify": p.verify,
        "sourceName": p.source_label,
        "applyUrl": p.url,
        "tracks": fields["tracks"],
        "tech": fields["tech"],
        "overall": fields["overall"],
        "rec": fields["rec"],
        "why": fields["why"],
        "req": req,
        "blockers": fields["blockers"] if show else "",
        "projects": projects_for(fields["tracks"], profile),
        "scoredBy": fields["scoredBy"],
        "active": True,
    }


def _bucket(reason: str) -> str:
    """Group skip reasons for the summary: "Title excluded (senior)" -> "Title excluded"."""
    return reason.split(" (")[0]


def _fetch_all(sources: list[Source], report: Report) -> dict[str, list[Posting] | None]:
    out: dict[str, list[Posting] | None] = {}
    for s in sources:
        try:
            got = s.fetch()
            out[s.key] = got
            report.sources.append({"key": s.key, "label": s.label, "ok": True, "count": len(got)})
        except Exception as e:  # one broken source shouldn't stop the run
            out[s.key] = None
            msg = str(e).split("\n")[0][:200]
            report.sources.append({"key": s.key, "label": s.label, "ok": False, "count": 0, "error": msg})
    return out


def _still_open(http, job: dict, fetched: dict, today: str, cfg: dict, budget: list[int]) -> tuple[bool, str]:
    """Decide whether an existing posting that wasn't in today's results is still up."""
    run = cfg.get("run", {})
    key = job.get("sourceKey", "")
    kind = key.split(":")[0]
    if kind in COMPANY_BOARDS:
        if fetched.get(key) is not None:
            return False, "No longer on the company's job board"
        return True, ""   # board didn't load today; check again tomorrow
    age = days_old(job.get("firstSeen", ""), today)
    if age is not None and age > int(run.get("max_listing_days", 45)):
        return False, f"Listed over {run.get('max_listing_days', 45)} days ago"
    if budget[0] <= 0 or not job.get("applyUrl"):
        return True, ""
    budget[0] -= 1
    status, page = http.peek(job["applyUrl"])
    if status in (404, 410):
        return False, f"Apply link returns {status}"
    if status == 200 and any_phrase(CLOSED_PHRASES, page):
        return False, "Posting says it's closed"
    return True, ""


def run(http, cfg: dict, profile: dict, llm: LLM | None = None, *, dry_run: bool = False,
        only: list[str] | None = None, data_dir: Path = store.DATA_DIR,
        sources: list[Source] | None = None, today: str | None = None) -> Report:
    runcfg = cfg.get("run", {})
    today = today or today_in(runcfg.get("timezone", "UTC"))
    report = Report()

    jobs, meta = store.load(data_dir)
    by_uid = {j["uid"]: j for j in jobs if j.get("uid")}
    known_keys = {same_job_key(j["company"], j["title"]) for j in jobs}

    srcs = sources if sources is not None else build_sources(http, cfg)
    if only:
        srcs = [s for s in srcs if s.key in only or s.key.split(":")[0] in only]
    fetched = _fetch_all(srcs, report)

    # 1. Walk today's postings: refresh what we already have, collect new candidates.
    seen: set[str] = set()
    candidates: dict[str, tuple] = {}
    for key, postings in fetched.items():
        for p in postings or []:
            seen.add(p.uid)
            if p.uid in by_uid:
                by_uid[p.uid]["checked"] = today
                continue
            dkey = same_job_key(p.company, p.title)
            if dkey in known_keys:
                report.skipped["Already on the board (another source)"] += 1
                continue
            d = decide(p, cfg, profile, today)
            if not d.keep:
                report.skipped[_bucket(d.reason)] += 1
                continue
            prev = candidates.get(dkey)
            # Same job on two sources: keep the company's own board.
            if prev is None or (p.verify == "employer" and prev[0].verify != "employer"):
                candidates[dkey] = (p, key, d)

    # 2. Retire postings that have closed.
    budget = [int(runcfg.get("liveness_checks", 40))]
    kept: list[dict] = []
    removed_now: list[str] = []
    for j in jobs:
        if j.get("uid") in seen:
            kept.append(j)
            continue
        ok, why = _still_open(http, j, fetched, today, cfg, budget)
        if ok:
            kept.append(j)
        else:
            line = f"{j['company']} — {j['title']} ({why}, {today})"
            removed_now.append(line)
            report.closed.append(line)

    # 3. Score the best new candidates (highest pay first, then newest).
    ordered = sorted(candidates.values(), key=lambda c: (c[2].pay_cad_max or 0, c[0].posted or ""), reverse=True)
    cap = int(runcfg.get("max_new_per_run", 40))
    if len(ordered) > cap:
        report.warnings.append(f"{len(ordered) - cap} more new postings matched; raise max_new_per_run to score them.")
    rates = cfg.get("currency_to_cad", {"CAD": 1})
    for p, key, d in ordered[:cap]:
        fields, err = score(llm, p, d, profile, salary.display(d.pay, rates))
        if err:
            report.warnings.append(err)
        kept.append(to_job(p, key, d, fields, cfg, profile, today))
        report.added.append(f"{p.company} — {p.title}")

    report.kept = len(kept)
    kept.sort(key=lambda j: (j.get("overall", 0), j.get("salaryMax", 0)), reverse=True)

    removed = (removed_now + list(meta.get("removed", [])))[: int(runcfg.get("keep_removed", 30))]
    new_meta = {
        "site": {k: v for k, v in cfg.get("site", {}).items() if k in ("title", "subtitle")},
        "lastRun": today,
        "lastRunAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "scoredBy": llm.describe() if llm else "keyword scoring (no AI)",
        "payFloorCad": runcfg.get("pay_floor_cad", 0),
        "payGoalCad": runcfg.get("pay_goal_cad", 100000),
        "added": len(report.added),
        "closed": len(report.closed),
        "sources": report.sources,
        "skipped": dict(report.skipped.most_common()),
        "removed": removed,
        "warnings": report.warnings[:20],
    }
    if not dry_run:
        store.save(kept, new_meta, data_dir)
    return report


def check_sources(http, cfg: dict) -> list[dict]:
    report = Report()
    _fetch_all(build_sources(http, cfg), report)
    return report.sources
