import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const REGISTER_HTML_PATH = path.join(REPO_ROOT, 'register', 'index.html');

test('register/index.html defines all four distinct registration states', () => {
  const html = fs.readFileSync(REGISTER_HTML_PATH, 'utf8');
  assert.ok(html.includes('id="stateLoading"'), 'Missing stateLoading');
  assert.ok(html.includes('id="stateForm"'), 'Missing stateForm (open)');
  assert.ok(html.includes('id="stateClosed"'), 'Missing stateClosed');
  assert.ok(html.includes('id="stateUnavailable"'), 'Missing stateUnavailable');
  assert.ok(html.includes('Registration Service Temporarily Unavailable'));
});

test('register/index.html enforces strict boolean parsing, <=5s auto-refresh, and outage separation', () => {
  const html = fs.readFileSync(REGISTER_HTML_PATH, 'utf8');
  assert.ok(
    html.includes("typeof data.registration_open !== 'boolean'"),
    'Must strictly validate registration_open is a boolean'
  );
  const pollMatch = html.match(/const\s+STATUS_POLL_MS\s*=\s*(\d+)/);
  assert.ok(pollMatch, 'Missing STATUS_POLL_MS constant');
  const pollMs = Number(pollMatch[1]);
  assert.ok(pollMs > 0 && pollMs <= 5000, `STATUS_POLL_MS must be <= 5000ms, got ${pollMs}`);
  assert.ok(html.includes("cache: 'no-store'"), 'Must fetch status with cache: no-store');
  assert.ok(html.includes("'_t=' + Date.now()"), 'Must cache-bust status URL');
  assert.ok(
    html.includes("showState(elUnavailable, 'unavailable')"),
    'API errors must show unavailable state instead of closed'
  );
  assert.ok(
    !html.includes('catch (_) {\n          showState(elClosed'),
    'Catch block must never display stateClosed'
  );
});
