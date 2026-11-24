# Soulspire XI — Official Website

Static public website for **Soulspire XI — A Reimagined Vana'diel**, live at [https://soulspirexi.com](https://soulspirexi.com).

## Registry-Driven Architecture (Zero Hardcoded Classes)

All 22 classic jobs, 66 canonical Souls, abilities, spells, traits, weapon configurations, system availability statuses, and player-visible updates are loaded dynamically from the versioned, read-only **Public Game Data API** (`/api/v1/*.json`), generated automatically from the authoritative centralized game registry in `Infomatictek/soulspirexi`.

### Structure

- `index.html` — Landing page shell preserving the Soulspire XI dark-fantasy visual identity (zero hardcoded Soul lists)
- `assets/soulspire-data.js` — Public Game Data API v1 consumer with search, calling/job views, Soul detail modal, stable permanent IDs (`#soul/<id>`), automatic legacy URL redirects, and `localStorage` last-known-good fallback
- `api/v1/` — Synchronized, checksum-verified read-only JSON snapshots:
  - `manifest.json`, `jobs.json`, `souls.json`, `abilities.json`, `spells.json`, `traits.json`, `systems.json`, `changelog.json`
- `register/index.html` — Invite-only Public Alpha account registration portal (`/register/`)
- `scripts/validate-web-assets.py` & `scripts/deploy-web-vps.sh` — Pre-deploy validator and atomic VPS publisher with `.releases/prev-*` rollback
- `.github/workflows/sync-and-deploy-web.yml` — Automated cross-repo sync, validation, VPS deployment, Cloudflare cache purge, and live version verification

## Local Preview & Tests

```bash
node --test tests/test_web_data_sync.mjs
python3 scripts/validate-web-assets.py --web-dir .
python3 -m http.server 8080
```

## Deployment

Production is served by Caddy from `/srv/soulspirexi-web` on `overlords-vps` behind Cloudflare (`soulspirexi.com` and `www.soulspirexi.com` → 301 to apex), automatically updated via `.github/workflows/sync-and-deploy-web.yml` when `web-production` environment secrets are configured.
