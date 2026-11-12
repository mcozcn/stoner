import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCatalog } from '../src/catalog.js';
import { playable, runeTotal, standardSets } from '../src/legality.js';
import { validateDeck } from '../src/validate.js';
import { CARDS, FULL_DECK_CARDS, deck } from './helpers.js';

const catalog = createCatalog(CARDS);
const sets = new Set(['SPACE', 'CORE']);
const mage = (cards, format = 'standard') => ({ format, cardClass: 'MAGE', cards });

test('standardSets collects sets from HSReplay Standard decks only', () => {
  const decks = [
    deck('a', { 101: 2, 301: 1 }),
    deck('w', { 203: 2 }, { format: 'wild' }),
    deck('p', { 302: 2 }, { source: 'pasted' }),
  ];
  assert.deepEqual([...standardSets(catalog, decks)].sort(), ['CORE', 'SPACE']);
  assert.equal(standardSets(catalog, [deck('p', { 101: 1 }, { source: 'pasted' })]), null);
});

test('playable checks class, format and hero skins', () => {
  assert.equal(playable(101, { cardClass: 'MAGE', format: 'standard' }, catalog, sets), true);
  assert.equal(playable(203, { cardClass: 'MAGE', format: 'standard' }, catalog, sets), false);
  assert.equal(playable(203, { cardClass: 'MAGE', format: 'wild' }, catalog, sets), true);
  assert.equal(playable(203, { cardClass: 'MAGE', format: 'standard' }, catalog, null), true);
  assert.equal(playable(401, { cardClass: 'MAGE', format: 'wild' }, catalog, sets), false);
  assert.equal(playable(302, { cardClass: 'MAGE', format: 'standard' }, catalog, sets), true);
  assert.equal(playable(637, { cardClass: 'MAGE', format: 'wild' }, catalog, sets), false);
});

test('validateDeck accepts a legal 30-card deck', () => {
  assert.deepEqual(validateDeck(mage(FULL_DECK_CARDS), catalog, sets), []);
});

test('validateDeck reports each kind of problem', () => {
  const has = (cards, pattern, format) =>
    assert.ok(
      validateDeck(mage(cards, format), catalog, sets).some((p) => pattern.test(p)),
      `expected a problem matching ${pattern}`,
    );
  has({ ...FULL_DECK_CARDS, 101: 1 }, /30 kart/);
  has({ ...FULL_DECK_CARDS, 101: 3 }, /en fazla 2/);
  has({ ...FULL_DECK_CARDS, 104: 2 }, /en fazla 1/);
  has({ ...FULL_DECK_CARDS, 401: 2 }, /sınıfta/);
  has({ ...FULL_DECK_CARDS, 203: 2 }, /Standard/);
  has({ ...FULL_DECK_CARDS, 999: 1 }, /Bilinmeyen kart/);
});

test('validateDeck allows Wild-only cards in a Wild deck', () => {
  const cards = { ...FULL_DECK_CARDS, 101: 0, 203: 2 };
  delete cards[101];
  assert.deepEqual(validateDeck(mage(cards, 'wild'), catalog, sets), []);
});

test('runeTotal sums the highest requirement of each rune', () => {
  const cards = (...ids) => ids.map((id) => catalog.card(id));
  assert.equal(runeTotal([]), 0);
  assert.equal(runeTotal(cards(101, 201)), 0);
  assert.equal(runeTotal(cards(601, 603)), 2);
  assert.equal(runeTotal(cards(601, 602)), 4);
  assert.equal(runeTotal(cards(601, 602, 605)), 5);
});

test('validateDeck reports an exceeded rune limit', () => {
  const dk = { format: 'standard', cardClass: 'DEATHKNIGHT', cards: { 601: 2, 602: 2 } };
  assert.ok(validateDeck(dk, catalog, sets).includes('Rün sınırı aşıldı (en fazla 3)'));
  const ok = { ...dk, cards: { 601: 2, 603: 2 } };
  assert.equal(validateDeck(ok, catalog, sets).some((p) => /Rün/.test(p)), false);
});
