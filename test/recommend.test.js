import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCatalog } from '../src/catalog.js';
import { recommend } from '../src/recommend.js';
import { CARDS, deck } from './helpers.js';

const catalog = createCatalog(CARDS);
const collection = { 101: 2, 105: 2, 106: 1 };
const decks = [
  deck('m1', { 401: 2 }, { cardClass: 'WARRIOR', winRate: 60 }),
  deck('b1', { 101: 2 }, { winRate: 52 }),
  deck('s1', { 101: 2, 103: 1 }, { winRate: 57 }),
  deck('b3', { 101: 1 }, { winRate: 70, games: 50 }),
  deck('m2', { 999: 1 }, { winRate: 51 }),
  deck('b2', { 105: 2 }, { winRate: 58 }),
  deck('b4', { 105: 1 }, { winRate: null, games: null, source: 'pasted' }),
];
const ids = (filters) => recommend({ catalog, collection, decks, filters }).map((r) => r.deck.id);

test('orders buildable, then substituted, then missing', () => {
  assert.deepEqual(ids({}), ['b2', 'b1', 'b3', 'b4', 's1', 'm2', 'm1']);
});

test('assigns status, dust and low-data flags', () => {
  const by = Object.fromEntries(recommend({ catalog, collection, decks }).map((r) => [r.deck.id, r]));
  assert.equal(by.b1.status, 'buildable');
  assert.equal(by.b1.substitution, null);
  assert.equal(by.s1.status, 'substituted');
  assert.equal(by.s1.substitution.confidence, 'medium');
  assert.equal(by.s1.dust, 400);
  assert.equal(by.m1.status, 'missing');
  assert.equal(by.m1.dust, 80);
  assert.deepEqual(by.m2.unknown, [999]);
  assert.equal(by.b3.lowData, true);
  assert.equal(by.b4.lowData, true);
  assert.equal(by.b1.lowData, false);
});

test('filters by format and class', () => {
  assert.deepEqual(ids({ format: 'wild' }), []);
  assert.deepEqual(ids({ cardClass: 'WARRIOR' }), ['m1']);
});

test('maxDust hides only missing decks that cost more', () => {
  assert.deepEqual(ids({ maxDust: 50 }), ['b2', 'b1', 'b3', 'b4', 's1', 'm2']);
});

test('a deck whose substitution is low confidence stays missing', () => {
  const a1 = deck('a1', { 101: 2, 104: 1 }, { archetype: 'Spell Mage' });
  const a2 = deck('a2', { 102: 2, 104: 1 }, { archetype: 'Spell Mage' });
  const [first] = recommend({ catalog, collection, decks: [a1, a2], filters: {} }).filter((r) => r.deck.id === 'a1');
  assert.equal(first.status, 'missing');
  assert.equal(first.substitution.confidence, 'low');
});
