from jobboard.filters import decide, title_ok, years_required

from .conftest import make

TODAY = "2026-10-27"


def test_titles(cfg):
    assert title_ok("SOC Analyst", cfg)[0]
    assert title_ok("Software Engineer, Early Career", cfg)[0]
    assert not title_ok("Senior Security Engineer", cfg)[0]
    assert not title_ok("Account Executive", cfg)[0]
    assert not title_ok("Junior Accountant", cfg)[0]
    assert not title_ok("Leading Edge Designer", cfg)[0]   # not a target role


def test_bc_onsite_is_canada(cfg, profile):
    d = decide(make(), cfg, profile, TODAY)
    assert d.keep and d.region == "Canada"


def test_toronto_onsite_notes_relocation(cfg, profile):
    d = decide(make(location="Toronto, ON"), cfg, profile, TODAY)
    assert d.keep and d.region == "Canada"
    assert any("relocation" in n for n in d.notes)


def test_remote_canada(cfg, profile):
    d = decide(make(location="Remote - Canada", remote=True), cfg, profile, TODAY)
    assert d.keep and d.region == "Canada"


def test_remote_americas_is_worldwide(cfg, profile):
    d = decide(make(location="Remote (Americas)", remote=True), cfg, profile, TODAY)
    assert d.keep and d.region == "Remote (worldwide)"
    assert any("employer of record" in n for n in d.notes)


def test_remote_us_only_is_dropped(cfg, profile):
    d = decide(make(location="Remote - US", remote=True), cfg, profile, TODAY)
    assert not d.keep


def test_remote_anywhere_but_us_authorization_required(cfg, profile):
    p = make(location="Remote (Anywhere)", remote=True,
             description="You must be authorized to work in the United States.")
    assert not decide(p, cfg, profile, TODAY).keep


def test_us_onsite_without_sponsorship_dropped(cfg, profile):
    assert not decide(make(location="San Francisco, CA"), cfg, profile, TODAY).keep


def test_us_onsite_with_sponsorship_kept(cfg, profile):
    p = make(location="Seattle, WA", description="Python, Linux. Visa sponsorship available for this role.")
    d = decide(p, cfg, profile, TODAY)
    assert d.keep and d.region == "USA"


def test_citizenship_and_clearance_dropped(cfg, profile):
    assert not decide(make(description="Must be a Canadian citizen."), cfg, profile, TODAY).keep
    assert not decide(make(description="Requires Secret clearance."), cfg, profile, TODAY).keep


def test_scam_phrases_dropped(cfg, profile):
    d = decide(make(description="Pay the training fee and message us on WhatsApp."), cfg, profile, TODAY)
    assert not d.keep and d.reason.startswith("Scam signal")


def test_no_company_or_http_link_dropped(cfg, profile):
    assert not decide(make(company=""), cfg, profile, TODAY).keep
    assert not decide(make(url="http://example.com/job"), cfg, profile, TODAY).keep


def test_old_posting_dropped(cfg, profile):
    assert not decide(make(posted="2026-08-01"), cfg, profile, TODAY).keep


def test_years(cfg, profile):
    assert years_required("Requires 3+ years of professional experience") == 3
    assert years_required("Founded 20 years ago.") == 0
    assert not decide(make(description="7+ years of experience in security"), cfg, profile, TODAY).keep
    d = decide(make(description="3+ years experience with SIEM"), cfg, profile, TODAY)
    assert d.keep and any("3+ years" in n for n in d.notes)


def test_pay_floor(cfg, profile):
    low = make(description="Salary: CA$50,000 - CA$60,000 per year")
    assert not decide(low, cfg, profile, TODAY).keep
    ok = make(description="Salary: CA$86,000 - CA$106,000 per year")
    d = decide(ok, cfg, profile, TODAY)
    assert d.keep and d.pay_cad_max == 106000


def test_unknown_pay_kept(cfg, profile):
    d = decide(make(description="Great team. Python."), cfg, profile, TODAY)
    assert d.keep and d.pay is None
