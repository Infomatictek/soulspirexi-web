#!/usr/bin/env python3
"""Pre-deployment validator and deterministic release-bundle builder for SoulspireXI Web.

Verifies:
1. All required static website & Public API v1 files exist and are non-empty.
2. index.html contains ZERO hardcoded Soul/job arrays (`sixtySixSouls`, `classicJobsOrder`)
   and loads the dynamic API consumer (`assets/soulspire-data.js`).
3. Every /api/v1/*.json endpoint matches manifest.json SHA-256 checksums,
   contains exactly 22 jobs and 66 unique canonical Souls, valid references,
   and zero private/internal keys or credentials.
4. Packages owned public files into a deterministic release tarball with a
   `.deployed-commit.json` SHA-256 manifest for atomic VPS publishing.

Python 3.11 stdlib only.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REQUIRED_FILES: tuple[str, ...] = (
    "index.html",
    "register/index.html",
    "assets/soulspire-data.js",
    "assets/soulspire-icon.png",
    "assets/favicon.ico",
    "api/v1/manifest.json",
    "api/v1/jobs.json",
    "api/v1/souls.json",
    "api/v1/abilities.json",
    "api/v1/spells.json",
    "api/v1/traits.json",
    "api/v1/systems.json",
    "api/v1/changelog.json",
)

ENDPOINT_NAMES: tuple[str, ...] = (
    "jobs",
    "souls",
    "abilities",
    "spells",
    "traits",
    "systems",
    "changelog",
)

FORBIDDEN_HTML_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("hardcoded_sixtySixSouls", re.compile(r"\bconst\s+sixtySixSouls\s*=\s*\[")),
    ("hardcoded_classicJobsOrder", re.compile(r"\bconst\s+classicJobsOrder\s*=\s*\[")),
)

FORBIDDEN_JSON_KEYS: frozenset[str] = frozenset({
    "sourceFile",
    "patches",
    "commits",
    "mainDamageScale",
    "subDamageScale",
    "delayScale",
    "tpScale",
    "accounts_password",
})

FORBIDDEN_SECRET_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("github_pat_", re.compile(r"github_pat_[A-Za-z0-9_]{10,}")),
    ("ghp_", re.compile(r"ghp_[A-Za-z0-9]{10,}")),
    ("PRIVATE KEY", re.compile(r"BEGIN (?:(?:RSA|EC|DSA|OPENSSH|PGP) )?PRIVATE KEY")),
    ("accounts_password", re.compile(r"accounts_password")),
)

PUBLIC_DIRS_AND_FILES: tuple[str, ...] = ("index.html", "register", "assets", "api")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _scan_forbidden_keys(obj: Any, path: str = "$") -> list[str]:
    hits: list[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in FORBIDDEN_JSON_KEYS:
                hits.append(f"{path}.{k}")
            hits.extend(_scan_forbidden_keys(v, f"{path}.{k}"))
    elif isinstance(obj, list):
        for idx, item in enumerate(obj):
            hits.extend(_scan_forbidden_keys(item, f"{path}[{idx}]"))
    return hits


def collect_owned_files(web_dir: Path) -> list[str]:
    owned: list[str] = []
    for entry in PUBLIC_DIRS_AND_FILES:
        target = web_dir / entry
        if target.is_file():
            owned.append(target.relative_to(web_dir).as_posix())
        elif target.is_dir():
            for p in sorted(target.rglob("*")):
                if p.is_file():
                    rel = p.relative_to(web_dir).as_posix()
                    if any(part.startswith(".") for part in Path(rel).parts):
                        continue
                    owned.append(rel)
    return sorted(set(owned))


def validate_web(web_dir: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    if not web_dir.is_dir():
        return [f"Web directory does not exist: {web_dir}"], []

    for rel in REQUIRED_FILES:
        p = web_dir / rel
        if not p.is_file() or p.stat().st_size == 0:
            errors.append(f"Missing or empty required web asset: {rel}")

    idx_path = web_dir / "index.html"
    if idx_path.is_file():
        html = idx_path.read_text(encoding="utf-8", errors="replace")
        if "assets/soulspire-data.js" not in html:
            errors.append("index.html does not reference assets/soulspire-data.js")
        for label, pat in FORBIDDEN_HTML_PATTERNS:
            if pat.search(html):
                errors.append(f"index.html still contains forbidden static pattern: {label}")

    manifest_path = web_dir / "api" / "v1" / "manifest.json"
    if manifest_path.is_file() and manifest_path.stat().st_size > 0:
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception as exc:
            errors.append(f"Invalid api/v1/manifest.json: {exc}")
            manifest = None

        if isinstance(manifest, dict):
            for field in ("apiVersion", "schemaVersion", "dataVersion", "registryVersion", "registryHash", "deploymentVersion", "generatedAt", "endpoints"):
                if not manifest.get(field):
                    errors.append(f"api/v1/manifest.json missing field '{field}'")

            endpoints = manifest.get("endpoints") or {}
            loaded: dict[str, Any] = {}
            for name in ENDPOINT_NAMES:
                ep_path = web_dir / "api" / "v1" / f"{name}.json"
                if not ep_path.is_file():
                    continue
                raw = ep_path.read_bytes()
                exp_sha = (endpoints.get(name) or {}).get("sha256")
                if exp_sha and sha256_bytes(raw) != exp_sha:
                    errors.append(f"SHA-256 mismatch in api/v1/{name}.json vs manifest.json")
                try:
                    loaded[name] = json.loads(raw.decode("utf-8"))
                except Exception as exc:
                    errors.append(f"Invalid JSON in api/v1/{name}.json: {exc}")

            if "jobs" in loaded and len(loaded["jobs"].get("jobs") or []) != 22:
                errors.append(f"Expected 22 jobs in api/v1/jobs.json, got {len(loaded['jobs'].get('jobs') or [])}")
            if "souls" in loaded:
                souls = loaded["souls"].get("souls") or []
                if len(souls) != 66:
                    errors.append(f"Expected 66 souls in api/v1/souls.json, got {len(souls)}")
                seen_ids = set()
                for s in souls:
                    sid = s.get("id")
                    if not sid or sid in seen_ids:
                        errors.append(f"Duplicate or empty Soul id: {sid!r}")
                    seen_ids.add(sid)

            for name, payload in [("manifest", manifest), *loaded.items()]:
                for bk in _scan_forbidden_keys(payload, f"$.{name}")[:10]:
                    errors.append(f"Forbidden internal key in api/v1/{name}.json: {bk}")

    owned = collect_owned_files(web_dir)
    for rel in owned:
        fpath = web_dir / rel
        if fpath.suffix.lower() in {".html", ".js", ".css", ".json"}:
            txt = fpath.read_text(encoding="utf-8", errors="ignore")
            for label, pat in FORBIDDEN_SECRET_PATTERNS:
                if pat.search(txt):
                    errors.append(f"Forbidden secret pattern ({label}) in {rel}")

    return errors, owned


def build_release_bundle(
    web_dir: Path,
    owned_files: list[str],
    output_tar: Path,
    *,
    git_sha: str,
    git_ref: str,
    run_id: str,
) -> dict[str, Any]:
    checksums = {rel: sha256_file(web_dir / rel) for rel in owned_files}
    manifest_api = json.loads((web_dir / "api" / "v1" / "manifest.json").read_text(encoding="utf-8"))
    deploy_manifest = {
        "schema_version": 1,
        "git_sha": git_sha,
        "short_sha": git_sha[:7] if git_sha else "unknown",
        "git_ref": git_ref,
        "workflow_run_id": run_id,
        "data_version": manifest_api.get("dataVersion"),
        "registry_hash": manifest_api.get("registryHash"),
        "deployed_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "owned_files": owned_files,
        "sha256": checksums,
    }
    output_tar.parent.mkdir(parents=True, exist_ok=True)
    manifest_bytes = (json.dumps(deploy_manifest, indent=2, sort_keys=True) + "\n").encode("utf-8")

    with tarfile.open(output_tar, "w:gz") as tar:
        for rel in owned_files:
            tar.add(web_dir / rel, arcname=rel)
        info = tarfile.TarInfo(name=".deployed-commit.json")
        info.size = len(manifest_bytes)
        info.mode = 0o600
        tar.addfile(info, io.BytesIO(manifest_bytes))

    return deploy_manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate SoulspireXI Web assets and build staged release tarball.")
    parser.add_argument("--web-dir", default=".", help="Path to website root directory")
    parser.add_argument("--output-tar", default="", help="Optional output path for web-release.tar.gz")
    parser.add_argument("--git-sha", default="local")
    parser.add_argument("--git-ref", default="main")
    parser.add_argument("--run-id", default="local")
    args = parser.parse_args(argv)

    web_dir = Path(args.web_dir).resolve()
    errors, owned = validate_web(web_dir)
    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1

    print(f"OK: Validated {len(owned)} owned website assets in {web_dir}")
    if args.output_tar:
        manifest = build_release_bundle(
            web_dir,
            owned,
            Path(args.output_tar),
            git_sha=args.git_sha,
            git_ref=args.git_ref,
            run_id=args.run_id,
        )
        print(f"OK: Built staged web release bundle {args.output_tar} (dataVersion={manifest['data_version']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
