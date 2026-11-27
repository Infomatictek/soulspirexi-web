# SoulspireXI Website (`Infomatictek/soulspirexi-web`) — AI Agent Guide

## Shared Governance & Authoritative Context

This repository follows the canonical SoulspireXI governance contract in **`Infomatictek/soulspirexi`** (`AGENTS.md`, `DEC-001`–`DEC-030`), including **`DEC-030`** (9-point GitHub synchronization and task completion contract):

- Context recovery: `docs/project/AI_CONTEXT_RECOVERY.md`
- System & deployment state: `docs/project/SYSTEM_REGISTRY.md`
- Active tasks & blockers: `docs/project/ACTIVE_TASKS.md`, `docs/project/BLOCKERS.md`
- Decisions (`DEC-001`–`DEC-030`): `docs/project/DECISIONS.md`

## Repository Role & Canonical Rules

- **Canonical Branch:** `main` (`https://soulspirexi.com` static frontend & `/register` page).
- **Public Data Boundary (`DEC-013`, `DEC-014`):** Consume Public Game Data API v1 (`/api/v1/*.json` via `assets/soulspire-data.js`) sourced from `Infomatictek/soulspirexi` `main`. Never hardcode Soul/job arrays in HTML or publish internal formulas, credentials, admin endpoints, or non-public repo files (`AGENTS.md`, `tests/`, `scripts/`).
- **Deployment Mechanism:** Publish only checksum-verified bundles built by `scripts/validate-web-assets.py` via `scripts/deploy-web-vps.sh` (or `.github/workflows/sync-and-deploy-web.yml`), never exposing non-public repo files in the public webroot.
- **Mandatory Local Checks Before Push:**
  - `node --check assets/soulspire-data.js`
  - `node --test tests/test_web_data_sync.mjs tests/test_register_page.mjs`
  - `python3 scripts/validate-web-assets.py --web-dir .`
