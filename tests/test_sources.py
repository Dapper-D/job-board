import xml.etree.ElementTree as ET

from jobboard import sources


def test_greenhouse():
    p = sources.normalize_greenhouse("acme", "Acme", {
        "id": 123, "title": " SOC Analyst ", "absolute_url": "https://job-boards.greenhouse.io/acme/jobs/123",
        "location": {"name": "Remote, Canada"}, "first_published": "2026-10-20T12:00:00-04:00",
        "content": "&lt;p&gt;Watch &amp;amp; respond&lt;/p&gt;",
    })
    assert p.uid == "greenhouse:acme:123" and p.title == "SOC Analyst"
    assert p.remote and p.posted == "2026-10-20" and p.verify == "employer"
    assert p.description == "Watch & respond"


def test_lever_salary_and_workplace():
    p = sources.normalize_lever("acme", "Acme", {
        "id": "abc", "text": "Junior Developer", "hostedUrl": "https://jobs.lever.co/acme/abc",
        "categories": {"location": "Vancouver, BC"}, "workplaceType": "hybrid", "createdAt": 1761523200000,
        "descriptionPlain": "Build things.", "lists": [{"text": "You have", "content": "<li>React</li>"}],
        "salaryRange": {"min": 80000, "max": 95000, "currency": "cad", "interval": "per-year-salary"},
    })
    assert p.salary == {"min": 80000.0, "max": 95000.0, "currency": "CAD", "interval": "year"}
    assert "React" in p.description and "(hybrid)" in p.location and not p.remote


def test_ashby_compensation_text():
    p = sources.normalize_ashby("acme", "Acme", {
        "id": "x1", "title": "Software Engineer", "jobUrl": "https://jobs.ashbyhq.com/acme/x1",
        "location": "Vancouver", "isRemote": False, "publishedAt": "2026-10-21T00:00:00Z",
        "descriptionPlain": "TypeScript.", "compensation": {"scrapeableCompensationSalarySummary": "CA$90K – CA$110K"},
        "address": {"postalAddress": {"addressCountry": "Canada"}},
    })
    assert p.salary_text == "CA$90K – CA$110K" and "Canada" in p.location


def test_remotive():
    p = sources.normalize_remotive({
        "id": 9, "url": "https://remotive.com/remote-jobs/x", "title": "Security Engineer",
        "company_name": "Beta", "candidate_required_location": "USA, Canada",
        "publication_date": "2026-10-22T10:00:00", "salary": "$100k - $130k", "description": "<b>Hi</b>",
    })
    assert p.remote and p.location == "Remote (USA, Canada)" and p.verify == "listing"


def test_remoteok_skips_legal_notice_row():
    rows = [{"legal": "notice"}, {"id": "1", "position": "Full Stack Engineer", "company": "Gamma",
                                  "url": "https://remoteok.com/remote-jobs/1", "epoch": 1761523200,
                                  "salary_min": 90000, "salary_max": 120000, "tags": ["react"]}]

    class FakeHttp:
        def json(self, url, **kw):
            return rows
    out = sources.fetch_remoteok(FakeHttp())
    assert len(out) == 1 and out[0].salary["max"] == 120000.0


def test_wwr_item():
    item = ET.fromstring(
        "<item><title>Delta Co: Backend Developer</title><link>https://weworkremotely.com/remote-jobs/d</link>"
        "<guid>https://weworkremotely.com/remote-jobs/d</guid><region>Anywhere in the World</region>"
        "<pubDate>Mon, 26 Oct 2026 10:00:00 +0000</pubDate><description>Node.js</description></item>")
    p = sources.normalize_wwr_item(item)
    assert p.company == "Delta Co" and p.title == "Backend Developer" and p.posted == "2026-10-26"


def test_hn_comment():
    p = sources.normalize_hn_comment({
        "id": 42, "created_at_i": 1761523200,
        "text": 'Epsilon | Junior Software Engineer | REMOTE (US or Canada) | Full-time<p>Apply: <a href="https://epsilon.dev/jobs">link</a>',
    }, "2026-10-01")
    assert p.company == "Epsilon" and p.remote and p.url == "https://epsilon.dev/jobs"
    assert sources.normalize_hn_comment({"id": 1, "text": "Just a comment"}, "") is None


def test_build_sources_from_config(cfg):
    keys = [s.key for s in sources.build_sources(object(), cfg)]
    assert "greenhouse:gitlab" in keys and "remotive" in keys and "hackernews" in keys
