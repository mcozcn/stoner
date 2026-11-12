import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCatalog } from '../src/catalog.js';
import { CARDS } from './helpers.js';

const catalog = createCatalog(CARDS);

test('card looks up by number or numeric string', () => {
  assert.equal(catalog.card(101).name, 'Arcane Bolt');
  assert.equal(catalog.card('101').name, 'Arcane Bolt');
  assert.equal(catalog.card(999), null);
});

test('canonical maps a copy to its original', () => {
  assert.equal(catalog.canonical(301), 302);
  assert.equal(catalog.canonical(302), 302);
  assert.equal(catalog.canonical(999), null);
  assert.deepEqual(catalog.group(302).map((c) => c.dbfId).sort(), [301, 302]);
});

test('free cards are those with a Core version', () => {
  assert.equal(catalog.isFree(302), true);
  assert.equal(catalog.isFree(101), false);
});

test('copy limits follow rarity', () => {
  assert.equal(catalog.maxCopies(104), 1);
  assert.equal(catalog.maxCopies(101), 2);
});

test('heroFor returns the base hero of a class', () => {
  assert.equal(catalog.heroFor('MAGE'), 637);
  assert.equal(catalog.heroFor('PRIEST'), null);
});

test('fitsClass accepts own class and neutral only', () => {
  assert.equal(catalog.fitsClass(101, 'MAGE'), true);
  assert.equal(catalog.fitsClass(201, 'MAGE'), true);
  assert.equal(catalog.fitsClass(401, 'MAGE'), false);
});
