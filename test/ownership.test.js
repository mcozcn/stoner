import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCatalog } from '../src/catalog.js';
import { analyzeDeck, buildOwned } from '../src/ownership.js';
import { CARDS, deck } from './helpers.js';

const catalog = createCatalog(CARDS);

test('buildOwned caps counts at the copy limit', () => {
  const owned = buildOwned(catalog, { 101: 5, 104: 3 });
  assert.equal(owned.counts.get(101), 2);
  assert.equal(owned.counts.get(104), 1);
});

test('buildOwned treats Core cards as owned even when absent', () => {
  const owned = buildOwned(catalog, {});
  assert.equal(owned.counts.get(302), 2);
  assert.equal(owned.concrete.get(302), 301);
});

test('buildOwned merges copies under the canonical id and remembers an owned version', () => {
  const owned = buildOwned(catalog, { 301: 1 });
  assert.equal(owned.counts.get(302), 2);
  assert.equal(owned.concrete.get(302), 301);
});

test('buildOwned ignores unknown ids and non-positive counts', () => {
  const owned = buildOwned(catalog, { 999: 2, 101: 0 });
  assert.equal(owned.counts.has(999), false);
  assert.equal(owned.counts.has(101), false);
});

test('analyzeDeck lists missing copies and their dust cost', () => {
  const owned = buildOwned(catalog, { 101: 1, 103: 2 });
  const result = analyzeDeck(deck('d', { 101: 2, 103: 2, 104: 1, 301: 2 }), catalog, owned);
  assert.deepEqual(result.missing, [
    { dbfId: 101, count: 1 },
    { dbfId: 104, count: 1 },
  ]);
  assert.equal(result.dust, 40 + 1600);
  assert.deepEqual(result.unknown, []);
});

test('analyzeDeck reports cards missing from the card data', () => {
  const result = analyzeDeck(deck('d', { 999: 1 }), catalog, buildOwned(catalog, {}));
  assert.deepEqual(result.unknown, [999]);
  assert.deepEqual(result.missing, []);
});

test('buildOwned prefers the Core id when the collection also lists the Wild-only printing', () => {
  const owned = buildOwned(catalog, { 302: 1, 301: 1 });
  assert.equal(owned.concrete.get(302), 301);
  assert.equal(buildOwned(catalog, { 302: 2 }).concrete.get(302), 301);
});
