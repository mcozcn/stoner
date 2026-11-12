import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shape } from '../scripts/probe-hsreplay.js';

test('shape describes structure without leaking values', () => {
  const described = shape({ battletag: 'Secret#1234', account_lo: 99, list: [{ id: 5 }], flag: true, none: null });
  assert.deepEqual(described, {
    battletag: 'string',
    account_lo: 'number',
    list: ['array(1)', { id: 'number' }],
    flag: 'boolean',
    none: 'null',
  });
  assert.equal(JSON.stringify(described).includes('Secret'), false);
});

test('shape limits keys and depth', () => {
  const wide = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
  assert.deepEqual(shape(wide), { '<20 anahtar>': 'number' });
  const eight = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`k${i}`, i]));
  assert.equal(Object.keys(shape(eight)).length, 8);
  assert.equal(shape({ a: { b: { c: { d: 1 } } } }).a.b.c, 'object');
});

test('shape never prints the keys of a large object such as a collection', () => {
  const ids = Array.from({ length: 20 }, (_, i) => String(41000 + i * 7));
  const collection = { collection: Object.fromEntries(ids.map((id) => [id, [2, 0]])) };
  const text = JSON.stringify(shape(collection));
  for (const id of ids) assert.equal(text.includes(id), false);
  assert.deepEqual(shape(collection), { collection: { '<20 anahtar>': ['array(2)', 'number'] } });
});
