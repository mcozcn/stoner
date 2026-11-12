import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCatalog } from '../src/catalog.js';
import { analyzeDeck, buildOwned } from '../src/ownership.js';
import { confidenceLevel, coreCards, substitute } from '../src/substitute.js';
import { CARDS, deck } from './helpers.js';

const catalog = createCatalog(CARDS);
const SETS = new Set(['SPACE', 'CORE']);

function run(target, decks, collection, standardSets = SETS) {
  const owned = buildOwned(catalog, collection);
  const { missing } = analyzeDeck(target, catalog, owned);
  return substitute(target, missing, { catalog, owned, decks, standardSets });
}

test('confidenceLevel follows the spec thresholds', () => {
  assert.equal(confidenceLevel(1, false, true), 'high');
  assert.equal(confidenceLevel(2, false, true), 'high');
  assert.equal(confidenceLevel(3, false, true), 'medium');
  assert.equal(confidenceLevel(5, false, true), 'medium');
  assert.equal(confidenceLevel(6, false, true), 'low');
  assert.equal(confidenceLevel(1, true, true), 'low');
  assert.equal(confidenceLevel(1, false, false), 'medium');
});

test('coreCards needs an archetype with at least two lists', () => {
  const a1 = deck('a1', { 101: 2, 104: 1 }, { archetype: 'Spell Mage' });
  const a2 = deck('a2', { 102: 2, 104: 1 }, { archetype: 'Spell Mage' });
  assert.deepEqual([...coreCards(a1, [a1, a2], catalog)], [104]);
  assert.equal(coreCards(a1, [a1], catalog), null);
  assert.equal(coreCards(deck('x', { 101: 1 }), [a1, a2], catalog), null);
});

test('picks the closest owned card for each missing copy', () => {
  const d = deck('d', { 101: 2, 103: 2, 104: 1 });
  const result = run(d, [d], { 101: 2, 103: 1, 106: 2, 105: 2, 201: 2 });
  assert.deepEqual(
    result.swaps.map((s) => [s.out, s.in]),
    [
      [103, 106],
      [104, 106],
    ],
  );
  assert.deepEqual(result.cards, { 101: 2, 103: 1, 106: 2 });
  assert.equal(result.complete, true);
  assert.equal(result.confidence, 'medium');
  assert.equal(result.swaps[0].alternatives[0], 106);
  assert.ok(result.swaps[0].alternatives.length <= 3);
});

test('a missing core card gives low confidence', () => {
  const a1 = deck('a1', { 101: 2, 104: 1 }, { archetype: 'Spell Mage' });
  const a2 = deck('a2', { 102: 2, 104: 1 }, { archetype: 'Spell Mage' });
  const result = run(a1, [a1, a2], { 101: 2, 106: 1 });
  assert.equal(result.confidence, 'low');
  assert.deepEqual(result.coreMissing, [104]);
});

test('a small non-core change with core information gives high confidence', () => {
  const a1 = deck('a1', { 101: 2, 104: 1, 105: 1 }, { archetype: 'Spell Mage' });
  const a2 = deck('a2', { 102: 2, 104: 1 }, { archetype: 'Spell Mage' });
  const result = run(a1, [a1, a2], { 101: 2, 104: 1, 106: 1 });
  assert.equal(result.swaps.length, 1);
  assert.equal(result.confidence, 'high');
  assert.deepEqual(result.coreMissing, []);
});

test('an incomplete substitution is low confidence even with core information', () => {
  const a1 = deck('a1', { 401: 2, 201: 1 }, { archetype: 'Axe Warrior', cardClass: 'WARRIOR' });
  const a2 = deck('a2', { 401: 2, 101: 1 }, { archetype: 'Axe Warrior', cardClass: 'WARRIOR' });
  const result = run(a1, [a1, a2], { 401: 2 });
  assert.equal(result.complete, false);
  assert.equal(result.confidence, 'low');
  assert.deepEqual(result.coreMissing, []);
});

test('reports incomplete when nothing owned can fill the slot', () => {
  const w = deck('w', { 401: 2 }, { cardClass: 'WARRIOR' });
  const result = run(w, [w], {});
  assert.equal(result.complete, false);
  assert.deepEqual(result.swaps, []);
});

test('respects Standard legality and allows Wild cards in Wild', () => {
  const std = deck('s', { 202: 1 });
  assert.equal(run(std, [std], { 203: 2, 201: 1 }).swaps[0].in, 201);
  const wild = deck('w', { 202: 1 }, { format: 'wild' });
  assert.equal(run(wild, [wild], { 203: 2, 201: 1 }).swaps[0].in, 203);
});

test('writes the owned version of a card into the result', () => {
  const d = deck('d', { 102: 1 });
  const result = run(d, [d], {});
  // Only the free Core Fireball is owned; its Core dbfId (301) must be used, not the Legacy one.
  assert.deepEqual(result.cards, { 301: 1 });
});
