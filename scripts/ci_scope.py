#!/usr/bin/env python3
"""Classify public-client changes for scoped CI jobs."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import PurePosixPath


_DOC_ONLY_FILES = {
    ".github/CODEOWNERS",
    ".github/dependabot.yml",
    "AGENTS.md",
    "README.md",
    "SECURITY.md",
}
_WEB_ROOT_FILES = {"package.json", "package-lock.json"}
_WEB_SCRIPTS = {"scripts/build-web.mjs", "scripts/package_web.py"}
_BOUNDARY_SCRIPTS = {
    "scripts/check_public_boundary.py",
    "scripts/test_public_boundary.py",
}


def classify(paths: list[str], *, force_all: bool = False) -> tuple[bool, bool]:
    """Return ``(web, android)``; unknown product paths fail safe to both."""

    if force_all:
        return True, True

    web = False
    android = False
    for raw in paths:
        path = PurePosixPath(raw.strip()).as_posix()
        if not path or path == ".":
            continue
        if path.startswith("web/"):
            web = True
        elif path.startswith("android/"):
            android = True
        elif path.startswith("contracts/"):
            web = True
            android = True
        elif path in _WEB_ROOT_FILES or path in _WEB_SCRIPTS:
            web = True
        elif path in _BOUNDARY_SCRIPTS:
            # The always-on scope job runs the boundary checks themselves.
            continue
        elif path.startswith("docs/") or path in _DOC_ONLY_FILES:
            continue
        elif path == ".github/workflows/ci.yml" or path == "scripts/ci_scope.py" or path == "scripts/test_ci_scope.py":
            # CI routing changes must prove that both heavy paths still work.
            web = True
            android = True
        else:
            web = True
            android = True
    return web, android


def _changed_paths(*, null_delimited: bool) -> list[str]:
    data = sys.stdin.buffer.read()
    separator = b"\0" if null_delimited else b"\n"
    return [item.decode("utf-8", errors="surrogateescape") for item in data.split(separator) if item]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true", help="run both client builds")
    parser.add_argument("--null", action="store_true", help="read NUL-delimited paths")
    parser.add_argument(
        "--github-output",
        default=os.environ.get("GITHUB_OUTPUT", ""),
        help="GitHub Actions output file",
    )
    args = parser.parse_args()

    web, android = classify(
        [] if args.all else _changed_paths(null_delimited=args.null),
        force_all=args.all,
    )
    output = f"web={'true' if web else 'false'}\nandroid={'true' if android else 'false'}\n"
    if args.github_output:
        with open(args.github_output, "a", encoding="utf-8") as handle:
            handle.write(output)
    else:
        sys.stdout.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
