import pytest

from jobboard.config import load_config
from jobboard.model import Posting

PROFILE = {
    "name": "Test Person",
    "home_country": "CA",
    "years_experience": 1,
    "availability": "Available from January 2027",
    "work_authorization": {
        "citizen_of_home_country": False,
        "permanent_resident": False,
        "authorized_in_home_country": True,
        "authorized_elsewhere": [],
        "needs_sponsorship_elsewhere": True,
        "can_hold_security_clearance": False,
    },
    "location": {
        "onsite_keywords": ["vancouver", "burnaby", "surrey", "british columbia", ", bc"],
        "home_country_keywords": ["canada", "toronto", "ontario", "british columbia"],
        "remote_ok_keywords": ["canada", "north america", "americas", "anywhere", "worldwide", "us or canada"],
        "open_to_relocation_with_sponsorship": True,
    },
    "skills": ["python", "typescript", "react", "next.js", "postgresql", "linux", "nmap", "bash"],
    "evidence": "Projects: a vulnerability scanner and a full-stack app.",
    "project_order": {"Security": ["Scanner"], "Full-stack": ["Web app"], "AI": ["Image app"], "IT / Support": ["Scanner"]},
}


@pytest.fixture
def cfg():
    return load_config()


@pytest.fixture
def profile():
    import copy
    return copy.deepcopy(PROFILE)


def make(**kw) -> Posting:
    base = dict(
        uid="greenhouse:acme:1", source="greenhouse", source_label="Greenhouse · Acme",
        verify="employer", company="Acme", title="Security Analyst", location="Vancouver, BC",
        url="https://job-boards.greenhouse.io/acme/jobs/1", posted="2026-10-25",
        description="Monitor SIEM alerts. Python and Linux. Nmap a plus.",
    )
    base.update(kw)
    return Posting(**base)
