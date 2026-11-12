import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createStore } from '../src/store.js';

const tempDir = () => mkdtempSync(join(tmpdir(), 'stoner-'));

test('read returns the fallback when the file does not exist', () => {
  const store = createStore(join(tempDir(), 'missing'));
  assert.deepEqual(store.read('cards', []), []);
  assert.equal(store.read('cards'), null);
});

test('write then read round-trips and leaves no temp file', () => {
  const dir = join(tempDir(), 'nested');
  const store = createStore(dir);
  store.write('decks', [{ id: 'a' }]);
  store.write('decks', [{ id: 'b' }]);
  assert.deepEqual(store.read('decks'), [{ id: 'b' }]);
  assert.deepEqual(readdirSync(dir), ['decks.json']);
});

test('read throws on corrupt JSON instead of hiding it', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'bad.json'), '{oops');
  assert.throws(() => createStore(dir).read('bad', []), SyntaxError);
});
