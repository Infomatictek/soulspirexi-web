# Soulspire XI — Official Landing Page

Static landing page for **Soulspire XI — A Reimagined Vana'diel**, live at [https://soulspirexi.com](https://soulspirexi.com).

## Structure

- `index.html` — Single-page static site featuring:
  - Shattered Crag emblem hero with dual-aether ember particle canvas
  - Interactive Five Crags Resonance lore explorer
  - **The Sixty-Six Shards** interactive compendium covering all 66 souls across all 22 classic FFXI jobs, organized by the Three Great Callings (`Vanguard & Bastions`, `Unbound Strikers`, `Tacticians & Menders`), tag categories, and parent jobs
  - Veteran & Newcomer dual-perspective showcase and onboarding modal wired to [soulspirexi-launcher](https://github.com/Infomatictek/soulspirexi-launcher/releases)
- `assets/soulspire-icon.png` — 512×512 optimized PNG emblem (also used for OpenGraph / Discord & Twitter cards)
- `assets/favicon.ico` — Multi-size ICO (16–256px) for browser tab icons

## Local Preview

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Deployment

Production is served by Caddy from `/srv/soulspirexi-web` on `overlords-vps` behind Cloudflare (`soulspirexi.com` and `www.soulspirexi.com` → 301 to apex).
