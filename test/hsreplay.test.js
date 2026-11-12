import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchCollection, parseCollection } from '../src/sources/collection.js';
import { fetchHsreplayDecks, parseDecks } from '../src/sources/decks-hsreplay.js';
import { hsreplayGet } from '../src/sources/hsreplay-http.js';
import { stubFetch } from './helpers.js';

const config = { hsreplay: { sessionid: 'abc123' } };
const DECK_BODY = {
  series: {
    data: {
      MAGE: [{ deck_id: 'xYz', deck_list: '[[101,2],[104,1]]', archetype_id: 9, win_rate: 54.2, total_games: 1200 }],
      WARRIOR: [{ deck_id: 'w1', deck_list: [[401, 2]], archetype_id: null, win_rate: 49, total_games: 300 }],
    },
  },
};

test('hsreplayGet sends the session cookie only to hsreplay.net', async () => {
  const fetchImpl = stubFetch({ '/api/v1/archetypes/': { body: [] } });
  await hsreplayGet('/api/v1/archetypes/', config, fetchImpl);
  const [call] = fetchImpl.calls;
  assert.ok(call.url.startsWith('https://hsreplay.net/'));
  assert.equal(call.options.headers.cookie, 'sessionid=abc123');
});

test('hsreplayGet explains a rejected session', async () => {
  const fetchImpl = stubFetch({ '/api/': { status: 403 } });
  await assert.rejects(hsreplayGet('/api/v1/account/', config, fetchImpl), /sessionid/);
});

test('hsreplayGet refuses a cookie value that could inject headers', async () => {
  const bad = { hsreplay: { sessionid: 'abc\r\nx-evil: 1' } };
  await assert.rejects(hsreplayGet('/api/v1/account/', bad, stubFetch({})), /sessionid/);
});

test('parseCollection sums all versions of a card', () => {
  assert.deepEqual(parseCollection({ collection: { 101: [1, 1, 0, 0], 104: [0, 0], 105: [2] } }), { 101: 2, 105: 2 });
});

test('parseCollection rejects unexpected shapes', () => {
  assert.throws(() => parseCollection({}), /beklenen biçimde/);
  assert.throws(() => parseCollection({ collection: [] }), /beklenen biçimde/);
  assert.throws(() => parseCollection({ collection: { abc: [1] } }), /beklenen biçimde/);
  assert.throws(() => parseCollection({ collection: { 101: [0] } }), /boş/);
});

test('fetchCollection discovers the account when the config has none', async () => {
  const fetchImpl = stubFetch({
    '/api/v1/account/': { body: { blizzard_accounts: [{ region: 2, account_lo: 777 }] } },
    '/api/v1/collection/': { body: { collection: { 101: [2] } } },
  });
  assert.deepEqual(await fetchCollection(config, fetchImpl), { 101: 2 });
  assert.ok(fetchImpl.calls[1].url.includes('region=2&account_lo=777'));
});

test('fetchCollection uses the configured account without asking', async () => {
  const fetchImpl = stubFetch({ '/api/v1/collection/': { body: { collection: { 101: [2] } } } });
  await fetchCollection({ hsreplay: { sessionid: 'abc', region: 1, accountLo: 5 } }, fetchImpl);
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(fetchImpl.calls[0].url.includes('region=1&account_lo=5'));
});

test('fetchCollection needs a session cookie', async () => {
  await assert.rejects(fetchCollection({}, stubFetch({})), /sessionid/);
});

test('parseDecks maps rows to deck objects', () => {
  const decks = parseDecks(DECK_BODY, [{ id: 9, name: 'Spell Mage' }], 'standard');
  assert.deepEqual(decks[0], {
    id: 'hsreplay:standard:xYz',
    source: 'hsreplay',
    name: 'Spell Mage',
    archetype: 'Spell Mage',
    cardClass: 'MAGE',
    format: 'standard',
    cards: { 101: 2, 104: 1 },
    winRate: 54.2,
    games: 1200,
  });
  assert.equal(decks[1].name, 'WARRIOR destesi');
  assert.equal(decks[1].archetype, null);
});

test('parseDecks rejects unexpected shapes', () => {
  assert.throws(() => parseDecks({}, [], 'standard'), /beklenen biçimde/);
  assert.throws(() => parseDecks({ series: { data: {} } }, [], 'standard'), /beklenen biçimde/);
  assert.throws(
    () => parseDecks({ series: { data: { MAGE: [{ deck_id: 'a', deck_list: 'not json' }] } } }, [], 'standard'),
    /beklenen biçimde/,
  );
});

test('fetchHsreplayDecks loads both formats', async () => {
  const fetchImpl = stubFetch({
    '/api/v1/archetypes/': { body: [{ id: 9, name: 'Spell Mage' }] },
    'list_decks_by_win_rate_v2': { body: DECK_BODY },
  });
  const decks = await fetchHsreplayDecks(config, fetchImpl);
  assert.deepEqual([...new Set(decks.map((d) => d.format))].sort(), ['standard', 'wild']);
  assert.equal(decks.length, 4);
});
