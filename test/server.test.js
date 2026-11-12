import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../server.js';
import { encode } from '../src/deckstring.js';
import { createStore } from '../src/store.js';
import { CARDS, FULL_DECK_CARDS, deck, rawCards, stubFetch } from './helpers.js';

const root = mkdtempSync(join(tmpdir(), 'stoner-'));
const dataDir = join(root, 'data');
const publicDir = join(root, 'public');
const store = createStore(dataDir);
store.write('cards', CARDS);
store.write('collection', { 101: 2, 105: 2, 106: 1 });
store.write('decks', [
  // b1 includes the Core Fireball so that CORE counts as a Standard set in this data.
  deck('hsreplay:standard:b1', { 101: 2, 301: 1 }, { winRate: 52 }),
  deck('hsreplay:standard:s1', { 101: 2, 103: 1 }, { winRate: 57 }),
  deck('hsreplay:standard:m1', { 401: 2 }, { cardClass: 'WARRIOR' }),
]);
mkdirSync(publicDir, { recursive: true });
writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>Stoner</title>');

const fetchImpl = stubFetch({ 'hearthstonejson.com': { body: rawCards(1000) }, 'hsreplay.net': { status: 403 } });
const server = createApp({ dataDir, publicDir, configPath: join(root, 'config.local.json'), fetchImpl });
let base;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null), res };
};

// fetch may refuse to override Host and Origin, so those checks use a raw request.
const rawStatus = (path, method, headers) =>
  new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, path, method, headers }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });

test('GET /api/state summarises the data', async () => {
  const { status, body } = await call('/api/state');
  assert.equal(status, 200);
  assert.equal(body.cardCount, CARDS.length);
  assert.equal(body.collectionCount, 3);
  assert.equal(body.deckCount, 3);
  assert.deepEqual(body.classes, ['MAGE', 'WARRIOR']);
});

test('GET /api/recommendations returns presented decks in order', async () => {
  const { body } = await call('/api/recommendations?format=standard');
  assert.deepEqual(
    body.map((r) => [r.id, r.status]),
    [
      ['hsreplay:standard:b1', 'buildable'],
      ['hsreplay:standard:s1', 'substituted'],
      ['hsreplay:standard:m1', 'missing'],
    ],
  );
  const s1 = body[1];
  assert.equal(s1.confidence, 'medium');
  assert.equal(s1.swaps[0].out.name, 'Star Mage');
  assert.equal(s1.swaps[0].in.name, 'Apprentice');
  assert.deepEqual(s1.missing, [{ dbfId: 103, name: 'Star Mage', cost: 3, rarity: 'EPIC', count: 1, core: false }]);
  assert.deepEqual(
    s1.cards.map((c) => [c.name, c.count]),
    [
      ['Arcane Bolt', 2],
      ['Apprentice', 1],
    ],
  );
  assert.equal(typeof s1.code, 'string');
  assert.equal(body[0].confidence, null);
});

test('GET /api/recommendations applies filters and rejects bad ones', async () => {
  assert.equal((await call('/api/recommendations?format=standard&class=WARRIOR')).body.length, 1);
  assert.equal((await call('/api/recommendations?format=standard&maxDust=10')).body.length, 2);
  assert.equal((await call('/api/recommendations?format=arena')).status, 400);
  assert.equal((await call('/api/recommendations?maxDust=abc')).status, 400);
});

test('repeated recommendation requests return the same list and maxDust still filters', async () => {
  const path = '/api/recommendations?format=standard';
  const first = (await call(path)).body;
  assert.deepEqual((await call(path)).body, first);
  assert.equal((await call(`${path}&maxDust=10`)).body.length, first.length - 1);
  assert.deepEqual((await call(path)).body, first);
});

test('GET /api/owned lists owned playable cards', async () => {
  const { body } = await call('/api/owned?class=MAGE&format=standard');
  assert.deepEqual(
    body.map((c) => [c.name, c.owned]),
    [
      ['Arcane Bolt', 2],
      ['Arcane Dart', 2],
      ['Apprentice', 1],
      ['Fireball', 2],
    ],
  );
  assert.equal(body[3].dbfId, 301);
  assert.equal((await call('/api/owned?class=mage&format=standard')).status, 400);
});

