"""Read and write the published data: docs/data/jobs.json and meta.json."""

from __future__ import annotations

import json
from pathlib import Path

from .config import ROOT

DATA_DIR = ROOT / "docs" / "data"


def _read(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def _write(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)   # never leave a half-written file for the site to load


def load(data_dir: Path = DATA_DIR) -> tuple[list[dict], dict]:
    jobs = _read(data_dir / "jobs.json", {"jobs": []})
    meta = _read(data_dir / "meta.json", {})
    return list(jobs.get("jobs", [])), meta


def save(jobs: list[dict], meta: dict, data_dir: Path = DATA_DIR) -> None:
    _write(data_dir / "jobs.json", {"jobs": jobs})
    _write(data_dir / "meta.json", meta)
