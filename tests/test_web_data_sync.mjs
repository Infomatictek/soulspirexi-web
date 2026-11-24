import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const API_DIR = path.join(ROOT, 'api', 'v1');
const SoulspireDataUI = require(path.join(ROOT, 'assets', 'soulspire-data.js'));
const internals = SoulspireDataUI._internals;

function loadLocalDataset() {
  const names = ['manifest', 'jobs', 'souls', 'abilities', 'spells', 'traits', 'systems', 'changelog'];
  const ds = {};
  for (const name of names) {
    ds[name] = JSON.parse(fs.readFileSync(path.join(API_DIR, `${name}.json`), 'utf8'));
  }
  return ds;
}

test('index.html has zero hardcoded Soul/job arrays and loads soulspire-data.js', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /\bconst\s+sixtySixSouls\s*=\s*\[/);
  assert.doesNotMatch(html, /\bconst\s+classicJobsOrder\s*=\s*\[/);
  assert.match(html, /assets\/soulspire-data\.js/);
  assert.match(html, /id="calling-preview-panel"/);
  assert.match(html, /id="soul-detail-modal"/);
  assert.match(html, /id="systems-grid"/);
  assert.match(html, /id="changelog-list"/);
  assert.match(html, /id="data-version-footer"/);
});

test('local /api/v1 dataset passes schema validation with 22 jobs and 66 canonical Souls', () => {
  const raw = loadLocalDataset();
  assert.equal(internals.validateDataset(raw), true);
  assert.equal(raw.jobs.jobs.length, 22);
  assert.equal(raw.souls.souls.length, 66);

  const byId = new Map(raw.souls.souls.map((s) => [s.id, s]));
  // Verify canonical post-WS1-SOUL-001 display names (not pre-rename drift names!)
  assert.equal(byId.get('mnk_dps').displayName, 'Wayfarer');
  assert.equal(byId.get('mnk_healer').displayName, 'Stillwater');
  assert.equal(byId.get('blm_dps').displayName, 'Goetist');
  assert.equal(byId.get('rdm_dps').displayName, 'Conflux');
  assert.equal(byId.get('run_tank').displayName, 'Runeweft');
  assert.equal(byId.get('nin_support').displayName, 'Fūin');
});

test('stable permanent IDs and legacy URL redirects resolve cleanly without broken links', () => {
  const ds = internals.buildIndexes(loadLocalDataset());

  // Direct permanent ID does not flag redirect
  const direct = internals.resolveSoulToken(ds, 'mnk_dps');
  assert.equal(direct.soul.id, 'mnk_dps');
  assert.equal(direct.soul.displayName, 'Wayfarer');
  assert.equal(direct.redirected, false);

  // Legacy pre-rename URLs redirect cleanly to canonical permanent IDs
  const legacyCases = [
    ['black-belt', 'mnk_dps', 'Wayfarer'],
    ['chi-weaver', 'mnk_healer', 'Stillwater'],
    ['astromancer', 'blm_dps', 'Goetist'],
    ['scarlet-weaver', 'rdm_dps', 'Conflux'],
    ['inquisitor', 'run_tank', 'Runeweft'],
    ['gladiator', 'war_tank', 'Spartan'],
  ];
  for (const [oldSlug, expectedId, expectedName] of legacyCases) {
    const res = internals.resolveSoulToken(ds, oldSlug);
    assert.ok(res, `Expected legacy slug ${oldSlug} to resolve`);
    assert.equal(res.soul.id, expectedId);
    assert.equal(res.soul.displayName, expectedName);
    assert.equal(res.redirected, true);
  }
});

test('search matches canonical names, abbreviations, legacy aliases, and ability names', () => {
  const ds = internals.buildIndexes(loadLocalDataset());

  const byCanon = internals.filterSouls(ds, { query: 'Stillwater' });
  assert.ok(byCanon.some((s) => s.id === 'mnk_healer'));

  const byAbbr = internals.filterSouls(ds, { query: 'GOE' });
  assert.ok(byAbbr.some((s) => s.id === 'blm_dps'));

  const byLegacy = internals.filterSouls(ds, { query: 'astromancer' });
  assert.ok(byLegacy.some((s) => s.id === 'blm_dps'));

  const byAbility = internals.filterSouls(ds, { query: 'Tactical Breach' });
  assert.ok(byAbility.some((s) => s.id === 'war_support'));
});

test('last-known-good localStorage cache preserves validated data across failed refreshes', async () => {
  const raw = loadLocalDataset();
  const mem = new Map();
  const fakeStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
  };

  internals.saveLastKnownGood(raw, fakeStorage);
  const restored = internals.readLastKnownGood(fakeStorage);
  assert.ok(restored);
  assert.equal(restored.souls.souls.length, 66);
  assert.equal(restored.manifest.registryHash, raw.manifest.registryHash);

  // Corrupted/partial refresh must reject cleanly
  await assert.rejects(
    () => internals.fetchPublicDataset(async () => ({ ok: false, status: 503 }), './api/v1'),
    /HTTP 503/
  );
  // LKG remains intact after failed refresh
  assert.equal(internals.readLastKnownGood(fakeStorage).souls.souls.length, 66);
});

test('fetchPublicDataset uses versioned asset URLs from manifest.json', async () => {
  const raw = loadLocalDataset();
  const seenUrls = [];
  const mockFetch = async (url) => {
    seenUrls.push(url);
    const m = url.match(/\/([a-z]+)\.json/);
    const name = m ? m[1] : '';
    return { ok: true, status: 200, json: async () => raw[name] };
  };

  const loaded = await internals.fetchPublicDataset(mockFetch, './api/v1');
  assert.equal(loaded.souls.souls.length, 66);
  const shortHash = raw.manifest.contentHash.slice(0, 8);
  assert.ok(seenUrls.some((u) => u.includes(`souls.json?v=${shortHash}`)));
});
