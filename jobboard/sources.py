"""Job sources. Each one is an official public API or feed.

Every source has two parts:
  * a pure `normalize_*` function that turns one raw item into a Posting
    (unit-tested with sample payloads), and
  * a fetcher that calls the API and returns a list of Postings.

Company boards are configured as "slug" or "slug|Display Name".
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Callable

from .model import Posting
from .text import strip_html, to_date


def _split(entry: str) -> tuple[str, str]:
    slug, _, name = entry.partition("|")
    slug = slug.strip()
    return slug, (name.strip() or _pretty(slug))


def _pretty(slug: str) -> str:
    base = re.split(r"[.\-_]", slug)[0]
    return base[:1].upper() + base[1:]


def _is_remote(*parts) -> bool:
    return any("remote" in (p or "").lower() for p in parts)


# ---------------------------------------------------------------- Greenhouse
# https://developers.greenhouse.io/job-board.html (public, no key)

def normalize_greenhouse(board: str, company: str, j: dict) -> Posting:
    loc = (j.get("location") or {}).get("name", "") or ""
    desc = strip_html(j.get("content", ""))
    return Posting(
        uid=f"greenhouse:{board}:{j.get('id')}",
        source="greenhouse",
        source_label=f"Greenhouse · {company}",
        verify="employer",
        company=j.get("company_name") or company,
        title=(j.get("title") or "").strip(),
        location=loc,
        url=j.get("absolute_url", ""),
        remote=_is_remote(loc),
        posted=to_date(j.get("first_published") or j.get("updated_at")),
        description=desc,
    )


def fetch_greenhouse(http, board: str, name: str | None) -> list[Posting]:
    base = f"https://boards-api.greenhouse.io/v1/boards/{board}"
    company = name
    if not company:
        try:
            company = http.json(base).get("name") or _pretty(board)
        except Exception:
            company = _pretty(board)
    data = http.json(base + "/jobs", content="true")
    return [normalize_greenhouse(board, company, j) for j in data.get("jobs", [])]


# --------------------------------------------------------------------- Lever
# https://github.com/lever/postings-api (public, no key)

_LEVER_INTERVAL = {"per-hour-wage": "hour", "per-month-salary": "month"}


def normalize_lever(slug: str, company: str, j: dict) -> Posting:
    cats = j.get("categories") or {}
    loc = cats.get("location") or ", ".join(cats.get("allLocations") or [])
    parts = [j.get("descriptionPlain") or strip_html(j.get("description", ""))]
    for lst in j.get("lists") or []:
        parts.append(f"{lst.get('text', '')}\n{strip_html(lst.get('content', ''))}")
    parts.append(j.get("additionalPlain") or "")
    sr = j.get("salaryRange") or {}
    pay = None
    if sr.get("max"):
        pay = {
            "min": float(sr.get("min") or sr["max"]),
            "max": float(sr["max"]),
            "currency": (sr.get("currency") or "USD").upper(),
            "interval": _LEVER_INTERVAL.get(sr.get("interval", ""), "year"),
        }
    workplace = j.get("workplaceType") or ""
    return Posting(
        uid=f"lever:{slug}:{j.get('id')}",
        source="lever",
        source_label=f"Lever · {company}",
        verify="employer",
        company=company,
        title=(j.get("text") or "").strip(),
        location=loc + (f" ({workplace})" if workplace else ""),
        url=j.get("hostedUrl") or j.get("applyUrl", ""),
        remote=workplace == "remote" or _is_remote(loc),
        posted=to_date(j.get("createdAt")),
        description="\n\n".join(p for p in parts if p),
        salary=pay,
    )


def fetch_lever(http, slug: str, company: str) -> list[Posting]:
    data = http.json(f"https://api.lever.co/v0/postings/{slug}", mode="json")
    return [normalize_lever(slug, company, j) for j in data]


# --------------------------------------------------------------------- Ashby
# https://developers.ashbyhq.com/docs/public-job-posting-api (public, no key)

def normalize_ashby(board: str, company: str, j: dict) -> Posting:
    url = j.get("jobUrl") or j.get("applyUrl") or ""
    native = j.get("id") or url.rstrip("/").split("/")[-1]
    locs = [j.get("location") or ""]
    for s in j.get("secondaryLocations") or []:
        locs.append(s.get("location", "") if isinstance(s, dict) else str(s))
    addr = ((j.get("address") or {}).get("postalAddress") or {})
    country = addr.get("addressCountry") or ""
    loc = ", ".join(x for x in locs if x)
    if country and country.lower() not in loc.lower():
        loc = f"{loc} ({country})" if loc else country
    comp = j.get("compensation") or {}
    salary_text = comp.get("scrapeableCompensationSalarySummary") or comp.get("compensationTierSummary") or ""
    return Posting(
        uid=f"ashby:{board}:{native}",
        source="ashby",
        source_label=f"Ashby · {company}",
        verify="employer",
        company=j.get("organizationName") or company,
        title=(j.get("title") or "").strip(),
        location=loc,
        url=url,
        remote=bool(j.get("isRemote")) or _is_remote(loc, j.get("workplaceType")),
        posted=to_date(j.get("publishedAt")),
        description=j.get("descriptionPlain") or strip_html(j.get("descriptionHtml", "")),
        salary_text=salary_text,
    )


def fetch_ashby(http, board: str, company: str) -> list[Posting]:
    data = http.json(
        f"https://api.ashbyhq.com/posting-api/job-board/{board}", includeCompensation="true"
    )
    return [normalize_ashby(board, company, j) for j in data.get("jobs", []) if j.get("isListed", True)]


# ------------------------------------------------------------------ Remotive
# https://remotive.com/api-documentation : free, link back to Remotive,
# and keep it to a few requests a day.

def normalize_remotive(j: dict) -> Posting:
    loc = j.get("candidate_required_location") or "Remote"
    return Posting(
        uid=f"remotive:{j.get('id')}",
        source="remotive",
        source_label="Remotive",
        verify="listing",
        company=(j.get("company_name") or "").strip(),
        title=(j.get("title") or "").strip(),
        location=f"Remote ({loc})",
        url=j.get("url", ""),
        remote=True,
        posted=to_date(j.get("publication_date")),
        description=strip_html(j.get("description", "")),
        salary_text=j.get("salary") or "",
    )


def fetch_remotive(http, searches: list[str]) -> list[Posting]:
    seen, out = set(), []
    for q in searches:
        for j in http.json("https://remotive.com/api/remote-jobs", search=q).get("jobs", []):
            if j.get("id") not in seen:
                seen.add(j.get("id"))
                out.append(normalize_remotive(j))
    return out


# ----------------------------------------------------------------- Remote OK
# https://remoteok.com/api : free, must link back to Remote OK.

def normalize_remoteok(j: dict) -> Posting:
    pay = None
    if j.get("salary_max"):
        pay = {"min": float(j.get("salary_min") or j["salary_max"]), "max": float(j["salary_max"]),
               "currency": "USD", "interval": "year"}
    loc = j.get("location") or "Anywhere"
    return Posting(
        uid=f"remoteok:{j.get('id')}",
        source="remoteok",
        source_label="Remote OK",
        verify="listing",
        company=(j.get("company") or "").strip(),
        title=(j.get("position") or "").strip(),
        location=f"Remote ({loc})",
        url=j.get("url") or j.get("apply_url", ""),
        remote=True,
        posted=to_date(j.get("epoch") or j.get("date")),
        description=strip_html(j.get("description", "")) + "\n" + " ".join(j.get("tags") or []),
        salary=pay,
    )


def fetch_remoteok(http) -> list[Posting]:
    data = http.json("https://remoteok.com/api")
    return [normalize_remoteok(j) for j in data if isinstance(j, dict) and j.get("position")]


# ----------------------------------------------------------------- Himalayas
# https://himalayas.app/api : free public jobs API.

def normalize_himalayas(j: dict) -> Posting:
    restrictions = j.get("locationRestrictions") or []
    names = [r.get("name", "") if isinstance(r, dict) else str(r) for r in restrictions]
    loc = ", ".join(n for n in names if n) or "Anywhere"
    pay = None
    if j.get("maxSalary"):
        pay = {"min": float(j.get("minSalary") or j["maxSalary"]), "max": float(j["maxSalary"]),
               "currency": (j.get("currency") or j.get("salaryCurrency") or "USD").upper(),
               "interval": "year"}
    native = j.get("guid") or j.get("applicationLink") or j.get("title")
    return Posting(
        uid=f"himalayas:{native}",
        source="himalayas",
        source_label="Himalayas",
        verify="listing",
        company=(j.get("companyName") or "").strip(),
        title=(j.get("title") or "").strip(),
        location=f"Remote ({loc})",
        url=j.get("applicationLink") or j.get("guid") or "",
        remote=True,
        posted=to_date(j.get("pubDate")),
        description=strip_html(j.get("description") or j.get("excerpt") or ""),
        salary=pay,
    )


def fetch_himalayas(http, pages: int) -> list[Posting]:
    out = []
    for p in range(pages):
        data = http.json("https://himalayas.app/jobs/api", limit=20, offset=p * 20)
        out += [normalize_himalayas(j) for j in data.get("jobs", [])]
    return out


# ---------------------------------------------------------- We Work Remotely
# Public RSS feeds.

def normalize_wwr_item(item: ET.Element) -> Posting:
    raw_title = (item.findtext("title") or "").strip()
    company, _, title = raw_title.partition(":")
    if not title:
        company, title = "", raw_title
    link = (item.findtext("link") or "").strip()
    region = (item.findtext("region") or "Anywhere").strip()
    return Posting(
        uid=f"wwr:{(item.findtext('guid') or link).strip()}",
        source="weworkremotely",
        source_label="We Work Remotely",
        verify="listing",
        company=company.strip(),
        title=title.strip(),
        location=f"Remote ({region})",
        url=link,
        remote=True,
        posted=to_date(item.findtext("pubDate")),
        description=strip_html(item.findtext("description") or ""),
    )


def fetch_wwr(http, feeds: list[str]) -> list[Posting]:
    out = []
    for f in feeds:
        root = ET.fromstring(http.text(f).encode("utf-8"))
        out += [normalize_wwr_item(i) for i in root.iter("item")]
    return out


# ------------------------------------------------------- Hacker News (Algolia)
# The monthly "Ask HN: Who is hiring?" thread via the HN Algolia API.

_HREF = re.compile(r'href="([^"]+)"')


def normalize_hn_comment(c: dict, thread_date: str) -> Posting | None:
    raw = c.get("text") or ""
    if not raw:
        return None
    first = strip_html(raw.split("<p>")[0])
    parts = [p.strip() for p in first.split("|") if p.strip()]
    if len(parts) < 2:
        return None
    links = [h for h in _HREF.findall(raw) if h.startswith("http")]
    loc = ", ".join(p for p in parts[1:] if re.search(r"remote|onsite|on-site|hybrid|, [A-Z]{2}\b|canada|usa|uk|europe", p, re.I))
    return Posting(
        uid=f"hn:{c.get('id')}",
        source="hackernews",
        source_label="Hacker News · Who is hiring",
        verify="listing",
        company=parts[0][:80],
        title=" | ".join(parts[1:])[:160],
        location=loc or "See posting",
        url=links[0].replace("&#x2F;", "/") if links else f"https://news.ycombinator.com/item?id={c.get('id')}",
        remote=_is_remote(first),
        posted=to_date(c.get("created_at_i")) or thread_date,
        description=strip_html(raw),
        extra={"thread": f"https://news.ycombinator.com/item?id={c.get('id')}"},
    )


def fetch_hn(http) -> list[Posting]:
    hits = http.json(
        "https://hn.algolia.com/api/v1/search_by_date",
        tags="story,author_whoishiring", hitsPerPage=6,
    ).get("hits", [])
    thread = next((h for h in hits if "who is hiring" in (h.get("title") or "").lower()), None)
    if not thread:
        return []
    item = http.json(f"https://hn.algolia.com/api/v1/items/{thread['objectID']}")
    date = to_date(item.get("created_at_i"))
    out = []
    for c in item.get("children") or []:
        p = normalize_hn_comment(c, date)
        if p:
            out.append(p)
    return out


# ------------------------------------------------------------------ registry

@dataclass
class Source:
    key: str            # stable id used to detect closed postings, e.g. "greenhouse:gitlab"
    label: str
    fetch: Callable[[], list[Posting]]


def build_sources(http, cfg: dict) -> list[Source]:
    sc = cfg.get("sources", {})
    out: list[Source] = []
    for entry in sc.get("greenhouse", {}).get("boards", []):
        slug, name = _split(entry)
        explicit = name if "|" in entry else None
        out.append(Source(f"greenhouse:{slug}", f"Greenhouse · {name}",
                          lambda s=slug, n=explicit: fetch_greenhouse(http, s, n)))
    for entry in sc.get("lever", {}).get("companies", []):
        slug, name = _split(entry)
        out.append(Source(f"lever:{slug}", f"Lever · {name}", lambda s=slug, n=name: fetch_lever(http, s, n)))
    for entry in sc.get("ashby", {}).get("boards", []):
        slug, name = _split(entry)
        out.append(Source(f"ashby:{slug}", f"Ashby · {name}", lambda s=slug, n=name: fetch_ashby(http, s, n)))
    rm = sc.get("remotive", {})
    if rm.get("enabled"):
        out.append(Source("remotive", "Remotive", lambda: fetch_remotive(http, rm.get("searches", ["developer"]))))
    if sc.get("remoteok", {}).get("enabled"):
        out.append(Source("remoteok", "Remote OK", lambda: fetch_remoteok(http)))
    hm = sc.get("himalayas", {})
    if hm.get("enabled"):
        out.append(Source("himalayas", "Himalayas", lambda: fetch_himalayas(http, int(hm.get("pages", 2)))))
    feeds = sc.get("weworkremotely", {}).get("feeds", [])
    if feeds:
        out.append(Source("weworkremotely", "We Work Remotely", lambda: fetch_wwr(http, feeds)))
    if sc.get("hackernews", {}).get("enabled"):
        out.append(Source("hackernews", "Hacker News · Who is hiring", lambda: fetch_hn(http)))
    return out
