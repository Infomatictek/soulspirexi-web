/**
 * SoulspireXI — Public Game Data API Consumer & Compendium Engine
 * ---------------------------------------------------------------
 * Dynamically loads all 22 classic jobs, 66 canonical Souls, abilities, spells,
 * traits, weapon configurations, game systems, and public changelog from the
 * versioned read-only JSON API (`/api/v1/manifest.json`).
 *
 * Zero hardcoded Soul definitions live in the website. Renaming a Soul in the
 * centralized registry automatically updates every card, filter, search result,
 * detail modal, and legacy URL redirect on next publish.
 */
(function (root) {
  'use strict';

  const LKG_STORAGE_KEY = 'soulspire_public_api_lkg_v1';
  const API_BASE = './api/v1';

  const CALLING_STYLES = {
    vanguard: {
      badgeClass: 'text-aether-gold bg-aether-gold/12 border-aether-gold/30',
      toneBorder: 'border-aether-gold/45 bg-aether-gold/10 shadow-[0_0_28px_-8px_rgba(245,194,107,0.35)]',
      chipClass: 'border-aether-gold/35 bg-aether-gold/10 text-aether-gold',
      cardHover: 'hover:border-aether-gold/45',
      accentDot: 'bg-aether-gold',
      eyebrowClass: 'text-aether-gold',
    },
    strikers: {
      badgeClass: 'text-aether-cyan bg-aether-cyan/12 border-aether-cyan/30',
      toneBorder: 'border-aether-cyan/50 bg-aether-cyan/10 shadow-[0_0_28px_-8px_rgba(56,232,255,0.35)]',
      chipClass: 'border-aether-cyan/35 bg-aether-cyan/10 text-aether-cyan',
      cardHover: 'hover:border-aether-cyan/45',
      accentDot: 'bg-aether-cyan',
      eyebrowClass: 'text-aether-cyan',
    },
    tacticians: {
      badgeClass: 'text-aether-violet bg-aether-violet/15 border-aether-violet/35',
      toneBorder: 'border-aether-violet/55 bg-aether-violet/12 shadow-[0_0_28px_-8px_rgba(157,123,255,0.38)]',
      chipClass: 'border-aether-violet/40 bg-aether-violet/15 text-purple-200',
      cardHover: 'hover:border-aether-violet/50',
      accentDot: 'bg-aether-violet',
      eyebrowClass: 'text-aether-violet',
    },
  };

  const ROLE_ICON_ACCENTS = {
    tank: { ring: 'border-aether-gold/45 bg-aether-gold/12 text-aether-gold', glyph: '◆' },
    dps: { ring: 'border-aether-cyan/45 bg-aether-cyan/12 text-aether-cyan', glyph: '✦' },
    healer: { ring: 'border-emerald-400/45 bg-emerald-400/12 text-emerald-300', glyph: '✚' },
    support: { ring: 'border-aether-violet/45 bg-aether-violet/15 text-purple-200', glyph: '❖' },
  };

  const state = {
    dataset: null,
    sourceMode: 'loading', // 'live' | 'cached' | 'error'
    activeCallingKey: 'vanguard',
    activeShardTag: 'All',
    shardViewMode: 'calling', // 'calling' | 'jobs'
    searchQuery: '',
    activeSoulId: null,
    redirectNotice: null,
    systemFilter: 'all', // 'all' | 'deployed' | 'upcoming'
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeSlug(value) {
    return String(value ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function formatUtcDate(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return String(isoStr);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }

  function validateDataset(ds) {
    if (!ds || typeof ds !== 'object') return false;
    if (!ds.manifest || !ds.manifest.dataVersion || !ds.manifest.registryHash) return false;
    if (!ds.jobs || !Array.isArray(ds.jobs.jobs) || ds.jobs.jobs.length !== 22) return false;
    if (!ds.souls || !Array.isArray(ds.souls.souls) || ds.souls.souls.length !== 66) return false;
    if (!ds.abilities || !Array.isArray(ds.abilities.abilities)) return false;
    if (!ds.spells || !Array.isArray(ds.spells.spells)) return false;
    if (!ds.traits || !Array.isArray(ds.traits.traits)) return false;
    if (!ds.systems || !Array.isArray(ds.systems.features)) return false;
    if (!ds.changelog || !Array.isArray(ds.changelog.entries)) return false;
    return true;
  }

  function buildIndexes(ds) {
    const soulsById = new Map();
    const jobsByKey = new Map();
    const abilitiesById = new Map();
    const spellsById = new Map();
    const traitsById = new Map();
    const callingsById = new Map();

    for (const j of ds.jobs.jobs) jobsByKey.set(j.jobKey, j);
    for (const c of ds.souls.callings || []) callingsById.set(c.id, c);
    for (const a of ds.abilities.abilities) abilitiesById.set(a.id, a);
    for (const sp of ds.spells.spells) spellsById.set(sp.id, sp);
    for (const tr of ds.traits.traits) traitsById.set(tr.id, tr);
    for (const s of ds.souls.souls) soulsById.set(s.id, s);

    return {
      ...ds,
      indexes: {
        soulsById,
        jobsByKey,
        abilitiesById,
        spellsById,
        traitsById,
        callingsById,
      },
    };
  }

  function readLastKnownGood(storage) {
    try {
      const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
      if (!store) return null;
      const raw = store.getItem(LKG_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return validateDataset(parsed) ? buildIndexes(parsed) : null;
    } catch (_) {
      return null;
    }
  }

  function saveLastKnownGood(ds, storage) {
    try {
      const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
      if (!store) return;
      const serializable = {
        manifest: ds.manifest,
        jobs: ds.jobs,
        souls: ds.souls,
        abilities: ds.abilities,
        spells: ds.spells,
        traits: ds.traits,
        systems: ds.systems,
        changelog: ds.changelog,
      };
      store.setItem(LKG_STORAGE_KEY, JSON.stringify(serializable));
    } catch (_) {
      // Ignore storage quota or private-mode errors gracefully
    }
  }

  async function fetchPublicDataset(fetchFn, apiBase) {
    const doFetch = fetchFn || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!doFetch) throw new Error('Fetch API unavailable');
    const base = (apiBase || API_BASE).replace(/\/$/, '');

    const manifestRes = await doFetch(`${base}/manifest.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!manifestRes.ok) {
      throw new Error(`Manifest request failed (HTTP ${manifestRes.status})`);
    }
    const manifest = await manifestRes.json();
    if (!manifest || !manifest.dataVersion || !manifest.endpoints) {
      throw new Error('Manifest payload missing required fields');
    }

    const verQuery = manifest.contentHash ? `?v=${encodeURIComponent(manifest.contentHash.slice(0, 8))}` : '';
    const endpointNames = ['jobs', 'souls', 'abilities', 'spells', 'traits', 'systems', 'changelog'];
    const responses = await Promise.all(
      endpointNames.map(async (name) => {
        const res = await doFetch(`${base}/${name}.json${verQuery}`, { cache: 'default' });
        if (!res.ok) throw new Error(`Endpoint ${name}.json failed (HTTP ${res.status})`);
        return [name, await res.json()];
      })
    );

    const ds = { manifest };
    for (const [name, payload] of responses) {
      ds[name] = payload;
    }

    if (!validateDataset(ds)) {
      throw new Error('Public API dataset failed schema/count validation');
    }
    return buildIndexes(ds);
  }

  function resolveSoulToken(ds, token) {
    if (!ds || !token) return null;
    const raw = String(token).trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    const norm = normalizeSlug(raw);

    // 1. Direct canonical permanent ID match (never redirects)
    if (ds.indexes.soulsById.has(lower)) {
      return { soul: ds.indexes.soulsById.get(lower), redirected: false, fromToken: raw };
    }

    // 2. Exact slugRedirects match (handles old pre-rename URLs like black-belt, astromancer, scarlet-weaver)
    const redirects = ds.souls.slugRedirects || {};
    const targetId = redirects[lower] || redirects[norm];
    if (targetId && ds.indexes.soulsById.has(targetId)) {
      const soul = ds.indexes.soulsById.get(targetId);
      const isCanonicalSlug = norm === soul.slug;
      return { soul, redirected: !isCanonicalSlug, fromToken: raw };
    }

    // 3. Fallback scan by canonical displayName, abbreviation, or legacySlugs
    for (const s of ds.souls.souls) {
      if (
        normalizeSlug(s.displayName) === norm ||
        String(s.abbreviation || '').toLowerCase() === lower ||
        (s.legacySlugs || []).includes(lower) ||
        (s.legacySlugs || []).includes(norm)
      ) {
        return {
          soul: s,
          redirected: normalizeSlug(s.displayName) !== norm && s.id !== lower,
          fromToken: raw,
        };
      }
    }

    return null;
  }

  function filterSouls(ds, { callingKey, tag, query, viewMode }) {
    if (!ds) return [];
    const q = String(query || '').trim().toLowerCase();
    const allSouls = ds.souls.souls;

    if (q) {
      return allSouls.filter((s) => {
        if (
          s.displayName.toLowerCase().includes(q) ||
          s.abbreviation.toLowerCase().includes(q) ||
          s.jobKey.toLowerCase().includes(q) ||
          s.jobName.toLowerCase().includes(q) ||
          s.roleLabel.toLowerCase().includes(q) ||
          s.callingTag.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          (s.legacySlugs || []).some((sl) => sl.toLowerCase().includes(q))
        ) {
          return true;
        }
        for (const aid of s.abilityIds || []) {
          const ab = ds.indexes.abilitiesById.get(aid);
          if (ab && ab.name.toLowerCase().includes(q)) return true;
        }
        for (const spid of s.spellIds || []) {
          const sp = ds.indexes.spellsById.get(spid);
          if (sp && sp.name.toLowerCase().includes(q)) return true;
        }
        for (const tid of s.traitIds || []) {
          const tr = ds.indexes.traitsById.get(tid);
          if (tr && tr.name.toLowerCase().includes(q)) return true;
        }
        return false;
      });
    }

    if (viewMode === 'jobs') return allSouls;

    const callingSouls = allSouls.filter((s) => s.calling === callingKey);
    if (!tag || tag === 'All') return callingSouls;
    return callingSouls.filter((s) => s.callingTag === tag);
  }

  function renderSoulCardHtml(soul) {
    const style = CALLING_STYLES[soul.calling] || CALLING_STYLES.vanguard;
    const roleAccent = ROLE_ICON_ACCENTS[soul.roleCategory] || ROLE_ICON_ACCENTS.dps;
    const abCount = (soul.abilityIds || []).length;
    const spCount = (soul.spellIds || []).length;
    const kitSummary = spCount > 0 ? `${abCount} Abilities · ${spCount} Spells` : `${abCount} Abilities`;

    return `
      <article
        role="button"
        tabindex="0"
        data-soul-id="${escapeHtml(soul.id)}"
        onclick="window.SoulspireDataUI.openSoulDetail('${escapeHtml(soul.id)}')"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.SoulspireDataUI.openSoulDetail('${escapeHtml(soul.id)}');}"
        class="group rounded-xl bg-abyss/80 border border-stoneIvory/12 ${style.cardHover} p-4 sm:p-5 transition-all flex flex-col justify-between cursor-pointer hover:-translate-y-0.5 focus:outline-none focus:border-aether-cyan/60"
      >
        <div>
          <div class="flex items-center justify-between gap-2 mb-3">
            <div class="flex items-center gap-2 min-w-0">
              <span class="w-6 h-6 rounded-md border ${roleAccent.ring} flex items-center justify-center text-[10px] shrink-0" title="${escapeHtml(soul.icon)}">
                ${roleAccent.glyph}
              </span>
              <span class="font-mono text-[10px] tracking-[0.14em] uppercase text-slateSilver/90 truncate">
                ${escapeHtml(soul.jobName)}
              </span>
              <span class="font-mono text-[10px] font-semibold tracking-[0.14em] px-1.5 py-0.5 rounded bg-midnight border border-stoneIvory/15 text-stoneIvory/90">
                ${escapeHtml(soul.abbreviation)}
              </span>
            </div>
            <span class="font-mono text-[10px] tracking-[0.1em] uppercase px-2.5 py-0.5 rounded-full border shrink-0 ${style.chipClass}">
              ${escapeHtml(soul.callingTag)}
            </span>
          </div>

          <h4 class="font-cinzel font-bold text-base tracking-[0.07em] text-stoneIvory group-hover:text-aether-gold transition-colors mb-1">
            ${escapeHtml(soul.displayName)}
          </h4>
          <div class="font-mono text-[10px] tracking-[0.12em] uppercase text-slateSilver/75 mb-2.5">
            ${escapeHtml(soul.roleLabel)} &bull; Lv. ${escapeHtml(soul.reqLevel)}
          </div>
          <p class="text-xs sm:text-[13px] text-slateSilver leading-relaxed">
            ${escapeHtml(soul.lore || soul.summary)}
          </p>
        </div>

        <div class="mt-4 pt-3 border-t border-stoneIvory/10 flex items-center justify-between gap-2 font-mono text-[10px] text-slateSilver/75">
          <span>${escapeHtml(kitSummary)}</span>
          <span class="text-aether-cyan group-hover:translate-x-0.5 transition-transform">Inspect &rarr;</span>
        </div>
      </article>
    `;
  }

  function updateCallingTabHeaders() {
    if (!state.dataset) return;
    for (const c of state.dataset.souls.callings || []) {
      const countEl = document.getElementById(`calling-count-${c.id}`);
      if (countEl) {
        countEl.textContent = `${c.eyebrow} • ${c.count} Shards`;
      }
    }
  }

  function renderVersionBadges() {
    if (!state.dataset) return;
    const m = state.dataset.manifest;
    const shortHash = String(m.registryHash || '').slice(0, 8);
    const updatedStr = formatUtcDate(m.generatedAt);
    const modeLabel = state.sourceMode === 'cached' ? ' • Cached LKG' : '';
    const text = `Registry ${m.registryVersion} (#${shortHash}) • Server ${m.deploymentVersion} • Updated ${updatedStr}${modeLabel}`;

    const footerEl = document.getElementById('data-version-footer');
    if (footerEl) {
      footerEl.textContent = text;
      footerEl.title = `API v${m.apiVersion} | Data ${m.dataVersion} | Commit ${m.sourceCommit}`;
    }

    const panelMetaEl = document.getElementById('shards-sync-meta');
    if (panelMetaEl) {
      panelMetaEl.textContent = `${m.counts.jobs} Jobs • ${m.counts.souls} Canonical Souls • Server ${m.deploymentVersion} • Updated ${updatedStr}`;
    }
  }

  function renderShardsPanel() {
    const panel = document.getElementById('calling-preview-panel');
    if (!panel) return;

    if (!state.dataset) {
      if (state.sourceMode === 'error') {
        panel.innerHTML = `
          <div class="text-center py-10">
            <p class="font-cinzel text-lg text-aether-gold mb-2">Unable to Reach Game Registry Snapshot</p>
            <p class="text-sm text-slateSilver mb-4">No cached dataset is available yet. Retry to load the latest canonical 66-Soul compendium.</p>
            <button type="button" onclick="window.SoulspireDataUI.reload()" class="btn-aether-glass px-5 py-2.5 rounded-md font-mono text-xs uppercase tracking-[0.14em] text-aether-cyan cursor-pointer">
              Retry Sync
            </button>
          </div>
        `;
      } else {
        panel.innerHTML = `
          <div class="text-center py-12 font-mono text-xs uppercase tracking-[0.2em] text-slateSilver">
            Attuning to Canonical 66-Soul Registry...
          </div>
        `;
      }
      return;
    }

    const ds = state.dataset;
    const callingMeta = ds.indexes.callingsById.get(state.activeCallingKey) || ds.souls.callings[0];
    const style = CALLING_STYLES[callingMeta.id] || CALLING_STYLES.vanguard;

    document.querySelectorAll('.calling-tab').forEach((btn) => {
      const key = btn.getAttribute('data-calling');
      const isCurrent = state.shardViewMode === 'calling' && !state.searchQuery.trim() && key === callingMeta.id;
      btn.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
      if (isCurrent) {
        btn.className = `calling-tab p-5 rounded-xl border text-left transition-all cursor-pointer ${style.toneBorder}`;
      } else {
        btn.className =
          'calling-tab p-5 rounded-xl border text-left transition-all cursor-pointer border-stoneIvory/12 bg-midnight/75 hover:border-stoneIvory/30';
      }
    });

    const searchBarHtml = `
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div class="relative flex-1 max-w-md">
          <input
            type="search"
            id="shards-search-input"
            value="${escapeHtml(state.searchQuery)}"
            placeholder="Search 66 Souls by name, abbr (e.g. STW), job, ability, or legacy name..."
            aria-label="Search the 66 Souls"
            class="w-full px-4 py-2.5 rounded-lg bg-abyss/90 border border-stoneIvory/18 text-xs sm:text-sm text-stoneIvory placeholder:text-slateSilver/60 focus:outline-none focus:border-aether-cyan/60"
          />
        </div>
        <div class="flex flex-wrap items-center gap-2 shrink-0">
          <button type="button" onclick="window.SoulspireDataUI.setShardViewMode('calling')"
            class="px-3.5 py-2 rounded-lg border font-mono text-[11px] tracking-[0.14em] uppercase transition-all cursor-pointer ${
              state.shardViewMode === 'calling' && !state.searchQuery.trim()
                ? style.chipClass
                : 'border-stoneIvory/15 bg-abyss/80 text-slateSilver hover:text-stoneIvory hover:border-stoneIvory/35'
            }">
            By Calling
          </button>
          <button type="button" onclick="window.SoulspireDataUI.setShardViewMode('jobs')"
            class="px-3.5 py-2 rounded-lg border font-mono text-[11px] tracking-[0.14em] uppercase transition-all cursor-pointer ${
              state.shardViewMode === 'jobs' && !state.searchQuery.trim()
                ? 'border-aether-gold/50 bg-aether-gold/12 text-aether-gold'
                : 'border-stoneIvory/15 bg-abyss/80 text-slateSilver hover:text-stoneIvory hover:border-aether-gold/45'
            }">
            All ${ds.jobs.jobs.length} Jobs (${ds.souls.souls.length})
          </button>
        </div>
      </div>
    `;

    const trimmedQuery = state.searchQuery.trim();
    if (trimmedQuery) {
      const matches = filterSouls(ds, {
        callingKey: callingMeta.id,
        tag: state.activeShardTag,
        query: trimmedQuery,
        viewMode: state.shardViewMode,
      });

      panel.innerHTML = `
        <div class="fade-swap">
          ${searchBarHtml}
          <div class="flex items-center justify-between gap-3 pb-4 mb-5 border-b border-stoneIvory/10">
            <span class="font-mono text-[11px] uppercase tracking-[0.18em] text-aether-cyan">
              Search Results &bull; ${matches.length} Matching Shard${matches.length === 1 ? '' : 's'}
            </span>
            <button type="button" onclick="window.SoulspireDataUI.setSearchQuery('')"
              class="font-mono text-[10px] uppercase tracking-[0.14em] text-slateSilver hover:text-stoneIvory cursor-pointer">
              Clear Search &times;
            </button>
          </div>
          ${
            matches.length
              ? `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-6">${matches.map(renderSoulCardHtml).join('')}</div>`
              : `<div class="py-10 text-center text-sm text-slateSilver">No Souls matched "<strong class="text-stoneIvory">${escapeHtml(trimmedQuery)}</strong>". Try a job code (WAR, BLM), abbreviation (STW, GOE), or ability name.</div>`
          }
        </div>
      `;
      bindSearchInput();
      return;
    }

    if (state.shardViewMode === 'jobs') {
      const jobsHtml = ds.jobs.jobs
        .map((job) => {
          const branches = (job.soulIds || []).map((id) => ds.indexes.soulsById.get(id)).filter(Boolean);
          return `
            <div class="rounded-xl bg-midnight/70 border border-stoneIvory/12 p-4 sm:p-5">
              <div class="flex items-center justify-between gap-2 pb-3 mb-3.5 border-b border-stoneIvory/10">
                <div class="flex items-center gap-2.5">
                  <span class="font-mono text-[10px] font-semibold tracking-[0.16em] px-2 py-0.5 rounded bg-abyss border border-stoneIvory/15 text-aether-gold">${escapeHtml(job.jobKey)}</span>
                  <h4 class="font-cinzel font-bold text-base sm:text-lg tracking-[0.08em] text-stoneIvory">${escapeHtml(job.jobName)}</h4>
                </div>
                <span class="font-mono text-[10px] tracking-[0.16em] uppercase text-slateSilver/75">${branches.length} Shards</span>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                ${branches.map(renderSoulCardHtml).join('')}
              </div>
            </div>
          `;
        })
        .join('');

      panel.innerHTML = `
        <div class="fade-swap">
          ${searchBarHtml}
          <div class="pb-6 mb-6 border-b border-stoneIvory/10">
            <span class="inline-block font-mono text-[10px] tracking-[0.22em] uppercase px-3 py-1 rounded-full border mb-3 text-aether-gold bg-aether-gold/12 border-aether-gold/30">
              Complete Compendium &bull; ${ds.jobs.jobs.length} Classic Jobs &bull; ${ds.souls.souls.length} Canonical Shards
            </span>
            <h3 class="font-cinzel font-bold text-2xl sm:text-3xl tracking-[0.1em] uppercase text-ivory-gold mb-2">
              All Twenty-Two Lineages
            </h3>
            <p class="text-sm text-slateSilver leading-relaxed max-w-2xl">
              Every classic Vana’diel job branches into three canonical Soul identities. Click any shard to inspect its abilities, spells, traits, and weapon configuration.
            </p>
          </div>
          <div class="space-y-4">${jobsHtml}</div>
        </div>
      `;
      bindSearchInput();
      return;
    }

    const callingSouls = ds.souls.souls.filter((s) => s.calling === callingMeta.id);
    const filteredSouls =
      state.activeShardTag === 'All'
        ? callingSouls
        : callingSouls.filter((s) => s.callingTag === state.activeShardTag);

    const tags = callingMeta.tags || ['All'];
    const tagButtonsHtml =
      tags.length > 2
        ? `<div class="flex flex-wrap items-center gap-2">
            ${tags
              .map((tag) => {
                const count = tag === 'All' ? callingSouls.length : callingSouls.filter((s) => s.callingTag === tag).length;
                const isSelected = state.activeShardTag === tag;
                const cls = isSelected
                  ? `${style.chipClass} font-semibold`
                  : 'border-stoneIvory/12 bg-abyss/75 text-slateSilver hover:text-stoneIvory hover:border-stoneIvory/30';
                return `
                  <button type="button" onclick="window.SoulspireDataUI.setShardTag('${escapeHtml(tag)}')"
                    class="px-3 py-1.5 rounded-full border font-mono text-[10px] tracking-[0.14em] uppercase transition-all cursor-pointer ${cls}">
                    ${escapeHtml(tag)} (${count})
                  </button>
                `;
              })
              .join('')}
          </div>`
        : `<span class="font-mono text-[10px] tracking-[0.16em] uppercase px-3 py-1.5 rounded-full border ${style.chipClass}">
            Damage (${callingSouls.length})
          </span>`;

    panel.innerHTML = `
      <div class="fade-swap">
        ${searchBarHtml}

        <div class="pb-6 mb-6 border-b border-stoneIvory/10">
          <span class="inline-block font-mono text-[10px] tracking-[0.22em] uppercase px-3 py-1 rounded-full border mb-3.5 ${style.badgeClass}">
            ${escapeHtml(callingMeta.badge)}
          </span>
          <h3 class="font-cinzel font-bold text-2xl sm:text-3xl tracking-[0.1em] uppercase text-ivory-gold mb-3">
            The ${escapeHtml(callingMeta.title)}
          </h3>
          <p class="text-sm sm:text-base text-slateSilver leading-relaxed mb-4 max-w-3xl">
            ${escapeHtml(callingMeta.fantasy)}
          </p>
          <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-stoneMuted">
            <span class="inline-flex items-center gap-2">
              <span class="w-1.5 h-1.5 rounded-full ${style.accentDot}"></span>
              <span>Thematic Identity: <strong class="text-stoneIvory font-medium">${escapeHtml(callingMeta.roleFocus)}</strong></span>
            </span>
            <span class="font-mono text-[11px] text-slateSilver/80">
              Showing ${filteredSouls.length} of ${callingSouls.length} Shards
            </span>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
          <span class="font-mono text-[10px] tracking-[0.22em] uppercase text-slateSilver">
            Filter by Tag Category
          </span>
          ${tagButtonsHtml}
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-6">
          ${filteredSouls.map(renderSoulCardHtml).join('')}
        </div>

        <div class="pt-4 border-t border-stoneIvory/10 flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-start gap-2.5">
            <span class="mt-1 w-2 h-2 rotate-45 bg-aether-cyan shrink-0"></span>
            <p class="font-mono text-[11px] text-slateSilver/85 leading-relaxed">
              Synchronized directly from the canonical SoulspireXI Game Registry &bull; Click any Soul to view abilities, spells, traits &amp; weapon rules.
            </p>
          </div>
          <a href="https://wiki.soulspirexi.com/#crystals" target="_blank" rel="noopener noreferrer"
            class="font-mono text-[11px] uppercase tracking-[0.14em] text-aether-gold hover:text-stoneIvory transition-colors">
            Open Full Wiki &rarr;
          </a>
        </div>
      </div>
    `;
    bindSearchInput();
  }

  function bindSearchInput() {
    const input = document.getElementById('shards-search-input');
    if (!input) return;
    input.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      const pos = e.target.selectionStart;
      renderShardsPanel();
      const nextInput = document.getElementById('shards-search-input');
      if (nextInput) {
        nextInput.focus();
        if (typeof pos === 'number') {
          try {
            nextInput.setSelectionRange(pos, pos);
          } catch (_) {}
        }
      }
    });
  }

  function renderSoulDetailModal() {
    const modal = document.getElementById('soul-detail-modal');
    const body = document.getElementById('soul-detail-body');
    if (!modal || !body || !state.dataset || !state.activeSoulId) return;

    const ds = state.dataset;
    const soul = ds.indexes.soulsById.get(state.activeSoulId);
    if (!soul) return;

    const style = CALLING_STYLES[soul.calling] || CALLING_STYLES.vanguard;
    const abilities = (soul.abilityIds || []).map((id) => ds.indexes.abilitiesById.get(id)).filter(Boolean);
    const spells = (soul.spellIds || []).map((id) => ds.indexes.spellsById.get(id)).filter(Boolean);
    const traits = (soul.traitIds || []).map((id) => ds.indexes.traitsById.get(id)).filter(Boolean);

    const wcfg = soul.weaponConfig || {};
    const statusBadge =
      soul.releaseStatus === 'upcoming'
        ? '<span class="font-mono text-[10px] uppercase tracking-[0.16em] px-2.5 py-1 rounded-full border border-aether-violet/45 bg-aether-violet/15 text-purple-200">Upcoming</span>'
        : '<span class="font-mono text-[10px] uppercase tracking-[0.16em] px-2.5 py-1 rounded-full border border-emerald-400/40 bg-emerald-400/12 text-emerald-300">Live on Server</span>';

    const redirectBanner = state.redirectNotice
      ? `<div class="mb-4 px-3.5 py-2.5 rounded-lg bg-aether-cyan/10 border border-aether-cyan/30 font-mono text-[11px] text-aether-cyan">
           ${escapeHtml(state.redirectNotice)}
         </div>`
      : '';

    const renderActionRow = (item) => {
      const metaParts = [];
      if (item.unlockLevel) metaParts.push(`Lv. ${item.unlockLevel}`);
      if (item.cost) metaParts.push(item.cost);
      if (item.recast) metaParts.push(`Recast ${item.recast}`);
      if (item.target) metaParts.push(item.target);
      return `
        <div class="p-3.5 rounded-lg bg-abyss/80 border border-stoneIvory/10">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
            <span class="font-cinzel text-sm font-bold text-stoneIvory">${escapeHtml(item.name)}</span>
            <span class="font-mono text-[10px] text-slateSilver/80">${escapeHtml(metaParts.join(' • '))}</span>
          </div>
          <p class="text-xs text-slateSilver leading-relaxed">${escapeHtml(item.description || '')}</p>
        </div>
      `;
    };

    body.innerHTML = `
      ${redirectBanner}
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="font-mono text-[10px] tracking-[0.18em] uppercase px-2.5 py-1 rounded-full border ${style.chipClass}">
          ${escapeHtml(soul.jobKey)} &bull; ${escapeHtml(soul.jobName)}
        </span>
        <span class="font-mono text-[10px] font-semibold tracking-[0.16em] px-2.5 py-1 rounded-full bg-abyss border border-stoneIvory/20 text-stoneIvory">
          ${escapeHtml(soul.abbreviation)}
        </span>
        <span class="font-mono text-[10px] tracking-[0.14em] uppercase px-2.5 py-1 rounded-full border border-stoneIvory/15 text-slateSilver">
          ${escapeHtml(soul.roleLabel)}
        </span>
        ${statusBadge}
      </div>

      <h3 class="font-cinzel font-bold text-2xl sm:text-3xl tracking-[0.1em] uppercase text-ivory-gold mb-2">
        ${escapeHtml(soul.displayName)}
      </h3>
      <p class="text-sm text-stoneIvory/90 leading-relaxed mb-3">${escapeHtml(soul.lore || '')}</p>
      <p class="text-xs sm:text-sm text-slateSilver leading-relaxed mb-6">${escapeHtml(soul.atAGlance || soul.summary || '')}</p>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div class="p-4 rounded-xl bg-abyss/80 border border-stoneIvory/12">
          <div class="font-mono text-[10px] tracking-[0.2em] uppercase text-aether-gold mb-1.5">Weapon Configuration &amp; Equipment</div>
          <div class="font-cinzel text-sm font-bold text-stoneIvory mb-1">${escapeHtml(wcfg.modeLabel || 'Standard Job Weapons')}</div>
          <p class="text-xs text-slateSilver leading-relaxed mb-2">${escapeHtml(wcfg.summary || soul.equipmentCompatibility || '')}</p>
          ${
            wcfg.releaseStatus === 'upcoming'
              ? '<span class="inline-block font-mono text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded bg-aether-violet/15 border border-aether-violet/35 text-purple-200">Extended Weapon Template: Upcoming</span>'
              : ''
          }
        </div>
        <div class="p-4 rounded-xl bg-abyss/80 border border-stoneIvory/12">
          <div class="font-mono text-[10px] tracking-[0.2em] uppercase text-aether-cyan mb-1.5">Unlock &amp; Core Mechanics</div>
          <div class="font-cinzel text-sm font-bold text-stoneIvory mb-1">Unlocks at Level ${escapeHtml(soul.reqLevel)}</div>
          <p class="text-xs text-slateSilver leading-relaxed">${escapeHtml(soul.resourceSystem || (soul.highlights || [])[0] || '')}</p>
        </div>
      </div>

      ${
        traits.length
          ? `<div class="mb-6">
               <h4 class="font-mono text-[11px] tracking-[0.22em] uppercase text-aether-gold mb-3">Soul Traits (${traits.length})</h4>
               <div class="space-y-2.5">
                 ${traits
                   .map(
                     (tr) => `
                   <div class="p-3.5 rounded-lg bg-abyss/80 border border-aether-gold/20">
                     <div class="font-cinzel text-sm font-bold text-stoneIvory mb-1">${escapeHtml(tr.name)}</div>
                     <p class="text-xs text-slateSilver leading-relaxed">${escapeHtml(tr.description)}</p>
                   </div>
                 `
                   )
                   .join('')}
               </div>
             </div>`
          : ''
      }

      ${
        abilities.length
          ? `<div class="mb-6">
               <h4 class="font-mono text-[11px] tracking-[0.22em] uppercase text-aether-cyan mb-3">Soul Abilities (${abilities.length})</h4>
               <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">${abilities.map(renderActionRow).join('')}</div>
             </div>`
          : ''
      }

      ${
        spells.length
          ? `<div class="mb-6">
               <h4 class="font-mono text-[11px] tracking-[0.22em] uppercase text-aether-violet mb-3">Soul Spells (${spells.length})</h4>
               <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">${spells.map(renderActionRow).join('')}</div>
             </div>`
          : ''
      }

      <div class="pt-4 border-t border-stoneIvory/10 flex flex-wrap items-center justify-between gap-3">
        <span class="font-mono text-[10px] text-slateSilver/70">Permanent ID: ${escapeHtml(soul.id)}</span>
        <div class="flex items-center gap-3">
          <a href="${escapeHtml(soul.wikiUrl)}" target="_blank" rel="noopener noreferrer"
            class="btn-molten-gold px-5 py-2.5 rounded-md font-cinzel text-xs font-bold tracking-[0.14em] uppercase">
            Read Full Wiki Guide
          </a>
          <button type="button" onclick="window.SoulspireDataUI.closeSoulDetail()"
            class="btn-aether-glass px-4 py-2.5 rounded-md font-mono text-xs uppercase tracking-[0.14em] text-stoneIvory cursor-pointer">
            Close
          </button>
        </div>
      </div>
    `;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
  }

  function renderSystemsSection() {
    const container = document.getElementById('systems-grid');
    const summaryEl = document.getElementById('systems-release-banner');
    if (!container || !state.dataset) return;

    const sys = state.dataset.systems;
    const features = (sys.features || []).filter((f) => {
      if (state.systemFilter === 'all') return true;
      return f.status === state.systemFilter;
    });

    if (summaryEl) {
      const dep = sys.deployedRelease || {};
      const app = sys.approvedRelease || {};
      summaryEl.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div class="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-300 mb-1">Currently Deployed Server</div>
            <div class="font-cinzel font-bold text-base sm:text-lg text-stoneIvory">${escapeHtml(dep.releaseLabel || dep.deploymentVersion)}</div>
            <div class="font-mono text-[11px] text-slateSilver mt-1">Server ${escapeHtml(dep.deploymentVersion)} &bull; Launcher ${escapeHtml(dep.launcherVersion || 'v2.1.0')} &bull; Registry ${escapeHtml(app.registryVersion || '')}</div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            ${['all', 'deployed', 'upcoming']
              .map((key) => {
                const label = key === 'all' ? 'All Systems' : key === 'deployed' ? 'Live on Server' : 'Upcoming';
                const active = state.systemFilter === key;
                return `<button type="button" onclick="window.SoulspireDataUI.setSystemFilter('${key}')"
                  class="px-3.5 py-1.5 rounded-full border font-mono text-[10px] uppercase tracking-[0.15em] cursor-pointer transition-all ${
                    active
                      ? 'border-aether-cyan/55 bg-aether-cyan/15 text-aether-cyan font-semibold'
                      : 'border-stoneIvory/15 bg-abyss/80 text-slateSilver hover:text-stoneIvory'
                  }">${label}</button>`;
              })
              .join('')}
          </div>
        </div>
      `;
    }

    container.innerHTML = features
      .map((f) => {
        const isLive = f.status === 'deployed';
        const badge = isLive
          ? '<span class="font-mono text-[10px] uppercase tracking-[0.16em] px-2.5 py-0.5 rounded-full border border-emerald-400/35 bg-emerald-400/12 text-emerald-300">Live on Server</span>'
          : '<span class="font-mono text-[10px] uppercase tracking-[0.16em] px-2.5 py-0.5 rounded-full border border-aether-violet/45 bg-aether-violet/15 text-purple-200">Upcoming</span>';
        const highlights = (f.highlights || [])
          .map(
            (h) =>
              `<li class="flex items-start gap-2.5"><span class="mt-1.5 w-1.5 h-1.5 rotate-45 ${isLive ? 'bg-aether-cyan' : 'bg-aether-violet'} shrink-0"></span><span>${escapeHtml(h)}</span></li>`
          )
          .join('');
        return `
          <article class="crag-panel rounded-xl p-6 flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between gap-2 mb-3">
                <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-aether-gold">${escapeHtml(f.category)}</span>
                ${badge}
              </div>
              <h3 class="font-cinzel font-bold text-lg tracking-[0.07em] text-stoneIvory mb-2.5">${escapeHtml(f.name)}</h3>
              <p class="text-xs sm:text-sm text-slateSilver leading-relaxed mb-4">${escapeHtml(f.summary)}</p>
              ${highlights ? `<ul class="space-y-2 text-xs text-stoneIvory/85">${highlights}</ul>` : ''}
            </div>
          </article>
        `;
      })
      .join('');
  }

  function renderChangelogSection() {
    const container = document.getElementById('changelog-list');
    if (!container || !state.dataset) return;
    const entries = state.dataset.changelog.entries || [];
    container.innerHTML = entries
      .map((entry) => {
        const changesHtml = (entry.changes || [])
          .map(
            (c) => `
            <li class="flex items-start gap-3 text-xs sm:text-sm text-stoneIvory/90">
              <span class="font-mono text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded border border-aether-gold/30 bg-aether-gold/10 text-aether-gold shrink-0 mt-0.5">${escapeHtml(c.category)}</span>
              <span class="leading-relaxed">${escapeHtml(c.text)}</span>
            </li>
          `
          )
          .join('');
        return `
          <article class="crag-panel rounded-xl p-6 sm:p-7">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <div class="flex items-center gap-2.5">
                <span class="font-mono text-xs font-semibold tracking-[0.16em] text-aether-cyan">${escapeHtml(entry.version)}</span>
                <span class="font-mono text-[10px] uppercase tracking-[0.16em] px-2.5 py-0.5 rounded-full border border-emerald-400/35 bg-emerald-400/12 text-emerald-300">${
                  entry.status === 'upcoming' ? 'Upcoming' : 'Live'
                }</span>
              </div>
              <span class="font-mono text-[11px] text-slateSilver/75">${escapeHtml(entry.date)}</span>
            </div>
            <h3 class="font-cinzel font-bold text-lg sm:text-xl tracking-[0.07em] text-stoneIvory mb-2">${escapeHtml(entry.title)}</h3>
            <p class="text-xs sm:text-sm text-slateSilver leading-relaxed mb-4">${escapeHtml(entry.summary)}</p>
            <ul class="space-y-2.5">${changesHtml}</ul>
          </article>
        `;
      })
      .join('');
  }

  function handleRouteFromUrl() {
    if (!state.dataset || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search || '');
    const qSoul = params.get('soul');
    const hash = (window.location.hash || '').replace(/^#/, '');
    let token = null;
    if (qSoul) token = qSoul;
    else if (hash.startsWith('soul/')) token = decodeURIComponent(hash.slice('soul/'.length));
    else if (hash.startsWith('class/')) token = decodeURIComponent(hash.slice('class/'.length));

    if (!token) return;
    const resolved = resolveSoulToken(state.dataset, token);
    if (!resolved) return;

    state.activeSoulId = resolved.soul.id;
    state.redirectNotice = resolved.redirected
      ? `Redirected from legacy link "${resolved.fromToken}" to canonical Soul ${resolved.soul.displayName} (${resolved.soul.abbreviation}).`
      : null;

    try {
      const targetHash = `#soul/${encodeURIComponent(resolved.soul.id)}`;
      if (window.location.hash !== targetHash || qSoul) {
        window.history.replaceState(null, '', `${window.location.pathname}${targetHash}`);
      }
    } catch (_) {}

    renderSoulDetailModal();
  }

  const SoulspireDataUI = {
    async init() {
      const cached = readLastKnownGood();
      if (cached) {
        state.dataset = cached;
        state.sourceMode = 'cached';
        updateCallingTabHeaders();
        renderVersionBadges();
        renderShardsPanel();
        renderSystemsSection();
        renderChangelogSection();
      } else {
        renderShardsPanel();
      }

      try {
        const live = await fetchPublicDataset();
        state.dataset = live;
        state.sourceMode = 'live';
        saveLastKnownGood(live);
        updateCallingTabHeaders();
        renderVersionBadges();
        renderShardsPanel();
        renderSystemsSection();
        renderChangelogSection();
        handleRouteFromUrl();
      } catch (err) {
        if (!state.dataset) {
          state.sourceMode = 'error';
          renderShardsPanel();
        } else {
          // Preserve last-known-good dataset seamlessly on failed refresh
          state.sourceMode = 'cached';
          renderVersionBadges();
          handleRouteFromUrl();
        }
      }
    },

    reload() {
      return this.init();
    },

    selectCalling(key) {
      state.activeCallingKey = key;
      state.activeShardTag = 'All';
      state.shardViewMode = 'calling';
      state.searchQuery = '';
      renderShardsPanel();
    },

    setShardTag(tag) {
      state.activeShardTag = tag;
      renderShardsPanel();
    },

    setShardViewMode(mode) {
      state.shardViewMode = mode;
      state.searchQuery = '';
      renderShardsPanel();
    },

    setSearchQuery(q) {
      state.searchQuery = String(q || '');
      renderShardsPanel();
    },

    setSystemFilter(filter) {
      state.systemFilter = filter;
      renderSystemsSection();
    },

    openSoulDetail(soulId) {
      if (!state.dataset) return;
      const resolved = resolveSoulToken(state.dataset, soulId);
      if (!resolved) return;
      state.activeSoulId = resolved.soul.id;
      state.redirectNotice = resolved.redirected
        ? `Redirected from legacy link "${resolved.fromToken}" to canonical Soul ${resolved.soul.displayName} (${resolved.soul.abbreviation}).`
        : null;
      try {
        window.history.replaceState(null, '', `#soul/${encodeURIComponent(resolved.soul.id)}`);
      } catch (_) {}
      renderSoulDetailModal();
    },

    closeSoulDetail() {
      const modal = document.getElementById('soul-detail-modal');
      if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
      }
      document.body.style.overflow = '';
      state.activeSoulId = null;
      state.redirectNotice = null;
      try {
        if ((window.location.hash || '').startsWith('#soul/')) {
          window.history.replaceState(null, '', '#shards');
        }
      } catch (_) {}
    },

    // Exported pure helpers for automated regression testing
    _internals: {
      validateDataset,
      buildIndexes,
      fetchPublicDataset,
      resolveSoulToken,
      filterSouls,
      readLastKnownGood,
      saveLastKnownGood,
      normalizeSlug,
    },
  };

  if (typeof window !== 'undefined') {
    window.SoulspireDataUI = SoulspireDataUI;
    window.selectCalling = (key) => SoulspireDataUI.selectCalling(key);
    window.setShardTag = (tag) => SoulspireDataUI.setShardTag(tag);
    window.setShardViewMode = (mode) => SoulspireDataUI.setShardViewMode(mode);

    window.addEventListener('hashchange', handleRouteFromUrl);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.activeSoulId) {
        SoulspireDataUI.closeSoulDetail();
      }
    });
    document.addEventListener('DOMContentLoaded', () => {
      const modal = document.getElementById('soul-detail-modal');
      if (modal) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) SoulspireDataUI.closeSoulDetail();
        });
      }
      SoulspireDataUI.init();
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SoulspireDataUI;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
