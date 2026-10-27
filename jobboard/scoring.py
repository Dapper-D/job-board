"""Score a posting against your profile: with an AI model if one is
configured, otherwise with a keyword match. Both produce the same fields."""

from __future__ import annotations

from .filters import Decision
from .llm import LLM, LLMError
from .model import Posting
from .text import any_phrase, phrase_in

# Tools and skills worth recognising in a job description.
VOCAB = [
    "python", "java", "javascript", "typescript", "golang", "rust", "c++", "c#", "ruby", "php",
    "sql", "bash", "powershell", "react", "next.js", "vue", "angular", "node.js", "django",
    "flask", "fastapi", "postgresql", "mysql", "mongodb", "redis", "aws", "azure", "gcp",
    "docker", "kubernetes", "terraform", "linux", "windows", "git", "rest api", "graphql",
    "ci/cd", "siem", "splunk", "sentinel", "edr", "soar", "nmap", "metasploit", "burp suite",
    "wireshark", "openvas", "nessus", "tcp/ip", "firewall", "ids/ips", "incident response",
    "vulnerability", "owasp", "mitre att&ck", "llm", "rag", "langchain", "pytorch",
    "tensorflow", "tailwind", "prisma", "vercel", "active directory", "microsoft 365", "entra",
    "troubleshooting", "compliance", "iso 27001", "soc 2",
]
ALIASES = {"postgres": "postgresql", "nodejs": "node.js", "node": "node.js", "nextjs": "next.js",
           "go": "golang", "rest": "rest api", "restful": "rest api", "ids": "ids/ips", "ips": "ids/ips"}

TRACK_WORDS = {
    "Security": ["security", "soc", "cyber", "threat", "vulnerability", "pentest", "penetration",
                 "incident", "detection", "infosec"],
    "AI": ["ai", "llm", "machine learning", "ml", "applied ai"],
    "IT / Support": ["it support", "support", "it analyst", "helpdesk", "help desk", "service desk"],
    "Full-stack": ["software", "developer", "full stack", "full-stack", "fullstack", "frontend",
                   "front-end", "backend", "back-end", "web", "engineer"],
}
TRACKS = list(TRACK_WORDS)


def tracks_for(title: str) -> list[str]:
    found = [t for t, words in TRACK_WORDS.items() if any_phrase(words, title)]
    if "Security" in found and "Full-stack" in found and not any_phrase(
            ["full stack", "full-stack", "fullstack", "frontend", "backend", "web"], title):
        found.remove("Full-stack")      # "Security Engineer" is a security role
    return found or ["Full-stack"]


def _has(profile_skills: list[str], term: str) -> str | None:
    for s in profile_skills:
        s2 = ALIASES.get(s.lower(), s.lower())
        if s2 == term or term in s2 or s2 in term:
            return s
    return None


def keyword_score(p: Posting, d: Decision, profile: dict) -> dict:
    skills = profile.get("skills", [])
    detected = [t for t in VOCAB if phrase_in(t, p.text)]
    matched = {t: _has(skills, t) for t in detected}
    hits = [t for t, s in matched.items() if s]
    k = 4  # smoothing so one or two keywords don't swing the score
    tech = round((len(hits) + 0.5 * k) / (len(detected) + k) * 10)
    overall = tech
    for n in d.notes:
        low = n.lower()
        if "years" in low:
            overall -= 2
        elif "relocation" in low or "confirm" in low or "visa" in low:
            overall -= 1
    if d.region not in ("Canada",):
        overall -= 1
    tech, overall = max(0, min(10, tech)), max(0, min(10, overall))
    rec = "Apply" if overall >= 6 else "Stretch" if overall >= 4 else "Skip"
    req = [{"r": t, "e": matched[t] or "Not on resume", "s": "Strong" if matched[t] else "Gap"}
           for t in detected[:8]]
    missing = [t for t in detected if not matched[t]]
    why = (f"Matches {len(hits)} of {len(detected)} tools named in the posting"
           + (f"; missing {', '.join(missing[:4])}." if missing else ".")) if detected \
        else "The posting names few specific tools; read it to judge fit."
    tr = tracks_for(p.title)
    return {"tech": tech, "overall": overall, "rec": rec, "why": why, "req": req,
            "blockers": " ".join(d.notes), "tracks": tr, "scoredBy": "keywords"}


SYSTEM = (
    "You assess how well one job posting fits one candidate. Use only the candidate "
    "evidence you are given; never assume skills, years, credentials or work authorization "
    "that aren't written there. Be direct and specific. Reply with only a JSON object."
)


def ai_score(llm: LLM, p: Posting, d: Decision, profile: dict, pay_text: str) -> dict:
    prompt = f"""JOB POSTING
Title: {p.title}
Company: {p.company}
Location: {p.location} (board region: {d.region})
Pay: {pay_text}
Description:
{p.description[:6000]}

CANDIDATE
Skills: {", ".join(profile.get("skills", []))}
Professional experience: about {profile.get("years_experience", 0)} year(s)
Evidence:
{profile.get("evidence", "").strip()}

NOTES FROM THE FILTER
{" ".join(d.notes) or "None"}

Reply with JSON exactly in this shape:
{{"tech": <0-10 technical match on languages, tools and projects>,
  "overall": <0-10 overall fit including experience level, eligibility, location and start date>,
  "rec": "Apply" | "Stretch" | "Skip",
  "why": "<one or two sentences>",
  "req": [{{"r": "<requirement from the posting>", "e": "<candidate evidence, or Not on resume>", "s": "Strong" | "Partial" | "Gap"}}],
  "blockers": "<eligibility, experience, location or start-date issues, or empty>",
  "tracks": [<any of "Security", "Full-stack", "AI", "IT / Support">]}}
List the 4 to 7 most important requirements in "req"."""
    v = llm.complete_json(SYSTEM, prompt)

    def num(x):
        try:
            return max(0, min(10, round(float(x))))
        except (TypeError, ValueError):
            raise LLMError("Score wasn't a number")

    rec = v.get("rec") if v.get("rec") in ("Apply", "Stretch", "Skip") else None
    req = []
    for r in v.get("req") or []:
        if isinstance(r, dict) and r.get("r"):
            s = r.get("s") if r.get("s") in ("Strong", "Partial", "Gap") else "Partial"
            req.append({"r": str(r["r"])[:160], "e": str(r.get("e") or "Not on resume")[:200], "s": s})
    tracks = [t for t in (v.get("tracks") or []) if t in TRACKS] or tracks_for(p.title)
    overall = num(v.get("overall"))
    blockers = " ".join(x for x in [str(v.get("blockers") or "").strip(), *d.notes] if x)
    return {
        "tech": num(v.get("tech")), "overall": overall,
        "rec": rec or ("Apply" if overall >= 6 else "Stretch" if overall >= 4 else "Skip"),
        "why": str(v.get("why") or "")[:400], "req": req[:8], "blockers": blockers[:600],
        "tracks": tracks, "scoredBy": llm.describe(),
    }


def score(llm: LLM | None, p: Posting, d: Decision, profile: dict, pay_text: str) -> tuple[dict, str]:
    """Returns (score fields, error message or "")."""
    if llm and llm.enabled:
        try:
            return ai_score(llm, p, d, profile, pay_text), ""
        except Exception as e:  # fall back rather than lose the posting
            return keyword_score(p, d, profile), f"AI scoring failed for {p.uid}: {e}"
    return keyword_score(p, d, profile), ""


def projects_for(tracks: list[str], profile: dict) -> list[str]:
    order = profile.get("project_order", {})
    for t in tracks:
        if order.get(t):
            return list(order[t])
    return []
