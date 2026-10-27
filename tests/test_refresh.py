import json

from jobboard import refresh
from jobboard.llm import LLM, parse_json
from jobboard.sources import Source

from .conftest import make


class FakeHttp:
    def __init__(self, pages=None):
        self.pages = pages or {}
        self.peeked = []

    def peek(self, url):
        self.peeked.append(url)
        return self.pages.get(url, (200, "<html>Apply now</html>"))


def src(key, postings):
    return Source(key, key, lambda: postings)


def failing(key):
    def boom():
        raise RuntimeError("404 Not Found")
    return Source(key, key, boom)


def test_end_to_end(tmp_path, cfg, profile):
    good = make()
    remote = make(uid="remotive:7", source="remotive", source_label="Remotive", verify="listing",
                  company="Beta", title="Full Stack Developer", location="Remote (Canada)", remote=True,
                  url="https://remotive.com/remote-jobs/7", description="React, TypeScript, PostgreSQL. $100k - $120k USD")
    senior = make(uid="greenhouse:acme:2", title="Senior Security Engineer")
    dup = make(uid="remotive:8", source="remotive", verify="listing", url="https://remotive.com/x")  # same job as `good`

    rep = refresh.run(FakeHttp(), cfg, profile, None, data_dir=tmp_path, today="2026-10-27",
                      sources=[src("greenhouse:acme", [good, senior]), src("remotive", [remote, dup])])
    assert len(rep.added) == 2 and rep.skipped["Title excluded"] == 1

    jobs = json.loads((tmp_path / "jobs.json").read_text())["jobs"]
    meta = json.loads((tmp_path / "meta.json").read_text())
    by = {j["company"]: j for j in jobs}
    assert by["Acme"]["verify"] == "employer"             # employer board beat the duplicate listing
    assert by["Acme"]["projects"] == ["Scanner"]
    assert by["Beta"]["region"] == "Canada" and by["Beta"]["salaryMax"] == 165600
    assert "US$100k" in by["Beta"]["salary"]
    assert meta["lastRun"] == "2026-10-27" and meta["added"] == 2
    for j in jobs:
        assert {"id", "tech", "overall", "rec", "req", "tracks", "applyUrl"} <= j.keys()

    # Next day: Acme took its posting down; Beta's link now 404s.
    http = FakeHttp({"https://remotive.com/remote-jobs/7": (404, "")})
    rep2 = refresh.run(http, cfg, profile, None, data_dir=tmp_path, today="2026-10-28",
                       sources=[src("greenhouse:acme", []), src("remotive", [])])
    assert len(rep2.closed) == 2
    assert json.loads((tmp_path / "jobs.json").read_text())["jobs"] == []
    removed = json.loads((tmp_path / "meta.json").read_text())["removed"]
    assert any("No longer on the company's job board" in r for r in removed)
    assert any("returns 404" in r for r in removed)


def test_failed_board_keeps_jobs(tmp_path, cfg, profile):
    refresh.run(FakeHttp(), cfg, profile, None, data_dir=tmp_path, today="2026-10-27",
                sources=[src("greenhouse:acme", [make()])])
    rep = refresh.run(FakeHttp(), cfg, profile, None, data_dir=tmp_path, today="2026-10-28",
                      sources=[failing("greenhouse:acme")])
    assert rep.closed == [] and rep.kept == 1
    assert rep.sources[0]["ok"] is False


def test_hide_evidence(tmp_path, cfg, profile):
    cfg["site"]["show_evidence"] = False
    refresh.run(FakeHttp(), cfg, profile, None, data_dir=tmp_path, today="2026-10-27",
                sources=[src("greenhouse:acme", [make()])])
    job = json.loads((tmp_path / "jobs.json").read_text())["jobs"][0]
    assert job["blockers"] == "" and all(r["e"] == "" for r in job["req"])


def test_dry_run_writes_nothing(tmp_path, cfg, profile):
    refresh.run(FakeHttp(), cfg, profile, None, data_dir=tmp_path, today="2026-10-27", dry_run=True,
                sources=[src("greenhouse:acme", [make()])])
    assert not (tmp_path / "jobs.json").exists()


class FakeLLM(LLM):
    def __init__(self, reply):
        self.provider, self.model, self.reply = "anthropic", "test-model", reply

    def complete(self, system, user, max_tokens=1200):
        assert "CANDIDATE" in user and "Monitor SIEM" in user
        return self.reply


def test_ai_scoring_and_fallback(tmp_path, cfg, profile):
    reply = ('```json\n{"tech": 7, "overall": 6, "rec": "Apply", "why": "Good fit.", '
             '"req": [{"r": "SIEM", "e": "Not on resume", "s": "Gap"}], "blockers": "", "tracks": ["Security"]}\n```')
    refresh.run(FakeHttp(), cfg, profile, FakeLLM(reply), data_dir=tmp_path, today="2026-10-27",
                sources=[src("greenhouse:acme", [make()])])
    job = json.loads((tmp_path / "jobs.json").read_text())["jobs"][0]
    assert job["tech"] == 7 and job["rec"] == "Apply" and job["scoredBy"] == "anthropic (test-model)"

    rep = refresh.run(FakeHttp(), cfg, profile, FakeLLM("no json here"), data_dir=tmp_path / "b",
                      today="2026-10-27", sources=[src("greenhouse:acme", [make()])])
    assert rep.warnings and "AI scoring failed" in rep.warnings[0]
    job = json.loads((tmp_path / "b" / "jobs.json").read_text())["jobs"][0]
    assert job["scoredBy"] == "keywords"


def test_parse_json_tolerates_prose():
    assert parse_json('Sure! {"a": 1} Hope that helps.') == {"a": 1}


def test_llm_config_errors():
    import pytest
    from jobboard.llm import LLMError
    with pytest.raises(LLMError):
        LLM(None, "anthropic", api_key="")
    with pytest.raises(LLMError):
        LLM(None, "openai", api_key="k")          # no model
    assert not LLM(None, "none").enabled
