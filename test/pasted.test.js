import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createCatalog } from '../src/catalog.js';
import { encode } from '../src/deckstring.js';
import { addPasted, deckFromCode, listPasted, removePasted } from '../src/sources/decks-pasted.js';
import { createStore } from '../src/store.js';
import { CARDS } from './helpers.js';

const catalog = createCatalog(CARDS);
const code = encode({ format: 'standard', heroes: [637], cards: { 101: 2, 104: 1 } });

test('deckFromCode builds a pasted deck', () => {
  const d = deckFromCode(code, catalog);
  assert.match(d.id, /^pasted:[0-9a-f]{12}$/);
  assert.equal(d.source, 'pasted');
  assert.equal(d.cardClass, 'MAGE');
  assert.equal(d.format, 'standard');
  assert.deepEqual(d.cards, { 101: 2, 104: 1 });
  assert.equal(d.winRate, null);
  assert.equal(d.games, null);
  assert.equal(d.name, 'Yapıştırılan MAGE destesi');
});

test('deckFromCode reads the name from a pasted block', () => {
  assert.equal(deckFromCode(`### Aggro Mage\n# Class: Mage\n${code}`, catalog).name, 'Aggro Mage');
});

test('deckFromCode falls back to the cards when the hero is unknown', () => {
  const skin = encode({ format: 'wild', heroes: [123456], cards: { 101: 2, 201: 2 } });
  assert.equal(deckFromCode(skin, catalog).cardClass, 'MAGE');
});

test('deckFromCode rejects cards missing from the card data', () => {
  const stale = encode({ format: 'standard', heroes: [637], cards: { 999: 1 } });
  assert.throws(() => deckFromCode(stale, catalog), /bilinmeyen kart/);
});

test('add, list and remove pasted decks without duplicates', () => {
  const store = createStore(mkdtempSync(join(tmpdir(), 'stoner-')));
  const d = deckFromCode(code, catalog);
  addPasted(store, d);
  addPasted(store, d);
  assert.equal(listPasted(store).length, 1);
  assert.equal(removePasted(store, d.id), true);
  assert.equal(removePasted(store, d.id), false);
  assert.deepEqual(listPasted(store), []);
});
