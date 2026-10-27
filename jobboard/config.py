"""Load settings (config.toml), your profile (profile.toml or the PROFILE_TOML
secret) and an optional .env file for local runs."""

from __future__ import annotations

import os
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class ConfigError(RuntimeError):
    pass


def load_dotenv(path: Path = ROOT / ".env") -> None:
    """Read KEY=value lines into the environment without overriding
    anything already set (so GitHub secrets always win)."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.split(" #", 1)[0].strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


def load_config(path: Path | None = None) -> dict:
    p = path or ROOT / "config.toml"
    if not p.exists():
        raise ConfigError(f"Missing {p}.")
    with p.open("rb") as f:
        return tomllib.load(f)


REQUIRED_PROFILE_KEYS = ("work_authorization", "location", "skills")


def load_profile(path: Path | None = None) -> dict:
    """Your profile comes from, in order: the PROFILE_TOML environment
    variable (a GitHub secret holding the whole file), PROFILE_PATH, or
    profile.toml next to config.toml."""
    raw = os.environ.get("PROFILE_TOML", "").strip()
    source = "the PROFILE_TOML secret"
    if not raw:
        p = path or Path(os.environ.get("PROFILE_PATH") or ROOT / "profile.toml")
        if not p.is_absolute():
            p = ROOT / p
        if not p.exists():
            raise ConfigError(
                f"No profile found. Copy profile.example.toml to profile.toml and fill it in "
                f"(or set the PROFILE_TOML secret). Looked for {p}."
            )
        raw = p.read_text(encoding="utf-8")
        source = str(p)
    try:
        prof = tomllib.loads(raw)
    except tomllib.TOMLDecodeError as e:
        raise ConfigError(f"Your profile in {source} isn't valid TOML: {e}") from e
    missing = [k for k in REQUIRED_PROFILE_KEYS if k not in prof]
    if missing:
        raise ConfigError(f"Your profile is missing: {', '.join(missing)}. See profile.example.toml.")
    return prof
