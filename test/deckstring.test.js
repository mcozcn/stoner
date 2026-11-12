import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decode, encode } from '../src/deckstring.js';

// Bytes: 0, 1, 2 (standard), 1 hero (7), one x1 card (1), one x2 card (2), no xN, no sideboard.
const SIMPLE = 'AAECAQcBAQECAAA=';

test('decodes a known code', () => {
  assert.deepEqual(decode(SIMPLE), { format: 'standard', heroes: [7], cards: { 1: 1, 2: 2 }, sideboard: [] });
});

test('encodes to the same known code', () => {
  assert.equal(encode({ format: 'standard', heroes: [7], cards: { 1: 1, 2: 2 } }), SIMPLE);
});

test('decodes an older code without the sideboard flag', () => {
  assert.deepEqual(decode('AAECAQcBAQECAA==').cards, { 1: 1, 2: 2 });
});

test('round-trips large ids, three copies and a sideboard', () => {
  const deck = {
    format: 'wild',
    heroes: [637],
    cards: { 2539: 1, 102983: 2, 90749: 1, 40: 3 },
    sideboard: [[111689, 1, 90749], [79767, 2, 90749]],
  };
  assert.deepEqual(decode(encode(deck)), deck);
});

test('reads the code out of a pasted block with comments', () => {
  const pasted = `### My Deck\r\n# Class: Warrior\n#\n${SIMPLE}\n# To use this deck, copy it to your clipboard`;
  assert.deepEqual(decode(pasted).heroes, [7]);
});

test('rejects input with no code', () => {
  assert.throws(() => decode(''), /bulunamadı/);
  assert.throws(() => decode('this is not a code!'), /bulunamadı/);
});

test('rejects a corrupt code', () => {
  assert.throws(() => decode('AAAA'), /bozuk/);
  assert.throws(() => decode('AAEC/////w=='), /bozuk/);
});

test('encode rejects an unknown format', () => {
  assert.throws(() => encode({ format: 'arena', heroes: [7], cards: {} }), /format/);
});
