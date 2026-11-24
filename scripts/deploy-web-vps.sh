#!/usr/bin/env bash
# Safe, staged, checksum-verified VPS deployment and rollback script for SoulspireXI Web (soulspirexi.com).
# Preserves last-known-good deployment in <webroot>/.releases/prev-<UTC>/ and rejects corrupt/unsafe bundles.
set -euo pipefail

MODE="deploy"
WEBROOT=""
BUNDLE=""
KEEP_RELEASES=5

usage() {
  echo "Usage:"
  echo "  $0 --webroot /srv/soulspirexi-web --bundle /tmp/web-release.tar.gz"
  echo "  $0 --rollback --webroot /srv/soulspirexi-web"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --webroot) WEBROOT="${2:-}"; shift 2 ;;
    --bundle) BUNDLE="${2:-}"; shift 2 ;;
    --rollback) MODE="rollback"; shift ;;
    --keep) KEEP_RELEASES="${2:-5}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

if [ -z "$WEBROOT" ]; then
  echo "ERROR: --webroot is required." >&2
  exit 2
fi
case "$WEBROOT" in
  /*) ;;
  *) echo "ERROR: Refusing non-absolute webroot: $WEBROOT" >&2; exit 2 ;;
esac
if [[ "$WEBROOT" == *"/.."* || "$WEBROOT" == *"../"* ]]; then
  echo "ERROR: Refusing unsafe traversal webroot: $WEBROOT" >&2
  exit 2
fi
while [ "$WEBROOT" != "/" ] && [[ "$WEBROOT" == */ ]]; do
  WEBROOT="${WEBROOT%/}"
