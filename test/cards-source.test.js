import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchCards, slimCards } from '../src/sources/cards.js';
import { rawCards, stubFetch } from './helpers.js';

test('slimCards keeps the needed fields and fills defaults', () => {
  const [slim] = slimCards(
    [{ dbfId: 5, id: 'X_1', name: 'Thing', rarity: 'RARE', set: 'SPACE', type: 'SPELL', countAsCopyOfDbfId: 9 }],
    { minCount: 1 },
  );
  assert.deepEqual(slim, {
    dbfId: 5,
    id: 'X_1',
    name: 'Thing',
    cardClass: 'NEUTRAL',
    classes: ['NEUTRAL'],
    cost: 0,
    type: 'SPELL',
    rarity: 'RARE',
    set: 'SPACE',
    races: [],
    spellSchool: null,
    mechanics: [],
    text: '',
    copyOf: 9,
    runeCost: null,
  });
});

test('slimCards uses the multi-class list when present', () => {
  const [slim] = slimCards(
    [{ dbfId: 5, id: 'X', name: 'N', rarity: 'RARE', set: 'S', type: 'SPELL', cardClass: 'MAGE', classes: ['MAGE', 'ROGUE'] }],
    { minCount: 1 },
  );
  assert.deepEqual(slim.classes, ['MAGE', 'ROGUE']);
});

test('slimCards rejects unexpected data', () => {
  assert.throws(() => slimCards({ error: 'nope' }), /beklenen biçimde/);
  assert.throws(() => slimCards(rawCards(10)), /beklenen biçimde/);
});

test('fetchCards downloads and slims', async () => {
  const cards = await fetchCards(stubFetch({ 'hearthstonejson.com': { body: rawCards(1000) } }));
  assert.equal(cards.length, 1000);
  assert.equal(cards[0].copyOf, null);
});

test('fetchCards reports an HTTP failure', async () => {
  await assert.rejects(fetchCards(stubFetch({ 'hearthstonejson.com': { status: 503 } })), /503/);
});

test('slimCards keeps the rune cost of Death Knight cards', () => {
  const runeCost = { blood: 1, frost: 0, unholy: 2 };
  const [slim] = slimCards([{ dbfId: 5, id: 'X', name: 'N', rarity: 'RARE', set: 'S', type: 'MINION', runeCost }], {
    minCount: 1,
  });
  assert.deepEqual(slim.runeCost, runeCost);
});
