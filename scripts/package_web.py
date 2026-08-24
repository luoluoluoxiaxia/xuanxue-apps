#!/usr/bin/env python3
"""Build a deterministic, static-only Web release archive."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import os
import tarfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "web" / "public"


def _source_date_epoch() -> int:
    raw = os.environ.get("SOURCE_DATE_EPOCH", "0").strip() or "0"
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError("SOURCE_DATE_EPOCH must be an integer") from exc
    if value < 0:
        raise ValueError("SOURCE_DATE_EPOCH must not be negative")
    return value


def build_web_archive(source: Path, output: Path, *, mtime: int | None = None) -> str:
    source = source.resolve()
    if not (source / "index.html").is_file():
        raise ValueError(f"Web source is incomplete: {source / 'index.html'}")

    paths = sorted(source.rglob("*"), key=lambda path: path.relative_to(source).as_posix())
    symlinks = [path for path in paths if path.is_symlink()]
    if symlinks:
        names = ", ".join(path.relative_to(source).as_posix() for path in symlinks)
        raise ValueError(f"Web release must not contain symlinks: {names}")

    output.parent.mkdir(parents=True, exist_ok=True)
    archive_mtime = _source_date_epoch() if mtime is None else mtime
    with output.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=archive_mtime) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
                for path in paths:
                    relative = path.relative_to(source).as_posix()
                    info = archive.gettarinfo(str(path), arcname=relative)
                    info.uid = 0
                    info.gid = 0
                    info.uname = ""
                    info.gname = ""
                    info.mtime = archive_mtime
                    info.mode = 0o755 if path.is_dir() else 0o644
                    if path.is_dir():
                        archive.addfile(info)
                    elif path.is_file():
                        with path.open("rb") as content:
                            archive.addfile(info, content)
                    else:
                        raise ValueError(f"Unsupported Web release entry: {path}")

    return hashlib.sha256(output.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    digest = build_web_archive(args.source, args.output)
    print(f"Web release created: {args.output}")
    print(f"sha256={digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
