#!/usr/bin/env python3
"""Fail closed when a file or wire detail crosses the public-client boundary."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SELF = Path(__file__).resolve()
SKIP_DIRS = {".git", ".gradle", ".idea", ".kotlin", "build", "dist"}
FORBIDDEN_NAMES = {
    ".env",
    "local.properties",
    "google-services.json",
    "application.openapi.json",
}
FORBIDDEN_SUFFIXES = {".db", ".jks", ".keystore", ".p12", ".pem", ".key"}

# Every committed binary must be intentional and immutable. An unknown binary or a
# changed digest fails publication instead of being silently skipped.
ALLOWED_BINARIES = {
    "android/gradle/wrapper/gradle-wrapper.jar":
        "7a9ce74cff467ca1bf60a4fcd9f05185acceda4d0f382434d393e17864262c5d",
    "web/public/assets/qianlong_coin_back_transparent_512.png":
        "4c5dce9c3bfe897ff3b8121d72ae31aab4f2bb0174f90365ddb6df65abd50145",
    "web/public/assets/qianlong_coin_front_transparent_512.png":
        "d8667bf5121198379eed8f09d664a59738381d8f813d3e9fed193541d49be6d2",
}

SECRET_PATTERNS = {
    "private key": re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "AWS access key": re.compile(rb"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    "GitHub token": re.compile(
        rb"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"
    ),
    "OpenAI-style key": re.compile(rb"\bsk-[A-Za-z0-9_-]{20,}\b"),
    "WeCom webhook": re.compile(rb"qyapi\.weixin\.qq\.com/cgi-bin/webhook/send\?key="),
}

FORBIDDEN_CONTRACT_KEYS = {
    "provider",
    "model",
    "fast_model",
    "prompt_version",
    "prompt_versions",
    "reasoning_effort",
    "raw_reasoning",
    "usage",
    "cost",
    "completion_tokens",
    "usage_json",
    "_state",
    "blind",
}

IMPLEMENTATION_NAMES = ("deepseek", "openai", "gpt-", "anthropic", "claude")
PRIVATE_IDENTIFIERS = (
    "_account_payload",
    "_session_id_re",
    "client_chart_payload",
    "prompt_version",
    "raw_reasoning",
)
LOCAL_PATH_MARKERS = (
    b"/" + b"Users" + b"/",
    b"C:" + b"\\" + b"Users" + b"\\",
)


def repository_files(root: Path = ROOT) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*")
        if (path.is_file() or path.is_symlink())
        and not any(part in SKIP_DIRS for part in path.relative_to(root).parts)
    )


def collect_json(value: object, keys: set[str], strings: list[str]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            keys.add(str(key))
            collect_json(child, keys, strings)
    elif isinstance(value, list):
        for child in value:
            collect_json(child, keys, strings)
    elif isinstance(value, str):
        strings.append(value)


def first_party(relative: Path) -> bool:
    parts = relative.parts
    return "vendor" not in parts and "licenses" not in parts


def collect_byte_violations(relative: Path, payload: bytes, violations: list[str]) -> None:
    relative_text = relative.as_posix()
    for label, pattern in SECRET_PATTERNS.items():
        if pattern.search(payload):
            violations.append(f"{label}: {relative_text}")
    if any(marker in payload for marker in LOCAL_PATH_MARKERS):
        violations.append(f"local absolute path: {relative_text}")


def main() -> int:
    violations: list[str] = []
    files = repository_files()
    texts: dict[Path, str] = {}

    for path in files:
        relative = path.relative_to(ROOT)
        relative_text = relative.as_posix()
        if path.name in FORBIDDEN_NAMES or path.suffix.lower() in FORBIDDEN_SUFFIXES:
            violations.append(f"forbidden file: {relative_text}")
            continue
        if path.is_symlink():
            violations.append(f"symlink is not allowed: {relative_text}")
            continue

        try:
            payload = path.read_bytes()
        except OSError as exc:
            violations.append(f"unreadable file: {relative_text}: {exc}")
            continue

        collect_byte_violations(relative, payload, violations)

        if relative_text in ALLOWED_BINARIES:
            digest = hashlib.sha256(payload).hexdigest()
            if digest != ALLOWED_BINARIES[relative_text]:
                violations.append(f"unexpected binary digest: {relative_text}")
            continue

        try:
            content = payload.decode("utf-8")
        except UnicodeDecodeError:
            violations.append(f"unexpected binary or non-UTF-8 file: {relative_text}")
            continue
        if "\x00" in content:
            violations.append(f"unexpected binary content: {relative_text}")
            continue
        texts[relative] = content

        if path.resolve() == SELF or not first_party(relative):
            continue
        lowered = content.lower()
        for implementation in IMPLEMENTATION_NAMES:
            if implementation in lowered:
                violations.append(
                    f"implementation name {implementation!r}: {relative_text}"
                )
        for identifier in PRIVATE_IDENTIFIERS:
            if identifier in lowered:
                violations.append(f"private identifier {identifier!r}: {relative_text}")

    known_paths = {path.relative_to(ROOT).as_posix() for path in files}
    missing_binaries = sorted(set(ALLOWED_BINARIES) - known_paths)
    if missing_binaries:
        violations.append(f"allowed binary is missing: {', '.join(missing_binaries)}")

    contract_path = ROOT / "contracts" / "openapi" / "client.openapi.json"
    try:
        contract = json.loads(texts[contract_path.relative_to(ROOT)])
    except (KeyError, json.JSONDecodeError) as exc:
        violations.append(f"client contract cannot be parsed: {exc}")
        contract = {}

    contract_keys: set[str] = set()
    contract_strings: list[str] = []
    collect_json(contract, contract_keys, contract_strings)
    leaked_keys = sorted(contract_keys & FORBIDDEN_CONTRACT_KEYS)
    if leaked_keys:
        violations.append(f"forbidden client contract keys: {', '.join(leaked_keys)}")
    contract_text = "\n".join(contract_strings).lower()
    for implementation in IMPLEMENTATION_NAMES:
        if implementation in contract_text:
            violations.append(f"client contract exposes implementation name: {implementation}")

    paths = set(contract.get("paths", {})) if isinstance(contract, dict) else set()
    if "/api/llm/status" in paths or any(path.startswith("/api/external/") for path in paths):
        violations.append("private service route is present in client.openapi.json")

    android_wire = "\n".join(
        content
        for relative, content in texts.items()
        if relative.parts[:1] == ("android",) and relative.suffix == ".kt"
    )
    for forbidden in ("promptVersion", 'SerialName("prompt_version")'):
        if forbidden in android_wire:
            violations.append(f"Android wire model contains {forbidden}")
    if "AndroidKeyStore" not in android_wire or "AES/GCM/NoPadding" not in android_wire:
        violations.append("Android session storage is not protected by Android Keystore AES-GCM")

    login_source = texts.get(
        Path("android/app/src/main/java/tech/zsien/xuanshu/ui/auth/LoginScreen.kt"), ""
    )
    chart_source = texts.get(
        Path("android/app/src/main/java/tech/zsien/xuanshu/ui/chart/ChartScreen.kt"), ""
    )
    gua_source = texts.get(
        Path("android/app/src/main/java/tech/zsien/xuanshu/ui/liuyao/GuaScreen.kt"), ""
    )
    if re.search(r"password\s+by\s+rememberSaveable", login_source):
        violations.append("Android password is stored in saved state")
    if re.search(r"question\s+by\s+rememberSaveable", chart_source):
        violations.append("Android private question is stored in saved state")
    if "task.stage" in chart_source or "task.stage" in gua_source:
        violations.append("Android UI exposes raw backend task stage")

    if violations:
        raise SystemExit("public boundary check failed:\n- " + "\n- ".join(sorted(set(violations))))
    print(f"public boundary check complete: {len(files)} files verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
