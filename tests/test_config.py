import tomllib

from jobboard.config import ROOT, load_config, load_profile


def test_config_loads():
    cfg = load_config()
    assert cfg["run"]["pay_floor_cad"] > 0 and cfg["titles"]["include"]


def test_example_profile_shape(monkeypatch):
    # Top-level keys must sit above any [table], or TOML files them under that table.
    monkeypatch.delenv("PROFILE_TOML", raising=False)
    prof = load_profile(ROOT / "profile.example.toml")
    assert isinstance(prof["skills"], list) and prof["skills"]
    assert "skills" not in prof["location"] and "evidence" not in prof["location"]
    assert set(prof["project_order"]) == {"Security", "Full-stack", "AI", "IT / Support"}


def test_profile_from_secret(monkeypatch):
    raw = (ROOT / "profile.example.toml").read_text()
    monkeypatch.setenv("PROFILE_TOML", raw)
    assert load_profile()["skills"] == tomllib.loads(raw)["skills"]