done
case "$WEBROOT" in
  /|/etc|/etc/*|/var|/var/www|/srv|/home|/root|/tmp|/usr|/usr/*|/opt|/boot|/proc|/proc/*|/sys|/sys/*|/dev|/dev/*)
    echo "ERROR: Refusing unsafe webroot path: $WEBROOT" >&2
    exit 2
    ;;
esac
if [ ! -d "$WEBROOT" ] || [ ! -w "$WEBROOT" ]; then
  echo "ERROR: Webroot does not exist or is not writable: $WEBROOT" >&2
  exit 1
fi

RELEASES_DIR="$WEBROOT/.releases"

if [ "$MODE" = "rollback" ]; then
  if [ ! -d "$RELEASES_DIR" ]; then
    echo "ERROR: No .releases backup directory found in $WEBROOT" >&2
    exit 1
  fi
  LATEST_BACKUP="$(ls -1d "$RELEASES_DIR"/prev-* 2>/dev/null | sort | tail -n 1 || true)"
  if [ -z "$LATEST_BACKUP" ] || [ ! -d "$LATEST_BACKUP" ]; then
    echo "ERROR: No previous release snapshot found for rollback." >&2
    exit 1
  fi
  echo "Rolling back $WEBROOT from $LATEST_BACKUP ..."
  (cd "$LATEST_BACKUP" && find . -type f -print0 | while IFS= read -r -d '' rel; do
    rel="${rel#./}"
    mkdir -p "$WEBROOT/$(dirname "$rel")"
    cp -f "$LATEST_BACKUP/$rel" "$WEBROOT/$rel.tmp.$$"
    if [ "$rel" = ".deployed-commit.json" ]; then
      chmod 600 "$WEBROOT/$rel.tmp.$$"
    else
      chmod 644 "$WEBROOT/$rel.tmp.$$"
    fi
    mv -f "$WEBROOT/$rel.tmp.$$" "$WEBROOT/$rel"
  done)
  echo "OK: Rollback complete from $(basename "$LATEST_BACKUP")"
  exit 0
fi

if [ -z "$BUNDLE" ] || [ ! -f "$BUNDLE" ]; then
  echo "ERROR: --bundle tarball not found: $BUNDLE" >&2
  exit 1
fi

STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/soulspire-web-stage.XXXXXX")"
trap 'rm -rf "$STAGE_DIR"' EXIT

tar -xzf "$BUNDLE" -C "$STAGE_DIR" --no-same-owner --no-same-permissions

MANIFEST="$STAGE_DIR/.deployed-commit.json"
if [ ! -f "$MANIFEST" ] || [ -L "$MANIFEST" ]; then
  echo "ERROR: Staged bundle missing valid .deployed-commit.json manifest." >&2
  exit 1
fi

OWNED_LIST="$(python3 - "$STAGE_DIR" "$MANIFEST" <<'PY'
import hashlib, json, sys
from pathlib import Path

stage = Path(sys.argv[1]).resolve()
manifest = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
owned = manifest.get("owned_files") or []
hashes = manifest.get("sha256") or {}
if not owned:
    raise SystemExit("Manifest has empty owned_files list")
for rel in owned:
    parts = Path(rel).parts
    if ".." in parts or rel.startswith("/") or any(part.startswith(".") for part in parts):
        raise SystemExit(f"Unsafe path in manifest: {rel}")
    p = stage / rel
    if p.is_symlink() or not p.is_file():
        raise SystemExit(f"Missing staged file: {rel}")
    if stage not in p.resolve().parents:
        raise SystemExit(f"Path escapes stage dir: {rel}")
    if hashes.get(rel) != hashlib.sha256(p.read_bytes()).hexdigest():
        raise SystemExit(f"SHA-256 mismatch for {rel}")
    print(rel)
PY
)"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$RELEASES_DIR/prev-$TS"
mkdir -p "$RELEASES_DIR" "$BACKUP_DIR"
chmod 700 "$RELEASES_DIR" "$BACKUP_DIR"

while IFS= read -r rel; do
  [ -z "$rel" ] && continue
  if [ -f "$WEBROOT/$rel" ]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
    cp -p "$WEBROOT/$rel" "$BACKUP_DIR/$rel"
  fi
done <<< "$OWNED_LIST"
if [ -f "$WEBROOT/.deployed-commit.json" ]; then
  cp -p "$WEBROOT/.deployed-commit.json" "$BACKUP_DIR/.deployed-commit.json"
fi

# Publish non-manifest files first, then api/v1/manifest.json and index.html last so readers never observe half-published data
while IFS= read -r rel; do
  [ -z "$rel" ] && continue
  if [ "$rel" = "api/v1/manifest.json" ] || [ "$rel" = "index.html" ]; then
    continue
  fi
  dest_dir="$WEBROOT/$(dirname "$rel")"
  mkdir -p "$dest_dir"
  if [ "$dest_dir" != "$WEBROOT/." ]; then chmod 755 "$dest_dir"; fi
  cp -f "$STAGE_DIR/$rel" "$WEBROOT/$rel.tmp.$$"
  chmod 644 "$WEBROOT/$rel.tmp.$$"
  mv -f "$WEBROOT/$rel.tmp.$$" "$WEBROOT/$rel"
done <<< "$OWNED_LIST"

for final_rel in "api/v1/manifest.json" "index.html"; do
  if [ -f "$STAGE_DIR/$final_rel" ]; then
    mkdir -p "$WEBROOT/$(dirname "$final_rel")"
    cp -f "$STAGE_DIR/$final_rel" "$WEBROOT/$final_rel.tmp.$$"
    chmod 644 "$WEBROOT/$final_rel.tmp.$$"
    mv -f "$WEBROOT/$final_rel.tmp.$$" "$WEBROOT/$final_rel"
  fi
done

cp -f "$MANIFEST" "$WEBROOT/.deployed-commit.json.tmp.$$"
chmod 600 "$WEBROOT/.deployed-commit.json.tmp.$$"
mv -f "$WEBROOT/.deployed-commit.json.tmp.$$" "$WEBROOT/.deployed-commit.json"

# Prune older backups beyond KEEP_RELEASES
mapfile -t backups < <(ls -1d "$RELEASES_DIR"/prev-* 2>/dev/null | sort)
if [ "${#backups[@]}" -gt "$KEEP_RELEASES" ]; then
  drop=$(( ${#backups[@]} - KEEP_RELEASES ))
  for ((i=0; i<drop; i++)); do
    rm -rf -- "${backups[$i]}"
  done
fi

echo "OK: Published verified SoulspireXI Web bundle to $WEBROOT"