test('pasted decks can be added, listed and removed', async () => {
  const code = encode({ format: 'standard', heroes: [637], cards: { 105: 2 } });
  const added = await call('/api/decks', { method: 'POST', body: { code } });
  assert.equal(added.status, 201);
  assert.match(added.body.id, /^pasted:/);
  const listed = await call('/api/recommendations?format=standard');
  assert.ok(listed.body.some((r) => r.id === added.body.id && r.source === 'pasted'));
  assert.equal((await call(`/api/decks/${encodeURIComponent(added.body.id)}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call(`/api/decks/${encodeURIComponent(added.body.id)}`, { method: 'DELETE' })).status, 404);
  assert.equal((await call('/api/decks/hsreplay%3Astandard%3Ab1', { method: 'DELETE' })).status, 404);
});

test('POST /api/decks rejects bad input', async () => {
  assert.equal((await call('/api/decks', { method: 'POST', body: { code: 'nope!' } })).status, 400);
  assert.equal((await call('/api/decks', { method: 'POST', body: {} })).status, 400);
  const res = await fetch(`${base}/api/decks`, { method: 'POST', body: '{broken' });
  assert.equal(res.status, 400);
});

test('POST /api/deckstring encodes and validates', async () => {
  const ok = await call('/api/deckstring', {
    method: 'POST',
    body: { format: 'standard', cardClass: 'MAGE', cards: FULL_DECK_CARDS },
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.problems, []);
  assert.equal(typeof ok.body.code, 'string');
  const short = await call('/api/deckstring', {
    method: 'POST',
    body: { format: 'standard', cardClass: 'MAGE', cards: { 101: 2 } },
  });
  assert.match(short.body.problems[0], /30 kart/);
  const bad = await call('/api/deckstring', {
    method: 'POST',
    body: { format: 'standard', cardClass: 'MAGE', cards: { 101: -1 } },
  });
  assert.equal(bad.status, 400);
  const unknown = await call('/api/deckstring', {
    method: 'POST',
    body: { format: 'standard', cardClass: 'MAGE', cards: { 101: 2, 99999: 1 } },
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, 'Bilinmeyen kart: 99999');
  const noClass = await call('/api/deckstring', {
    method: 'POST',
    body: { format: 'standard', cardClass: 'PRIEST', cards: { 101: 1 } },
  });
  assert.equal(noClass.status, 400);
});

test('state-changing requests from another origin are refused', async () => {
  assert.equal(await rawStatus('/api/update', 'POST', { origin: 'http://evil.example' }), 403);
  assert.equal(await rawStatus('/api/state', 'GET', { origin: 'http://evil.example' }), 200);
});

test('requests with a foreign Host header are refused', async () => {
  assert.equal(await rawStatus('/api/state', 'GET', { host: 'evil.example' }), 403);
});

test('static files are served and unknown paths are 404', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.equal((await call('/nope')).status, 404);
  assert.equal((await call('/../package.json')).status, 404);
});

test('POST /api/update reports per-source results and refreshes the cache', async () => {
  const { status, body } = await call('/api/update', { method: 'POST' });
  assert.equal(status, 200);
  assert.equal(body.cards.error, null);
  assert.match(body.collection.error, /sessionid/);
  assert.equal((await call('/api/state')).body.cardCount, 1000);
});

test('POST /api/update still answers 200 when config.local.json is malformed', async () => {
  writeFileSync(join(root, 'config.local.json'), '{broken');
  const { status, body } = await call('/api/update', { method: 'POST' });
  assert.equal(status, 200);
  assert.equal(body.cards.error, null);
  assert.match(body.collection.error, /^config\.local\.json okunamadı/);
  assert.match(body.decks.error, /^config\.local\.json okunamadı/);
});
