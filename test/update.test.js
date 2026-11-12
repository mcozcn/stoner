import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createStore } from '../src/store.js';
import { runUpdate } from '../src/update.js';
import { rawCards, stubFetch } from './helpers.js';

const config = { hsreplay: { sessionid: 'abc', region: 2, accountLo: 1 } };
const newStore = () => createStore(mkdtempSync(join(tmpdir(), 'stoner-')));

test('a failing source keeps its old data while the others update', async () => {
  const store = newStore();
  store.write('collection', { 101: 1 });
  store.write('status', { collection: { updatedAt: '2026-01-01T00:00:00.000Z', error: null } });
  const fetchImpl = stubFetch({
    'hearthstonejson.com': { body: rawCards(1000) },
    'hsreplay.net': { status: 403 },
  });

  const status = await runUpdate({ store, config, fetchImpl, now: () => '2026-11-12T10:00:00.000Z' });

  assert.deepEqual(status.cards, { updatedAt: '2026-11-12T10:00:00.000Z', error: null });
  assert.equal(status.collection.updatedAt, '2026-01-01T00:00:00.000Z');
  assert.match(status.collection.error, /sessionid/);
  assert.equal(status.decks.updatedAt, null);
  assert.equal(store.read('cards').length, 1000);
  assert.deepEqual(store.read('collection'), { 101: 1 });
  assert.deepEqual(store.read('status'), status);
});

test('all sources succeed', async () => {
  const store = newStore();
  const fetchImpl = stubFetch({
    'hearthstonejson.com': { body: rawCards(1000) },
    '/api/v1/collection/': { body: { collection: { 1: [2] } } },
    '/api/v1/archetypes/': { body: [] },
    'list_decks_by_win_rate_v2': {
      body: { series: { data: { MAGE: [{ deck_id: 'a', deck_list: '[[1,2]]', win_rate: 50, total_games: 500 }] } } },
    },
  });
  const status = await runUpdate({ store, config, fetchImpl });
  assert.equal(Object.values(status).every((s) => s.error === null), true);
  assert.deepEqual(store.read('collection'), { 1: 2 });
  assert.equal(store.read('decks').length, 2);
});
