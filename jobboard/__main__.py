"""Command line:

    python -m jobboard refresh            fetch, filter, score and write docs/data/
    python -m jobboard refresh --dry-run  same, but don't write anything
    python -m jobboard check-sources      test every source in config.toml
    python -m jobboard serve              preview the site at http://localhost:8000
"""

from __future__ import annotations

import argparse
import sys

from .config import ROOT, ConfigError, load_config, load_dotenv, load_profile
from .http import Http
from .llm import LLM, LLMError


def _http(cfg: dict) -> Http:
    run = cfg.get("run", {})
    return Http(run.get("user_agent", "job-board/1.0"), int(run.get("request_timeout", 20)))


def cmd_refresh(args) -> int:
    from .refresh import run
    cfg = load_config()
    profile = load_profile()
    http = _http(cfg)
    llm = LLM.from_env(http)
    print(f"Scoring with: {llm.describe()}")
    rep = run(http, cfg, profile, llm, dry_run=args.dry_run, only=args.only or None)

    print("\nSources")
    for s in rep.sources:
        state = f"{s['count']:>4} postings" if s["ok"] else f"FAILED  {s.get('error', '')}"
        print(f"  {s['label']:<40} {state}")
    print(f"\nAdded {len(rep.added)}:")
    for a in rep.added:
        print(f"  + {a}")
    print(f"Closed {len(rep.closed)}:")
    for c in rep.closed:
        print(f"  - {c}")
    if rep.skipped:
        print("Skipped:")
        for reason, n in rep.skipped.most_common():
            print(f"  {n:>4}  {reason}")
    for w in rep.warnings:
        print(f"Warning: {w}")
    print(f"\n{rep.kept} postings on the board." + ("  (dry run: nothing written)" if args.dry_run else ""))
    if rep.sources and not any(s["ok"] for s in rep.sources):
        print("Every source failed. Check your network connection.", file=sys.stderr)
        return 1
    return 0


def cmd_check(args) -> int:
    from .refresh import check_sources
    cfg = load_config()
    bad = 0
    for s in check_sources(_http(cfg), cfg):
        if s["ok"]:
            print(f"  OK    {s['label']:<40} {s['count']} postings")
        else:
            bad += 1
            print(f"  FAIL  {s['label']:<40} {s.get('error', '')}")
    if bad:
        print(f"\n{bad} source(s) failed. A 404 usually means the board name in config.toml is wrong.")
    return 1 if bad else 0


def cmd_serve(args) -> int:
    import functools
    import http.server
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT / "docs"))
    with http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler) as srv:
        print(f"Job board at http://localhost:{args.port}  (Ctrl+C to stop)")
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


def main(argv=None) -> int:
    load_dotenv()
    ap = argparse.ArgumentParser(prog="python -m jobboard", description="Personal job board.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("refresh", help="fetch, filter, score and write the site data")
    r.add_argument("--dry-run", action="store_true", help="don't write docs/data")
    r.add_argument("--only", nargs="*", help="limit to sources, e.g. greenhouse remotive ashby:jobber")
    r.set_defaults(fn=cmd_refresh)
    c = sub.add_parser("check-sources", help="test every source in config.toml")
    c.set_defaults(fn=cmd_check)
    s = sub.add_parser("serve", help="preview the site locally")
    s.add_argument("--port", type=int, default=8000)
    s.set_defaults(fn=cmd_serve)
    args = ap.parse_args(argv)
    try:
        return args.fn(args)
    except (ConfigError, LLMError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
