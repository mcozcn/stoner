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
  assert.equal(Object.keys(shape(wide)).length, 9);
  assert.equal(shape(wide)['…'], '+12 anahtar');
  assert.equal(shape({ a: { b: { c: { d: 1 } } } }).a.b.c, 'object');
});
