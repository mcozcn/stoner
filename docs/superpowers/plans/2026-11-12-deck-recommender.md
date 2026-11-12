# Stoner Deck Recommender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web app that tells a Hearthstone player which current meta decks they can build from their own collection, fills missing cards with owned substitutes, and refreshes all its data with one button.

**Architecture:** One Node process serving a static page and a small JSON API on `127.0.0.1:4717`. Three network sources (cards, collection, meta decks) write JSON files under `data/`; a pure recommendation engine reads those files and never touches the network. HSReplay is reached only through source adapters, so it can be replaced.

**Tech Stack:** Node.js >= 22, ES modules, `node:http`, built-in `fetch`, `node:test`. No runtime or dev dependencies. Plain HTML/CSS/JS front end.

**Spec:** `docs/superpowers/specs/2026-11-12-deck-recommender-design.md`

## Global Constraints

- Node.js >= 22. Zero npm dependencies; do not add any.
- ES modules everywhere (`"type": "module"`).
- Target machine is Windows; development machine is macOS. Use `node:path` for paths, never hard-code separators.
- The server binds to `127.0.0.1` only, port `4717`.
- User-facing strings (UI text, error messages) are Turkish. Identifiers and code comments are English.
- The HSReplay session cookie is sent only to `hsreplay.net` and is never logged or written anywhere except `config.local.json`.
- `data/` and `config.local.json` are git-ignored.
- Tests never touch the network; sources take a `fetchImpl` parameter and tests pass a stub.
- `hsreplay.net` is blocked on the development network. Do not try to reach it; live verification happens on the Windows machine (Task 10).
- Run tests with `npm test`. All tests must pass before each commit.
- End every commit message with: `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`

## Deviations from the spec (decided while planning)

- Pasted decks live in `data/pasted.json`, separate from `data/decks.json`, so an update never erases them.
- An extra route `GET /api/owned` lists owned, playable cards for the swap dialog.
- Recommendations are capped at 50 per request.
- HSReplay endpoints cannot be verified first (network block), so the probe script is the last task and is run by the user on Windows.
- Card data contains "copy" cards (`countAsCopyOfDbfId`, e.g. Core reprints). Ownership is computed per canonical card, so owning either version counts.

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `.gitignore`, `.gitattributes` | Project scaffold |
| `src/store.js` | Read / atomically write `data/*.json` |
| `src/config.js` | Read `config.local.json` |
| `src/deckstring.js` | Decode / encode Hearthstone deck codes |
| `src/catalog.js` | Card lookup, canonical ids, copy limits, class fit |
| `src/ownership.js` | Owned counts, missing cards, dust cost |
| `src/legality.js` | Standard set detection, format and class legality |
| `src/validate.js` | Deck validity problems |
| `src/substitute.js` | Substitutes, core cards, confidence |
| `src/recommend.js` | Status, filters, ordering |
| `src/sources/cards.js` | HearthstoneJSON download |
| `src/sources/hsreplay-http.js` | Shared HSReplay GET helper |
| `src/sources/collection.js` | HSReplay collection |
| `src/sources/decks-hsreplay.js` | HSReplay meta decks |
| `src/sources/decks-pasted.js` | Pasted deck codes |
| `src/update.js` | Run sources, record per-source status |
| `server.js` | HTTP API and static files |
| `public/index.html`, `public/app.js`, `public/style.css` | UI |
| `start.bat` | Windows launcher |
| `scripts/probe-hsreplay.js` | Live endpoint check on Windows |
| `README.md` | Windows setup guide (Turkish) |
| `test/helpers.js`, `test/*.test.js` | Tests |

---

### Task 1: Scaffold and JSON store

**Files:**
- Create: `package.json`, `.gitignore`, `.gitattributes`, `src/store.js`
- Test: `test/store.test.js`

**Interfaces:**
- Produces: `createStore(dir)` returning `{ read(name, fallback = null), write(name, value) }`. `name` has no extension; the file is `<dir>/<name>.json`.

- [ ] **Step 1: Create scaffold files**

`package.json`:

```json
{
  "name": "stoner",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "node server.js --open",
    "test": "node --test \"test/*.test.js\""
  }
}
```

`.gitignore`:

```
data/
config.local.json
node_modules/
```

`.gitattributes`:

```
* text=auto
*.bat text eol=crlf
```

- [ ] **Step 2: Write the failing test**

`test/store.test.js`:

```js
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find module `../src/store.js`.

- [ ] **Step 4: Implement**

`src/store.js`:

```js
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function createStore(dir) {
  const file = (name) => join(dir, `${name}.json`);
  return {
    read(name, fallback = null) {
      try {
        return JSON.parse(readFileSync(file(name), 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT') return fallback;
        throw err;
      }
    },
    // Write to a temp file first so a crash never leaves a half-written file.
    write(name, value) {
      mkdirSync(dir, { recursive: true });
      const tmp = `${file(name)}.tmp`;
      writeFileSync(tmp, JSON.stringify(value));
      renameSync(tmp, file(name));
    },
  };
}
```

- [ ] **Step 5: Run tests, expect PASS, then commit**

```bash
npm test
git add package.json .gitignore .gitattributes src/store.js test/store.test.js
git commit -m "Add project scaffold and JSON store"
```

---

### Task 2: Deck codes

**Files:**
- Create: `src/deckstring.js`
- Test: `test/deckstring.test.js`

**Interfaces:**
- Produces:
  - `FORMATS`: `['wild', 'standard', 'classic', 'twist']`
  - `decode(input: string)` returns `{ format, heroes: number[], cards: { [dbfId]: count }, sideboard: [dbfId, count, ownerDbfId][] }`. `input` may be a full pasted block; lines starting with `#` are ignored. Throws `Error('Deste kodu bulunamadı')` or `Error('Deste kodu bozuk')`.
  - `encode({ format, heroes, cards, sideboard = [] })` returns the code string.

Background: a deck code is base64 over a list of varints: `0`, version `1`, format id (1 wild, 2 standard, 3 classic, 4 twist), hero count + hero dbfIds, then three card groups (1 copy, 2 copies, n copies as `[dbfId, count]` pairs), then a sideboard flag (`0` or `1`) followed by three sideboard groups (`[dbfId, owner]`, `[dbfId, owner]`, `[dbfId, count, owner]`). Older codes end before the sideboard flag.

- [ ] **Step 1: Write the failing test**

`test/deckstring.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find module `../src/deckstring.js`.

- [ ] **Step 3: Implement**

`src/deckstring.js`:

```js
const FORMAT_IDS = { wild: 1, standard: 2, classic: 3, twist: 4 };
const FORMAT_NAMES = Object.fromEntries(Object.entries(FORMAT_IDS).map(([name, id]) => [id, name]));
export const FORMATS = Object.keys(FORMAT_IDS);

const BAD = 'Deste kodu bozuk';

function extract(input) {
  const line = String(input ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  if (!line || !/^[A-Za-z0-9+/]+={0,2}$/.test(line)) throw new Error('Deste kodu bulunamadı');
  return line;
}

export function decode(input) {
  const bytes = Buffer.from(extract(input), 'base64');
  let pos = 0;
  const read = () => {
    let value = 0;
    let shift = 0;
    for (;;) {
      if (pos >= bytes.length || shift > 28) throw new Error(BAD);
      const byte = bytes[pos];
      pos += 1;
      value += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) return value;
      shift += 7;
    }
  };
  // A length prefix can never exceed the remaining bytes; this stops huge allocations.
  const many = (readItem) => {
    const n = read();
    if (n > bytes.length) throw new Error(BAD);
    return Array.from({ length: n }, readItem);
  };

  if (read() !== 0 || read() !== 1) throw new Error(BAD);
  const format = FORMAT_NAMES[read()];
  if (!format) throw new Error(BAD);
  const heroes = many(read);
  const cards = {};
  const add = (id, n) => {
    cards[id] = (cards[id] ?? 0) + n;
  };
  many(read).forEach((id) => add(id, 1));
  many(read).forEach((id) => add(id, 2));
  many(() => [read(), read()]).forEach(([id, n]) => add(id, n));

  let sideboard = [];
  if (pos < bytes.length && read() === 1) {
    // A sideboard we cannot parse must not make the whole deck unusable.
    try {
      const one = many(() => [read(), read()]).map(([id, owner]) => [id, 1, owner]);
      const two = many(() => [read(), read()]).map(([id, owner]) => [id, 2, owner]);
      const more = many(() => [read(), read(), read()]);
      sideboard = [...one, ...two, ...more];
    } catch {
      sideboard = [];
    }
  }
  return { format, heroes, cards, sideboard };
}

export function encode({ format, heroes, cards, sideboard = [] }) {
  if (!FORMAT_IDS[format]) throw new Error(`Bilinmeyen format: ${format}`);
  const out = [];
  const write = (value) => {
    let v = value;
    while (v > 0x7f) {
      out.push((v % 128) | 0x80);
      v = Math.floor(v / 128);
    }
    out.push(v);
  };
  // Entries are [dbfId, count, ...]; bucket 3 means "more than two copies".
  const bucket = (list, n) =>
    list.filter((entry) => (n === 3 ? entry[1] > 2 : entry[1] === n)).sort((a, b) => a[0] - b[0]);
  const entries = Object.entries(cards).map(([id, n]) => [Number(id), n]);

  [0, 1, FORMAT_IDS[format], heroes.length, ...heroes].forEach(write);
  for (const n of [1, 2]) {
    const group = bucket(entries, n);
    write(group.length);
    group.forEach(([id]) => write(id));
  }
  const rest = bucket(entries, 3);
  write(rest.length);
  rest.forEach(([id, n]) => [id, n].forEach(write));

  if (!sideboard.length) {
    write(0);
  } else {
    write(1);
    for (const n of [1, 2]) {
      const group = bucket(sideboard, n);
      write(group.length);
      group.forEach(([id, , owner]) => [id, owner].forEach(write));
    }
    const more = bucket(sideboard, 3);
    write(more.length);
    more.forEach((entry) => entry.forEach(write));
  }
  return Buffer.from(out).toString('base64');
}
```

- [ ] **Step 4: Run tests, expect PASS, then commit**

```bash
npm test
git add src/deckstring.js test/deckstring.test.js
git commit -m "Add deck code decoder and encoder"
```

---

### Task 3: Card catalog and card source

**Files:**
- Create: `src/catalog.js`, `src/sources/cards.js`, `test/helpers.js`
- Test: `test/catalog.test.js`, `test/cards-source.test.js`

**Interfaces:**
- Produces:
  - Slim card shape: `{ dbfId, id, name, cardClass, classes: string[], cost, type, rarity, set, races: string[], spellSchool: string|null, mechanics: string[], text, copyOf: number|null }`
  - `slimCards(raw, { minCount = 1000 } = {})` returns slim cards; throws `Error('Kart verisi beklenen biçimde değil')`.
  - `fetchCards(fetchImpl = fetch)` returns slim cards.
  - `createCatalog(cards)` returning:
    - `card(dbfId)`: slim card or `null` (accepts number or numeric string)
    - `canonical(dbfId)`: canonical dbfId (the `copyOf` target when it exists) or `null` if unknown
    - `group(canon)`: all cards sharing that canonical id
    - `canonicalIds()`: array of canonical ids
    - `heroFor(cardClass)`: dbfId of the base hero (`HERO_NN`) or `null`
    - `isFree(canon)`: true when any card in the group is in set `CORE`
    - `maxCopies(canon)`: 1 for `LEGENDARY`, else 2
    - `fitsClass(canon, cardClass)`: card belongs to that class or is `NEUTRAL`
  - Test helpers in `test/helpers.js`: `card(...)`, `CARDS`, `FULL_DECK_CARDS`, `deck(id, cards, extra)`, `rawCards(n)`, `stubFetch(routes)`.

Facts verified against the live HearthstoneJSON file: cards have `dbfId`, `id`, `name`, `rarity` (`FREE|COMMON|RARE|EPIC|LEGENDARY`), `set`, `type` (`MINION|SPELL|WEAPON|HERO|LOCATION`); optional `cardClass`, `classes` (multi-class), `cost`, `races`, `spellSchool`, `mechanics`, `text`, `countAsCopyOfDbfId`. Hero skins are `type: HERO, set: HERO_SKINS`; base heroes have ids like `HERO_01` (dbfId 7, WARRIOR). Core set cards have `set: CORE`.

- [ ] **Step 1: Write test helpers**

`test/helpers.js`:

```js
export function card(dbfId, name, cardClass, cost, type, rarity, set, extra = {}) {
  return {
    dbfId,
    id: `T_${dbfId}`,
    name,
    cardClass,
    classes: [cardClass],
    cost,
    type,
    rarity,
    set,
    races: [],
    spellSchool: null,
    mechanics: [],
    text: '',
    copyOf: null,
    ...extra,
  };
}

// A tiny card universe. SPACE and CORE stand in for Standard sets, GVG and LEGACY for Wild-only sets.
export const CARDS = [
  card(7, 'Garrosh', 'WARRIOR', 0, 'HERO', 'FREE', 'HERO_SKINS', { id: 'HERO_01' }),
  card(637, 'Jaina', 'MAGE', 0, 'HERO', 'FREE', 'HERO_SKINS', { id: 'HERO_08' }),
  card(101, 'Arcane Bolt', 'MAGE', 1, 'SPELL', 'COMMON', 'SPACE', { spellSchool: 'ARCANE' }),
  card(102, 'Frost Ring', 'MAGE', 2, 'SPELL', 'RARE', 'SPACE', { spellSchool: 'FROST' }),
  card(103, 'Star Mage', 'MAGE', 3, 'MINION', 'EPIC', 'SPACE', { mechanics: ['BATTLECRY'] }),
  card(104, 'Archmage Prime', 'MAGE', 5, 'MINION', 'LEGENDARY', 'SPACE'),
  card(105, 'Arcane Dart', 'MAGE', 1, 'SPELL', 'COMMON', 'SPACE', { spellSchool: 'ARCANE' }),
  card(106, 'Apprentice', 'MAGE', 3, 'MINION', 'COMMON', 'SPACE', { mechanics: ['BATTLECRY'] }),
  card(201, 'Space Rat', 'NEUTRAL', 1, 'MINION', 'COMMON', 'SPACE'),
  card(202, 'Void Trader', 'NEUTRAL', 3, 'MINION', 'RARE', 'SPACE'),
  card(203, 'Old Mech', 'NEUTRAL', 3, 'MINION', 'COMMON', 'GVG'),
  card(301, 'Fireball', 'MAGE', 4, 'SPELL', 'COMMON', 'CORE', { copyOf: 302 }),
  card(302, 'Fireball', 'MAGE', 4, 'SPELL', 'COMMON', 'LEGACY'),
  card(401, 'War Axe', 'WARRIOR', 2, 'WEAPON', 'COMMON', 'SPACE'),
  ...Array.from({ length: 12 }, (_, i) =>
    card(500 + i, `Filler ${i}`, 'NEUTRAL', (i % 6) + 1, 'MINION', 'COMMON', 'SPACE'),
  ),
];

// A valid 30-card Standard Mage list: 12 fillers x2 plus three Mage cards x2.
export const FULL_DECK_CARDS = {
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [500 + i, 2])),
  101: 2,
  102: 2,
  103: 2,
};

export function deck(id, cards, extra = {}) {
  return {
    id,
    source: 'hsreplay',
    name: id,
    archetype: null,
    cardClass: 'MAGE',
    format: 'standard',
    cards,
    winRate: 55,
    games: 1000,
    ...extra,
  };
}

// Raw HearthstoneJSON-shaped cards, enough to pass the minimum-count check.
export function rawCards(n = 1000) {
  return Array.from({ length: n }, (_, i) => ({
    dbfId: i + 1,
    id: `RAW_${i + 1}`,
    name: `Raw ${i + 1}`,
    rarity: 'COMMON',
    set: 'SPACE',
    type: 'MINION',
    cardClass: 'NEUTRAL',
    cost: 1,
  }));
}

// routes: { 'substring of url': { status?: number, body: any } }. First matching key wins.
export function stubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const hit = Object.entries(routes).find(([key]) => String(url).includes(key));
    const { status = 200, body = {} } = hit ? hit[1] : { status: 404 };
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}
```

- [ ] **Step 2: Write the failing tests**

`test/catalog.test.js`:

```js
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
```

`test/cards-source.test.js`:

```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, cannot find modules `../src/catalog.js` and `../src/sources/cards.js`.

- [ ] **Step 4: Implement**

`src/catalog.js`:

```js
const BASE_HERO = /^HERO_\d\d$/;

export function createCatalog(cards) {
  const byId = new Map(cards.map((c) => [c.dbfId, c]));

  const canonical = (dbfId) => {
    const card = byId.get(Number(dbfId));
    if (!card) return null;
    return card.copyOf && byId.has(card.copyOf) ? card.copyOf : card.dbfId;
  };

  const groups = new Map();
  const heroes = new Map();
  for (const card of cards) {
    const key = canonical(card.dbfId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
    if (BASE_HERO.test(card.id)) heroes.set(card.cardClass, card.dbfId);
  }

  return {
    card: (dbfId) => byId.get(Number(dbfId)) ?? null,
    canonical,
    group: (canon) => groups.get(canon) ?? [],
    canonicalIds: () => [...groups.keys()],
    heroFor: (cardClass) => heroes.get(cardClass) ?? null,
    isFree: (canon) => (groups.get(canon) ?? []).some((c) => c.set === 'CORE'),
    maxCopies: (canon) => (byId.get(canon)?.rarity === 'LEGENDARY' ? 1 : 2),
    fitsClass: (canon, cardClass) => {
      const classes = byId.get(canon)?.classes ?? [];
      return classes.includes(cardClass) || classes.includes('NEUTRAL');
    },
  };
}
```

`src/sources/cards.js`:

```js
const CARDS_URL = 'https://api.hearthstonejson.com/v1/latest/enUS/cards.collectible.json';

export function slimCards(raw, { minCount = 1000 } = {}) {
  if (!Array.isArray(raw) || raw.length < minCount) throw new Error('Kart verisi beklenen biçimde değil');
  return raw
    .filter((c) => Number.isInteger(c.dbfId))
    .map((c) => ({
      dbfId: c.dbfId,
      id: c.id,
      name: c.name,
      cardClass: c.cardClass ?? 'NEUTRAL',
      classes: c.classes ?? [c.cardClass ?? 'NEUTRAL'],
      cost: c.cost ?? 0,
      type: c.type,
      rarity: c.rarity,
      set: c.set,
      races: c.races ?? [],
      spellSchool: c.spellSchool ?? null,
      mechanics: c.mechanics ?? [],
      text: c.text ?? '',
      copyOf: c.countAsCopyOfDbfId ?? null,
    }));
}

export async function fetchCards(fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(CARDS_URL, { signal: AbortSignal.timeout(60000) });
  } catch (err) {
    throw new Error(`Kart verisine bağlanılamadı (${err.message})`);
  }
  if (!res.ok) throw new Error(`Kart verisi ${res.status} yanıtı verdi`);
  return slimCards(await res.json());
}
```

- [ ] **Step 5: Run tests, expect PASS, then commit**

```bash
npm test
git add src/catalog.js src/sources/cards.js test/helpers.js test/catalog.test.js test/cards-source.test.js
git commit -m "Add card catalog and HearthstoneJSON source"
```

---

### Task 4: Ownership, legality and deck validation

**Files:**
- Create: `src/ownership.js`, `src/legality.js`, `src/validate.js`
- Test: `test/ownership.test.js`, `test/legality.test.js`

**Interfaces:**
- Consumes: `createCatalog` (Task 3).
- Produces:
  - `DUST`: `{ COMMON: 40, RARE: 100, EPIC: 400, LEGENDARY: 1600 }`
  - `buildOwned(catalog, collection)` returns `{ counts: Map<canon, number>, concrete: Map<canon, dbfId> }`. `collection` is `{ [dbfId]: count }`. Counts are capped at `maxCopies`; free (Core) cards always count as `maxCopies`. `concrete` is a dbfId of a version the player really has, used when writing deck codes.
  - `analyzeDeck(deck, catalog, owned)` returns `{ missing: { dbfId: canon, count }[], unknown: number[], dust: number }`.
  - `standardSets(catalog, decks)` returns `Set<string> | null`: the sets seen in HSReplay Standard decks, `null` when there are none.
  - `inFormat(canon, format, catalog, sets)` returns boolean.
  - `playable(canon, { cardClass, format }, catalog, sets)` returns boolean (not a hero skin, fits class, in format).
  - `validateDeck({ format, cardClass, cards }, catalog, sets)` returns `string[]` of Turkish problems; empty means valid.

- [ ] **Step 1: Write the failing tests**

`test/ownership.test.js`:

```js
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
```

`test/legality.test.js`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCatalog } from '../src/catalog.js';
import { playable, standardSets } from '../src/legality.js';
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, cannot find modules `../src/ownership.js`, `../src/legality.js`, `../src/validate.js`.

- [ ] **Step 3: Implement**

`src/ownership.js`:

```js
export const DUST = { COMMON: 40, RARE: 100, EPIC: 400, LEGENDARY: 1600 };

export function buildOwned(catalog, collection) {
  const counts = new Map();
  const concrete = new Map();
  for (const [id, n] of Object.entries(collection ?? {})) {
    const canon = catalog.canonical(id);
    if (canon === null || !(n > 0)) continue;
    counts.set(canon, (counts.get(canon) ?? 0) + n);
    if (!concrete.has(canon)) concrete.set(canon, Number(id));
  }
  for (const canon of catalog.canonicalIds()) {
    const max = catalog.maxCopies(canon);
    if (catalog.isFree(canon)) {
      // Core cards are granted to every account.
      counts.set(canon, max);
      if (!concrete.has(canon)) concrete.set(canon, catalog.group(canon).find((c) => c.set === 'CORE').dbfId);
    } else if (counts.has(canon)) {
      counts.set(canon, Math.min(counts.get(canon), max));
    }
  }
  return { counts, concrete };
}

export function analyzeDeck(deck, catalog, owned) {
  const wanted = new Map();
  const unknown = [];
  for (const [id, n] of Object.entries(deck.cards)) {
    const canon = catalog.canonical(id);
    if (canon === null) unknown.push(Number(id));
    else wanted.set(canon, (wanted.get(canon) ?? 0) + n);
  }
  const missing = [];
  let dust = 0;
  for (const [canon, n] of wanted) {
    const short = n - (owned.counts.get(canon) ?? 0);
    if (short <= 0) continue;
    missing.push({ dbfId: canon, count: short });
    dust += short * (DUST[catalog.card(canon).rarity] ?? 0);
  }
  return { missing, unknown, dust };
}
```

`src/legality.js`:

```js
// Standard rotation is not in the card data, so learn the legal sets from live Standard decks.
export function standardSets(catalog, decks) {
  const sets = new Set();
  for (const deck of decks) {
    if (deck.source !== 'hsreplay' || deck.format !== 'standard') continue;
    for (const id of Object.keys(deck.cards)) {
      const card = catalog.card(id);
      if (card) sets.add(card.set);
    }
  }
  return sets.size ? sets : null;
}

export function inFormat(canon, format, catalog, sets) {
  if (format !== 'standard' || !sets) return true;
  return catalog.group(canon).some((c) => sets.has(c.set));
}

export function playable(canon, { cardClass, format }, catalog, sets) {
  const card = catalog.card(canon);
  if (!card || card.set === 'HERO_SKINS') return false;
  return catalog.fitsClass(canon, cardClass) && inFormat(canon, format, catalog, sets);
}
```

`src/validate.js`:

```js
import { inFormat } from './legality.js';

export function validateDeck({ format, cardClass, cards }, catalog, sets) {
  const problems = [];
  const perCanon = new Map();
  let total = 0;
  for (const [id, n] of Object.entries(cards)) {
    const canon = catalog.canonical(id);
    if (canon === null) {
      problems.push(`Bilinmeyen kart: ${id}`);
      continue;
    }
    total += n;
    perCanon.set(canon, (perCanon.get(canon) ?? 0) + n);
  }
  if (total !== 30) problems.push(`Deste 30 kart olmalı (şu an ${total})`);
  for (const [canon, n] of perCanon) {
    const { name } = catalog.card(canon);
    const max = catalog.maxCopies(canon);
    if (n > max) problems.push(`${name}: en fazla ${max} kopya olabilir`);
    if (!catalog.fitsClass(canon, cardClass)) problems.push(`${name}: bu sınıfta kullanılamaz`);
    if (!inFormat(canon, format, catalog, sets)) problems.push(`${name}: Standard'da geçerli değil`);
  }
  return problems;
}
```

- [ ] **Step 4: Run tests, expect PASS, then commit**

```bash
npm test
git add src/ownership.js src/legality.js src/validate.js test/ownership.test.js test/legality.test.js
git commit -m "Add ownership, legality and deck validation"
```

---

### Task 5: Substitutes and confidence

**Files:**
- Create: `src/substitute.js`
- Test: `test/substitute.test.js`

**Interfaces:**
- Consumes: `createCatalog` (Task 3); `buildOwned`, `analyzeDeck` (Task 4); `playable` (Task 4).
- Produces:
  - `coreCards(deck, decks, catalog)` returns `Set<canon> | null`. Core means present in at least 90% of lists with the same `archetype`, `cardClass` and `format`. `null` when the deck has no archetype or fewer than 2 such lists exist.
  - `confidenceLevel(swapCount, coreMissing, hasCoreInfo)` returns `'high' | 'medium' | 'low'`.
  - `substitute(deck, missing, { catalog, owned, decks, standardSets })` returns `{ swaps: { out, in, alternatives: number[] }[], complete: boolean, cards: { [dbfId]: count }, confidence, coreMissing: number[] }`. One swap per missing copy. `cards` is the resulting deck list.

Confidence rules (from the spec): `low` when a core card is missing or more than 5 copies changed; `high` when at most 2 copies changed, none core, and core information exists; otherwise `medium`.

- [ ] **Step 1: Write the failing test**

`test/substitute.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find module `../src/substitute.js`.

- [ ] **Step 3: Implement**

`src/substitute.js`:

```js
import { playable } from './legality.js';

export const CORE_SHARE = 0.9;

const canonSet = (cards, catalog) =>
  new Set(
    Object.keys(cards)
      .map((id) => catalog.canonical(id))
      .filter((c) => c !== null),
  );

export function coreCards(deck, decks, catalog) {
  if (!deck.archetype) return null;
  const lists = decks.filter(
    (d) => d.archetype === deck.archetype && d.cardClass === deck.cardClass && d.format === deck.format,
  );
  if (lists.length < 2) return null;
  const seen = new Map();
  for (const list of lists) {
    for (const canon of canonSet(list.cards, catalog)) seen.set(canon, (seen.get(canon) ?? 0) + 1);
  }
  const core = new Set();
  for (const [canon, n] of seen) if (n / lists.length >= CORE_SHARE) core.add(canon);
  return core;
}

export function confidenceLevel(swapCount, coreMissing, hasCoreInfo) {
  if (coreMissing || swapCount > 5) return 'low';
  if (swapCount <= 2 && hasCoreInfo) return 'high';
  return 'medium';
}

// Share of same-class, same-format decks that run each card.
function popularity(deck, decks, catalog) {
  const peers = decks.filter((d) => d.cardClass === deck.cardClass && d.format === deck.format);
  const share = new Map();
  for (const peer of peers) {
    for (const canon of canonSet(peer.cards, catalog)) share.set(canon, (share.get(canon) ?? 0) + 1 / peers.length);
  }
  return share;
}

function score(candidate, target, share) {
  const overlap = (a, b) => a.filter((x) => b.includes(x)).length;
  return (
    3 -
    Math.min(3, Math.abs(candidate.cost - target.cost)) +
    (candidate.type === target.type ? 2 : 0) +
    Math.min(2, overlap(candidate.mechanics, target.mechanics)) +
    (overlap(candidate.races, target.races) ? 1 : 0) +
    (candidate.spellSchool && candidate.spellSchool === target.spellSchool ? 1 : 0) +
    3 * (share.get(candidate.dbfId) ?? 0)
  );
}

export function substitute(deck, missing, { catalog, owned, decks, standardSets }) {
  const core = coreCards(deck, decks, catalog);
  const share = popularity(deck, decks, catalog);
  const missingIds = new Set(missing.map((m) => m.dbfId));

  // Start from the deck minus the copies the player does not have.
  const toDrop = new Map(missing.map((m) => [m.dbfId, m.count]));
  const inDeck = new Map();
  const cards = {};
  for (const [id, n] of Object.entries(deck.cards)) {
    const canon = catalog.canonical(id);
    const drop = Math.min(n, toDrop.get(canon) ?? 0);
    toDrop.set(canon, (toDrop.get(canon) ?? 0) - drop);
    if (n - drop > 0) {
      cards[id] = n - drop;
      inDeck.set(canon, (inDeck.get(canon) ?? 0) + n - drop);
    }
  }

  const pool = [...owned.counts.keys()].filter(
    (canon) => !missingIds.has(canon) && playable(canon, deck, catalog, standardSets),
  );
  const swaps = [];
  let complete = true;
  for (const { dbfId: out, count } of missing) {
    const target = catalog.card(out);
    for (let i = 0; i < count; i += 1) {
      const ranked = pool
        .filter((canon) => owned.counts.get(canon) - (inDeck.get(canon) ?? 0) > 0)
        .map((canon) => ({ dbfId: canon, score: score(catalog.card(canon), target, share) }))
        .sort((a, b) => b.score - a.score || a.dbfId - b.dbfId);
      if (!ranked.length) {
        complete = false;
        continue;
      }
      const pick = ranked[0].dbfId;
      const concrete = owned.concrete.get(pick) ?? pick;
      cards[concrete] = (cards[concrete] ?? 0) + 1;
      inDeck.set(pick, (inDeck.get(pick) ?? 0) + 1);
      swaps.push({ out, in: pick, alternatives: ranked.slice(0, 3).map((r) => r.dbfId) });
    }
  }

  const coreMissing = core ? missing.filter((m) => core.has(m.dbfId)).map((m) => m.dbfId) : [];
  return {
    swaps,
    complete,
    cards,
    confidence: confidenceLevel(swaps.length, coreMissing.length > 0, core !== null),
    coreMissing,
  };
}
```

- [ ] **Step 4: Run tests, expect PASS, then commit**

```bash
npm test
git add src/substitute.js test/substitute.test.js
git commit -m "Add substitute selection and confidence levels"
```

---

### Task 6: Recommendation ordering

**Files:**
- Create: `src/recommend.js`
- Test: `test/recommend.test.js`

**Interfaces:**
- Consumes: `buildOwned`, `analyzeDeck` (Task 4); `standardSets` (Task 4); `substitute` (Task 5).
- Produces:
  - `MIN_GAMES = 200`
  - `recommend({ catalog, collection, decks, filters = {} })` returns an ordered array of `{ deck, status: 'buildable' | 'substituted' | 'missing', missing, unknown, dust, lowData: boolean, substitution: object | null }`. `filters` may hold `format`, `cardClass`, `maxDust`.

Ordering: `buildable` by win rate descending; then `substituted` by confidence (`high`, `medium`) then win rate; then `missing` by dust ascending. A deck with no win rate, or fewer than 200 games, is `lowData` and sorts last within its group. `maxDust` hides only `missing` decks that cost more.

- [ ] **Step 1: Write the failing test**

`test/recommend.test.js`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCatalog } from '../src/catalog.js';
import { recommend } from '../src/recommend.js';
import { CARDS, deck } from './helpers.js';

const catalog = createCatalog(CARDS);
const collection = { 101: 2, 105: 2, 106: 1 };
const decks = [
  deck('m1', { 401: 2 }, { cardClass: 'WARRIOR', winRate: 60 }),
  deck('b1', { 101: 2 }, { winRate: 52 }),
  deck('s1', { 101: 2, 103: 1 }, { winRate: 57 }),
  deck('b3', { 101: 1 }, { winRate: 70, games: 50 }),
  deck('m2', { 999: 1 }, { winRate: 51 }),
  deck('b2', { 105: 2 }, { winRate: 58 }),
  deck('b4', { 105: 1 }, { winRate: null, games: null, source: 'pasted' }),
];
const ids = (filters) => recommend({ catalog, collection, decks, filters }).map((r) => r.deck.id);

test('orders buildable, then substituted, then missing', () => {
  assert.deepEqual(ids({}), ['b2', 'b1', 'b3', 'b4', 's1', 'm2', 'm1']);
});

test('assigns status, dust and low-data flags', () => {
  const by = Object.fromEntries(recommend({ catalog, collection, decks }).map((r) => [r.deck.id, r]));
  assert.equal(by.b1.status, 'buildable');
  assert.equal(by.b1.substitution, null);
  assert.equal(by.s1.status, 'substituted');
  assert.equal(by.s1.substitution.confidence, 'medium');
  assert.equal(by.s1.dust, 400);
  assert.equal(by.m1.status, 'missing');
  assert.equal(by.m1.dust, 80);
  assert.deepEqual(by.m2.unknown, [999]);
  assert.equal(by.b3.lowData, true);
  assert.equal(by.b4.lowData, true);
  assert.equal(by.b1.lowData, false);
});

test('filters by format and class', () => {
  assert.deepEqual(ids({ format: 'wild' }), []);
  assert.deepEqual(ids({ cardClass: 'WARRIOR' }), ['m1']);
});

test('maxDust hides only missing decks that cost more', () => {
  assert.deepEqual(ids({ maxDust: 50 }), ['b2', 'b1', 'b3', 'b4', 's1', 'm2']);
});

test('a deck whose substitution is low confidence stays missing', () => {
  const a1 = deck('a1', { 101: 2, 104: 1 }, { archetype: 'Spell Mage' });
  const a2 = deck('a2', { 102: 2, 104: 1 }, { archetype: 'Spell Mage' });
  const [first] = recommend({ catalog, collection, decks: [a1, a2], filters: {} }).filter((r) => r.deck.id === 'a1');
  assert.equal(first.status, 'missing');
  assert.equal(first.substitution.confidence, 'low');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find module `../src/recommend.js`.

- [ ] **Step 3: Implement**

`src/recommend.js`:

```js
import { standardSets } from './legality.js';
import { analyzeDeck, buildOwned } from './ownership.js';
import { substitute } from './substitute.js';

export const MIN_GAMES = 200;

const STATUS_RANK = { buildable: 0, substituted: 1, missing: 2 };
const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 };

// Low-data decks sort after every deck with a trustworthy win rate.
const rate = (rec) => (rec.lowData ? -1 : rec.deck.winRate);

function compare(a, b) {
  if (a.status !== b.status) return STATUS_RANK[a.status] - STATUS_RANK[b.status];
  const byId = a.deck.id.localeCompare(b.deck.id);
  if (a.status === 'missing') return a.dust - b.dust || rate(b) - rate(a) || byId;
  if (a.status === 'substituted') {
    const diff = CONFIDENCE_RANK[a.substitution.confidence] - CONFIDENCE_RANK[b.substitution.confidence];
    if (diff) return diff;
  }
  return rate(b) - rate(a) || byId;
}

export function recommend({ catalog, collection, decks, filters = {} }) {
  const owned = buildOwned(catalog, collection);
  const sets = standardSets(catalog, decks);
  const results = [];
  for (const deck of decks) {
    if (filters.format && deck.format !== filters.format) continue;
    if (filters.cardClass && deck.cardClass !== filters.cardClass) continue;

    const { missing, unknown, dust } = analyzeDeck(deck, catalog, owned);
    const lowData = deck.winRate == null || (deck.games ?? 0) < MIN_GAMES;
    let status = 'missing';
    let substitution = null;
    if (!missing.length && !unknown.length) {
      status = 'buildable';
    } else if (!unknown.length) {
      substitution = substitute(deck, missing, { catalog, owned, decks, standardSets: sets });
      if (substitution.complete && substitution.confidence !== 'low') status = 'substituted';
    }
    if (status === 'missing' && filters.maxDust != null && dust > filters.maxDust) continue;
    results.push({ deck, status, missing, unknown, dust, lowData, substitution });
  }
  return results.sort(compare);
}
```

- [ ] **Step 4: Run tests, expect PASS, then commit**

```bash
npm test
git add src/recommend.js test/recommend.test.js
git commit -m "Add recommendation status and ordering"
```

---

### Task 7: HSReplay sources, pasted decks and update

**Files:**
- Create: `src/config.js`, `src/sources/hsreplay-http.js`, `src/sources/collection.js`, `src/sources/decks-hsreplay.js`, `src/sources/decks-pasted.js`, `src/update.js`
- Test: `test/hsreplay.test.js`, `test/pasted.test.js`, `test/update.test.js`

**Interfaces:**
- Consumes: `createStore` (Task 1); `decode`, `encode` (Task 2); `createCatalog`, `fetchCards` (Task 3); helpers `stubFetch`, `rawCards` (Task 3).
- Produces:
  - `readConfig(path)` returns the parsed object, `{}` when the file is missing; throws `Error('config.local.json okunamadı: ...')` on bad JSON. Config shape: `{ "hsreplay": { "sessionid": "...", "region": 2, "accountLo": 123 } }` (`region` and `accountLo` optional).
  - `hsreplayGet(path, config, fetchImpl = fetch)` returns parsed JSON; throws Turkish errors.
  - `parseCollection(body)` returns `{ [dbfId]: count }`; `resolveAccount(config, fetchImpl)` returns `{ region, accountLo }`; `fetchCollection(config, fetchImpl = fetch)`.
  - `parseDecks(body, archetypes, format)` returns deck objects; `fetchHsreplayDecks(config, fetchImpl = fetch)`.
  - Deck object: `{ id, source: 'hsreplay' | 'pasted', name, archetype: string | null, cardClass, format, cards: { [dbfId]: count }, winRate: number | null, games: number | null, sideboard?: [dbfId, count, owner][] }`.
  - `deckFromCode(input, catalog)` returns a pasted deck; `listPasted(store)`; `addPasted(store, deck)`; `removePasted(store, id)` returns boolean.
  - `runUpdate({ store, config, fetchImpl = fetch, now })` returns and stores `{ cards, collection, decks }`, each `{ updatedAt: string | null, error: string | null }`.

Assumed, unverified HSReplay shapes (Task 10 checks them on Windows):
- `GET /api/v1/account/` returns `{ blizzard_accounts: [{ region, account_lo }] }`
- `GET /api/v1/collection/?region=R&account_lo=N` returns `{ collection: { "<dbfId>": [normal, golden, ...] } }`
- `GET /api/v1/archetypes/` returns `[{ id, name }]`
- `GET /analytics/query/list_decks_by_win_rate_v2/?GameType=RANKED_STANDARD` returns `{ series: { data: { "<CLASS>": [{ deck_id, deck_list: "[[dbfId,count],...]", archetype_id, win_rate, total_games }] } } }`

- [ ] **Step 1: Write the failing tests**

`test/hsreplay.test.js`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchCollection, parseCollection } from '../src/sources/collection.js';
import { fetchHsreplayDecks, parseDecks } from '../src/sources/decks-hsreplay.js';
import { hsreplayGet } from '../src/sources/hsreplay-http.js';
import { stubFetch } from './helpers.js';

const config = { hsreplay: { sessionid: 'abc123' } };
const DECK_BODY = {
  series: {
    data: {
      MAGE: [{ deck_id: 'xYz', deck_list: '[[101,2],[104,1]]', archetype_id: 9, win_rate: 54.2, total_games: 1200 }],
      WARRIOR: [{ deck_id: 'w1', deck_list: [[401, 2]], archetype_id: null, win_rate: 49, total_games: 300 }],
    },
  },
};

test('hsreplayGet sends the session cookie only to hsreplay.net', async () => {
  const fetchImpl = stubFetch({ '/api/v1/archetypes/': { body: [] } });
  await hsreplayGet('/api/v1/archetypes/', config, fetchImpl);
  const [call] = fetchImpl.calls;
  assert.ok(call.url.startsWith('https://hsreplay.net/'));
  assert.equal(call.options.headers.cookie, 'sessionid=abc123');
});

test('hsreplayGet explains a rejected session', async () => {
  const fetchImpl = stubFetch({ '/api/': { status: 403 } });
  await assert.rejects(hsreplayGet('/api/v1/account/', config, fetchImpl), /sessionid/);
});

test('hsreplayGet refuses a cookie value that could inject headers', async () => {
  const bad = { hsreplay: { sessionid: 'abc\r\nx-evil: 1' } };
  await assert.rejects(hsreplayGet('/api/v1/account/', bad, stubFetch({})), /sessionid/);
});

test('parseCollection sums all versions of a card', () => {
  assert.deepEqual(parseCollection({ collection: { 101: [1, 1, 0, 0], 104: [0, 0], 105: [2] } }), { 101: 2, 105: 2 });
});

test('parseCollection rejects unexpected shapes', () => {
  assert.throws(() => parseCollection({}), /beklenen biçimde/);
  assert.throws(() => parseCollection({ collection: [] }), /beklenen biçimde/);
  assert.throws(() => parseCollection({ collection: { abc: [1] } }), /beklenen biçimde/);
  assert.throws(() => parseCollection({ collection: { 101: [0] } }), /boş/);
});

test('fetchCollection discovers the account when the config has none', async () => {
  const fetchImpl = stubFetch({
    '/api/v1/account/': { body: { blizzard_accounts: [{ region: 2, account_lo: 777 }] } },
    '/api/v1/collection/': { body: { collection: { 101: [2] } } },
  });
  assert.deepEqual(await fetchCollection(config, fetchImpl), { 101: 2 });
  assert.ok(fetchImpl.calls[1].url.includes('region=2&account_lo=777'));
});

test('fetchCollection uses the configured account without asking', async () => {
  const fetchImpl = stubFetch({ '/api/v1/collection/': { body: { collection: { 101: [2] } } } });
  await fetchCollection({ hsreplay: { sessionid: 'abc', region: 1, accountLo: 5 } }, fetchImpl);
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(fetchImpl.calls[0].url.includes('region=1&account_lo=5'));
});

test('fetchCollection needs a session cookie', async () => {
  await assert.rejects(fetchCollection({}, stubFetch({})), /sessionid/);
});

test('parseDecks maps rows to deck objects', () => {
  const decks = parseDecks(DECK_BODY, [{ id: 9, name: 'Spell Mage' }], 'standard');
  assert.deepEqual(decks[0], {
    id: 'hsreplay:standard:xYz',
    source: 'hsreplay',
    name: 'Spell Mage',
    archetype: 'Spell Mage',
    cardClass: 'MAGE',
    format: 'standard',
    cards: { 101: 2, 104: 1 },
    winRate: 54.2,
    games: 1200,
  });
  assert.equal(decks[1].name, 'WARRIOR destesi');
  assert.equal(decks[1].archetype, null);
});

test('parseDecks rejects unexpected shapes', () => {
  assert.throws(() => parseDecks({}, [], 'standard'), /beklenen biçimde/);
  assert.throws(() => parseDecks({ series: { data: {} } }, [], 'standard'), /beklenen biçimde/);
  assert.throws(
    () => parseDecks({ series: { data: { MAGE: [{ deck_id: 'a', deck_list: 'not json' }] } } }, [], 'standard'),
    /beklenen biçimde/,
  );
});

test('fetchHsreplayDecks loads both formats', async () => {
  const fetchImpl = stubFetch({
    '/api/v1/archetypes/': { body: [{ id: 9, name: 'Spell Mage' }] },
    'list_decks_by_win_rate_v2': { body: DECK_BODY },
  });
  const decks = await fetchHsreplayDecks(config, fetchImpl);
  assert.deepEqual([...new Set(decks.map((d) => d.format))].sort(), ['standard', 'wild']);
  assert.equal(decks.length, 4);
});
```

`test/pasted.test.js`:

```js
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
```

`test/update.test.js`:

```js
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createStore } from '../src/store.js';
import { runUpdate } from '../src/update.js';
import { rawCards, stubFetch } from './helpers.js';

const config = { hsreplay: { sessionid: 'abc', region: 2, accountLo: 1 } };
const newStore = () => createStore(mkdtempSync(join(tmpdir(), 'stoner-')));

test('a failing source keeps its old data while the others update', async () => {
  const store = newStore();
  store.write('collection', { 101: 1 });
  store.write('status', { collection: { updatedAt: '2026-01-01T00:00:00.000Z', error: null } });
  const fetchImpl = stubFetch({
    'hearthstonejson.com': { body: rawCards(1000) },
    'hsreplay.net': { status: 403 },
  });

  const status = await runUpdate({ store, config, fetchImpl, now: () => '2026-11-12T10:00:00.000Z' });

  assert.deepEqual(status.cards, { updatedAt: '2026-11-12T10:00:00.000Z', error: null });
  assert.equal(status.collection.updatedAt, '2026-01-01T00:00:00.000Z');
  assert.match(status.collection.error, /sessionid/);
  assert.equal(status.decks.updatedAt, null);
  assert.equal(store.read('cards').length, 1000);
  assert.deepEqual(store.read('collection'), { 101: 1 });
  assert.deepEqual(store.read('status'), status);
});

test('all sources succeed', async () => {
  const store = newStore();
  const fetchImpl = stubFetch({
    'hearthstonejson.com': { body: rawCards(1000) },
    '/api/v1/collection/': { body: { collection: { 1: [2] } } },
    '/api/v1/archetypes/': { body: [] },
    'list_decks_by_win_rate_v2': {
      body: { series: { data: { MAGE: [{ deck_id: 'a', deck_list: '[[1,2]]', win_rate: 50, total_games: 500 }] } } },
    },
  });
  const status = await runUpdate({ store, config, fetchImpl });
  assert.equal(Object.values(status).every((s) => s.error === null), true);
  assert.deepEqual(store.read('collection'), { 1: 2 });
  assert.equal(store.read('decks').length, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, cannot find the new modules.

- [ ] **Step 3: Implement**

`src/config.js`:

```js
import { readFileSync } from 'node:fs';

export function readConfig(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`config.local.json okunamadı: ${err.message}`);
  }
}
```

`src/sources/hsreplay-http.js`:

```js
const BASE = 'https://hsreplay.net';

export async function hsreplayGet(path, config, fetchImpl = fetch) {
  const headers = { accept: 'application/json', 'user-agent': 'stoner-deck-helper' };
  const sessionid = config?.hsreplay?.sessionid;
  if (sessionid !== undefined) {
    // Reject anything that is not a plain token so it cannot smuggle extra headers.
    if (typeof sessionid !== 'string' || !/^[\w-]+$/.test(sessionid)) {
      throw new Error('config.local.json içindeki sessionid geçersiz görünüyor');
    }
    headers.cookie = `sessionid=${sessionid}`;
  }
  let res;
  try {
    res = await fetchImpl(`${BASE}${path}`, { headers, signal: AbortSignal.timeout(20000) });
  } catch (err) {
    const why = err.name === 'TimeoutError' ? 'zaman aşımı' : err.message;
    throw new Error(`HSReplay'e bağlanılamadı (${why})`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('HSReplay oturumu reddetti: config.local.json içindeki sessionid çerezini yenileyin');
  }
  if (!res.ok) throw new Error(`HSReplay ${res.status} yanıtı verdi`);
  try {
    return await res.json();
  } catch {
    throw new Error('HSReplay yanıtı JSON değil');
  }
}
```

`src/sources/collection.js`:

```js
import { hsreplayGet } from './hsreplay-http.js';

const BAD = 'Koleksiyon yanıtı beklenen biçimde değil';

export function parseCollection(body) {
  const raw = body?.collection;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(BAD);
  const out = {};
  for (const [id, counts] of Object.entries(raw)) {
    const n = Array.isArray(counts) ? counts.reduce((sum, c) => sum + Number(c), 0) : Number(counts);
    if (!/^\d+$/.test(id) || !Number.isFinite(n)) throw new Error(BAD);
    if (n > 0) out[id] = n;
  }
  if (!Object.keys(out).length) throw new Error('Koleksiyon boş geldi');
  return out;
}

export async function resolveAccount(config, fetchImpl = fetch) {
  const { region, accountLo } = config?.hsreplay ?? {};
  if (region && accountLo) return { region, accountLo };
  const body = await hsreplayGet('/api/v1/account/', config, fetchImpl);
  const account = body?.blizzard_accounts?.[0];
  if (!account?.region || !account?.account_lo) {
    throw new Error(
      'HSReplay hesabında bağlı Blizzard hesabı bulunamadı; config.local.json içine region ve accountLo yazın',
    );
  }
  return { region: account.region, accountLo: account.account_lo };
}

export async function fetchCollection(config, fetchImpl = fetch) {
  if (!config?.hsreplay?.sessionid) throw new Error('config.local.json içinde hsreplay.sessionid yok');
  const { region, accountLo } = await resolveAccount(config, fetchImpl);
  const query = new URLSearchParams({ region: String(region), account_lo: String(accountLo) });
  return parseCollection(await hsreplayGet(`/api/v1/collection/?${query}`, config, fetchImpl));
}
```

`src/sources/decks-hsreplay.js`:

```js
import { hsreplayGet } from './hsreplay-http.js';

const GAME_TYPES = { standard: 'RANKED_STANDARD', wild: 'RANKED_WILD' };
const BAD = 'Deste yanıtı beklenen biçimde değil';

function cardList(value) {
  let list = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
    } catch {
      throw new Error(BAD);
    }
  }
  if (!Array.isArray(list) || !list.every((e) => Array.isArray(e) && Number.isInteger(e[0]) && Number.isInteger(e[1]))) {
    throw new Error(BAD);
  }
  return Object.fromEntries(list.map(([id, n]) => [id, n]));
}

export function parseDecks(body, archetypes, format) {
  const data = body?.series?.data;
  if (!data || typeof data !== 'object') throw new Error(BAD);
  const names = new Map((Array.isArray(archetypes) ? archetypes : []).map((a) => [a.id, a.name]));
  const decks = [];
  for (const [cardClass, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) throw new Error(BAD);
    for (const row of rows) {
      if (!row?.deck_id) throw new Error(BAD);
      const archetype = names.get(row.archetype_id) ?? null;
      const winRate = Number(row.win_rate);
      const games = Number(row.total_games);
      decks.push({
        id: `hsreplay:${format}:${row.deck_id}`,
        source: 'hsreplay',
        name: archetype ?? `${cardClass} destesi`,
        archetype,
        cardClass,
        format,
        cards: cardList(row.deck_list),
        winRate: Number.isFinite(winRate) ? winRate : null,
        games: Number.isFinite(games) ? games : null,
      });
    }
  }
  if (!decks.length) throw new Error(BAD);
  return decks;
}

export async function fetchHsreplayDecks(config, fetchImpl = fetch) {
  const archetypes = await hsreplayGet('/api/v1/archetypes/', config, fetchImpl);
  const decks = [];
  for (const [format, gameType] of Object.entries(GAME_TYPES)) {
    const path = `/analytics/query/list_decks_by_win_rate_v2/?GameType=${gameType}`;
    decks.push(...parseDecks(await hsreplayGet(path, config, fetchImpl), archetypes, format));
  }
  return decks;
}
```

`src/sources/decks-pasted.js`:

```js
import { createHash } from 'node:crypto';
import { decode, encode } from '../deckstring.js';

function classOf(heroes, cards, catalog) {
  const hero = catalog.card(heroes[0]);
  if (hero) return hero.cardClass;
  // A hero skin newer than our card data: infer the class from the cards.
  const tally = {};
  for (const id of Object.keys(cards)) {
    const { cardClass } = catalog.card(id);
    if (cardClass !== 'NEUTRAL') tally[cardClass] = (tally[cardClass] ?? 0) + 1;
  }
  const [best] = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  if (!best) throw new Error('Destenin sınıfı belirlenemedi');
  return best[0];
}

export function deckFromCode(input, catalog) {
  const { format, heroes, cards, sideboard } = decode(input);
  const unknown = Object.keys(cards).filter((id) => !catalog.card(id));
  if (unknown.length) {
    throw new Error(`Deste kodunda bilinmeyen kart var (${unknown.join(', ')}). Önce Güncelle'ye basın.`);
  }
  const cardClass = classOf(heroes, cards, catalog);
  const named = /^###\s*(.+)$/m.exec(String(input));
  const digest = createHash('sha1').update(encode({ format, heroes, cards, sideboard })).digest('hex');
  return {
    id: `pasted:${digest.slice(0, 12)}`,
    source: 'pasted',
    name: named ? named[1].trim().slice(0, 80) : `Yapıştırılan ${cardClass} destesi`,
    archetype: null,
    cardClass,
    format,
    cards,
    winRate: null,
    games: null,
    sideboard,
  };
}

export const listPasted = (store) => store.read('pasted', []);

export function addPasted(store, deck) {
  const decks = listPasted(store).filter((d) => d.id !== deck.id);
  store.write('pasted', [...decks, deck]);
}

export function removePasted(store, id) {
  const decks = listPasted(store);
  const kept = decks.filter((d) => d.id !== id);
  if (kept.length === decks.length) return false;
  store.write('pasted', kept);
  return true;
}
```

Note: `deckFromCode` in the first test compares `d` without `sideboard`; the test checks fields individually, so the extra `sideboard: []` field is fine.

`src/update.js`:

```js
import { fetchCards } from './sources/cards.js';
import { fetchCollection } from './sources/collection.js';
import { fetchHsreplayDecks } from './sources/decks-hsreplay.js';

export async function runUpdate({ store, config, fetchImpl = fetch, now = () => new Date().toISOString() }) {
  const sources = [
    ['cards', () => fetchCards(fetchImpl)],
    ['collection', () => fetchCollection(config, fetchImpl)],
    ['decks', () => fetchHsreplayDecks(config, fetchImpl)],
  ];
  const status = store.read('status', {});
  for (const [name, run] of sources) {
    try {
      store.write(name, await run());
      status[name] = { updatedAt: now(), error: null };
    } catch (err) {
      // Keep the previous file and its timestamp; only record why this attempt failed.
      status[name] = { updatedAt: status[name]?.updatedAt ?? null, error: err.message };
    }
  }
  store.write('status', status);
  return status;
}
```

- [ ] **Step 4: Run tests, expect PASS, then commit**

```bash
npm test
git add src/config.js src/sources src/update.js test/hsreplay.test.js test/pasted.test.js test/update.test.js
git commit -m "Add HSReplay sources, pasted decks and update runner"
```

---

### Task 8: HTTP server and API

**Files:**
- Create: `server.js`, `public/index.html` (minimal placeholder, replaced in Task 9)
- Test: `test/server.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1-7.
- Produces:
  - `PORT = 4717`
  - `createApp({ dataDir, publicDir, configPath, fetchImpl })` returns an `http.Server` (not listening). All options default to paths next to `server.js` and global `fetch`.
  - Routes:
    - `GET /api/state` returns `{ status, cardCount, collectionCount, deckCount, classes: string[] }`
    - `POST /api/update` returns the status object from `runUpdate`
    - `GET /api/recommendations?format=&class=&maxDust=` returns at most 50 presented recommendations (shape below)
    - `GET /api/owned?class=MAGE&format=standard` returns `[{ dbfId, name, cost, rarity, owned }]`
    - `POST /api/decks` body `{ code }` returns 201 `{ id, name }`
    - `DELETE /api/decks/<id>` returns `{ ok: true }`, 404 when not a pasted deck
    - `POST /api/deckstring` body `{ format, cardClass, cards }` returns `{ code, problems }`
    - `GET /`, `/app.js`, `/style.css` serve files from `publicDir`
  - Presented recommendation: `{ id, name, cardClass, format, source, winRate, games, status, dust, lowData, confidence: string | null, stale: boolean, code: string | null, cards: [{ dbfId, name, cost, rarity, count }], missing: [{ dbfId, name, cost, rarity, count, core }], swaps: [{ out, in, alternatives }] }` where `out`, `in` and each alternative are `{ dbfId, name, cost, rarity }`.
  - Errors are JSON `{ error: string }` with a 4xx/5xx status.

Security rules: reject requests whose `Host` is not `127.0.0.1` or `localhost` (blocks DNS rebinding); reject non-GET requests whose `Origin` header is present and not local; cap request bodies at 64 KB; serve only the three whitelisted static files.

- [ ] **Step 1: Write the failing test**

`test/server.test.js`:

```js
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../server.js';
import { encode } from '../src/deckstring.js';
import { createStore } from '../src/store.js';
import { CARDS, FULL_DECK_CARDS, deck, rawCards, stubFetch } from './helpers.js';

const root = mkdtempSync(join(tmpdir(), 'stoner-'));
const dataDir = join(root, 'data');
const publicDir = join(root, 'public');
const store = createStore(dataDir);
store.write('cards', CARDS);
store.write('collection', { 101: 2, 105: 2, 106: 1 });
store.write('decks', [
  // b1 includes the Core Fireball so that CORE counts as a Standard set in this data.
  deck('hsreplay:standard:b1', { 101: 2, 301: 1 }, { winRate: 52 }),
  deck('hsreplay:standard:s1', { 101: 2, 103: 1 }, { winRate: 57 }),
  deck('hsreplay:standard:m1', { 401: 2 }, { cardClass: 'WARRIOR' }),
]);
mkdirSync(publicDir, { recursive: true });
writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>Stoner</title>');

const fetchImpl = stubFetch({ 'hearthstonejson.com': { body: rawCards(1000) }, 'hsreplay.net': { status: 403 } });
const server = createApp({ dataDir, publicDir, configPath: join(root, 'config.local.json'), fetchImpl });
let base;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null), res };
};

// fetch may refuse to override Host and Origin, so those checks use a raw request.
const rawStatus = (path, method, headers) =>
  new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, path, method, headers }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });

test('GET /api/state summarises the data', async () => {
  const { status, body } = await call('/api/state');
  assert.equal(status, 200);
  assert.equal(body.cardCount, CARDS.length);
  assert.equal(body.collectionCount, 3);
  assert.equal(body.deckCount, 3);
  assert.deepEqual(body.classes, ['MAGE', 'WARRIOR']);
});

test('GET /api/recommendations returns presented decks in order', async () => {
  const { body } = await call('/api/recommendations?format=standard');
  assert.deepEqual(
    body.map((r) => [r.id, r.status]),
    [
      ['hsreplay:standard:b1', 'buildable'],
      ['hsreplay:standard:s1', 'substituted'],
      ['hsreplay:standard:m1', 'missing'],
    ],
  );
  const s1 = body[1];
  assert.equal(s1.confidence, 'medium');
  assert.equal(s1.swaps[0].out.name, 'Star Mage');
  assert.equal(s1.swaps[0].in.name, 'Apprentice');
  assert.deepEqual(s1.missing, [{ dbfId: 103, name: 'Star Mage', cost: 3, rarity: 'EPIC', count: 1, core: false }]);
  assert.deepEqual(
    s1.cards.map((c) => [c.name, c.count]),
    [
      ['Arcane Bolt', 2],
      ['Apprentice', 1],
    ],
  );
  assert.equal(typeof s1.code, 'string');
  assert.equal(body[0].confidence, null);
});

test('GET /api/recommendations applies filters and rejects bad ones', async () => {
  assert.equal((await call('/api/recommendations?format=standard&class=WARRIOR')).body.length, 1);
  assert.equal((await call('/api/recommendations?format=standard&maxDust=10')).body.length, 2);
  assert.equal((await call('/api/recommendations?format=arena')).status, 400);
  assert.equal((await call('/api/recommendations?maxDust=abc')).status, 400);
});

test('GET /api/owned lists owned playable cards', async () => {
  const { body } = await call('/api/owned?class=MAGE&format=standard');
  assert.deepEqual(
    body.map((c) => [c.name, c.owned]),
    [
      ['Arcane Bolt', 2],
      ['Arcane Dart', 2],
      ['Apprentice', 1],
      ['Fireball', 2],
    ],
  );
  assert.equal(body[3].dbfId, 301);
  assert.equal((await call('/api/owned?class=mage&format=standard')).status, 400);
});

test('pasted decks can be added, listed and removed', async () => {
  const code = encode({ format: 'standard', heroes: [637], cards: { 105: 2 } });
  const added = await call('/api/decks', { method: 'POST', body: { code } });
  assert.equal(added.status, 201);
  assert.match(added.body.id, /^pasted:/);
  const listed = await call('/api/recommendations?format=standard');
  assert.ok(listed.body.some((r) => r.id === added.body.id && r.source === 'pasted'));
  assert.equal((await call(`/api/decks/${encodeURIComponent(added.body.id)}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call(`/api/decks/${encodeURIComponent(added.body.id)}`, { method: 'DELETE' })).status, 404);
  assert.equal((await call('/api/decks/hsreplay%3Astandard%3Ab1', { method: 'DELETE' })).status, 404);
});

test('POST /api/decks rejects bad input', async () => {
  assert.equal((await call('/api/decks', { method: 'POST', body: { code: 'nope!' } })).status, 400);
  assert.equal((await call('/api/decks', { method: 'POST', body: {} })).status, 400);
  const res = await fetch(`${base}/api/decks`, { method: 'POST', body: '{broken' });
  assert.equal(res.status, 400);
});

test('POST /api/deckstring encodes and validates', async () => {
  const ok = await call('/api/deckstring', {
    method: 'POST',
    body: { format: 'standard', cardClass: 'MAGE', cards: FULL_DECK_CARDS },
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.problems, []);
  assert.equal(typeof ok.body.code, 'string');
  const short = await call('/api/deckstring', {
    method: 'POST',
    body: { format: 'standard', cardClass: 'MAGE', cards: { 101: 2 } },
  });
  assert.match(short.body.problems[0], /30 kart/);
  const bad = await call('/api/deckstring', {
    method: 'POST',
    body: { format: 'standard', cardClass: 'MAGE', cards: { 101: -1 } },
  });
  assert.equal(bad.status, 400);
  const noClass = await call('/api/deckstring', {
    method: 'POST',
    body: { format: 'standard', cardClass: 'PRIEST', cards: { 101: 1 } },
  });
  assert.equal(noClass.status, 400);
});

test('state-changing requests from another origin are refused', async () => {
  assert.equal(await rawStatus('/api/update', 'POST', { origin: 'http://evil.example' }), 403);
  assert.equal(await rawStatus('/api/state', 'GET', { origin: 'http://evil.example' }), 200);
});

test('requests with a foreign Host header are refused', async () => {
  assert.equal(await rawStatus('/api/state', 'GET', { host: 'evil.example' }), 403);
});

test('static files are served and unknown paths are 404', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.equal((await call('/nope')).status, 404);
  assert.equal((await call('/../package.json')).status, 404);
});

test('POST /api/update reports per-source results and refreshes the cache', async () => {
  const { status, body } = await call('/api/update', { method: 'POST' });
  assert.equal(status, 200);
  assert.equal(body.cards.error, null);
  assert.match(body.collection.error, /sessionid/);
  assert.equal((await call('/api/state')).body.cardCount, 1000);
});
```

Note: the last test replaces the card data, so it must stay last in the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find module `../server.js`.

- [ ] **Step 3: Implement**

`server.js`:

```js
import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCatalog } from './src/catalog.js';
import { readConfig } from './src/config.js';
import { FORMATS, encode } from './src/deckstring.js';
import { playable, standardSets } from './src/legality.js';
import { buildOwned } from './src/ownership.js';
import { recommend } from './src/recommend.js';
import { addPasted, deckFromCode, listPasted, removePasted } from './src/sources/decks-pasted.js';
import { createStore } from './src/store.js';
import { runUpdate } from './src/update.js';
import { validateDeck } from './src/validate.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const PORT = 4717;

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const LOCAL_HOST = /^(127\.0\.0\.1|localhost)(:\d+)?$/;
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
const MAX_BODY = 64 * 1024;
const MAX_RESULTS = 50;

const httpError = (status, message) => Object.assign(new Error(message), { status });

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw httpError(413, 'İstek çok büyük');
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw httpError(400, 'Geçersiz JSON');
  }
}

function cleanCards(input) {
  const bad = httpError(400, 'cards alanı geçersiz');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad;
  for (const [id, n] of Object.entries(input)) {
    if (!/^\d+$/.test(id) || !Number.isInteger(n) || n < 1 || n > 30) throw bad;
  }
  return input;
}

export function createApp({
  dataDir = join(ROOT, 'data'),
  publicDir = join(ROOT, 'public'),
  configPath = join(ROOT, 'config.local.json'),
  fetchImpl = fetch,
} = {}) {
  const store = createStore(dataDir);
  let cache = null;

  // Parsed data is cached between requests and dropped whenever a file changes.
  function state() {
    if (!cache) {
      const cards = store.read('cards', []);
      cache = {
        cardCount: cards.length,
        catalog: createCatalog(cards),
        collection: store.read('collection', {}),
        decks: [...store.read('decks', []), ...listPasted(store)],
      };
    }
    return cache;
  }

  const info = (catalog, id) => {
    const card = catalog.card(id);
    return card
      ? { dbfId: card.dbfId, name: card.name, cost: card.cost, rarity: card.rarity }
      : { dbfId: Number(id), name: `Bilinmeyen kart (${id})`, cost: 0, rarity: null };
  };

  function present(rec, catalog) {
    const { deck, substitution } = rec;
    const substituted = rec.status === 'substituted';
    const finalCards = substituted ? substitution.cards : deck.cards;
    const core = new Set(substitution?.coreMissing ?? []);
    const hero = catalog.heroFor(deck.cardClass);
    return {
      id: deck.id,
      name: deck.name,
      cardClass: deck.cardClass,
      format: deck.format,
      source: deck.source,
      winRate: deck.winRate,
      games: deck.games,
      status: rec.status,
      dust: rec.dust,
      lowData: rec.lowData,
      confidence: substituted ? substitution.confidence : null,
      stale: rec.unknown.length > 0,
      code:
        hero && FORMATS.includes(deck.format)
          ? encode({
              format: deck.format,
              heroes: [hero],
              cards: finalCards,
              sideboard: substituted ? [] : (deck.sideboard ?? []),
            })
          : null,
      cards: Object.entries(finalCards)
        .map(([id, count]) => ({ ...info(catalog, id), count }))
        .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name)),
      missing: rec.missing.map((m) => ({ ...info(catalog, m.dbfId), count: m.count, core: core.has(m.dbfId) })),
      swaps: substituted
        ? substitution.swaps.map((s) => ({
            out: info(catalog, s.out),
            in: info(catalog, s.in),
            alternatives: s.alternatives.map((id) => info(catalog, id)),
          }))
        : [],
    };
  }

  const routes = {
    'GET /api/state': () => {
      const { cardCount, collection, decks } = state();
      return {
        status: store.read('status', {}),
        cardCount,
        collectionCount: Object.keys(collection).length,
        deckCount: decks.length,
        classes: [...new Set(decks.map((d) => d.cardClass))].sort(),
      };
    },

    'POST /api/update': async () => {
      const status = await runUpdate({ store, config: readConfig(configPath), fetchImpl });
      cache = null;
      return status;
    },

    'GET /api/recommendations': (url) => {
      const format = url.searchParams.get('format');
      const cardClass = url.searchParams.get('class');
      const maxDustRaw = url.searchParams.get('maxDust');
      if (format && !FORMATS.includes(format)) throw httpError(400, 'format geçersiz');
      if (cardClass && !/^[A-Z]+$/.test(cardClass)) throw httpError(400, 'class geçersiz');
      if (maxDustRaw !== null && !/^\d+$/.test(maxDustRaw)) throw httpError(400, 'maxDust geçersiz');
      const { catalog, collection, decks } = state();
      const filters = { format, cardClass, maxDust: maxDustRaw === null ? null : Number(maxDustRaw) };
      return recommend({ catalog, collection, decks, filters })
        .slice(0, MAX_RESULTS)
        .map((rec) => present(rec, catalog));
    },

    'GET /api/owned': (url) => {
      const cardClass = url.searchParams.get('class') ?? '';
      const format = url.searchParams.get('format') ?? '';
      if (!/^[A-Z]+$/.test(cardClass)) throw httpError(400, 'class geçersiz');
      if (!FORMATS.includes(format)) throw httpError(400, 'format geçersiz');
      const { catalog, collection, decks } = state();
      const owned = buildOwned(catalog, collection);
      const sets = standardSets(catalog, decks);
      return [...owned.counts]
        .filter(([canon]) => playable(canon, { cardClass, format }, catalog, sets))
        .map(([canon, count]) => ({ ...info(catalog, canon), dbfId: owned.concrete.get(canon) ?? canon, owned: count }))
        .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
    },

    'POST /api/decks': async (url, req) => {
      const { code } = await readJson(req);
      if (typeof code !== 'string' || !code.trim()) throw httpError(400, 'Deste kodu gerekli');
      let deck;
      try {
        deck = deckFromCode(code, state().catalog);
      } catch (err) {
        throw httpError(400, err.message);
      }
      addPasted(store, deck);
      cache = null;
      return { status: 201, body: { id: deck.id, name: deck.name } };
    },

    'POST /api/deckstring': async (url, req) => {
      const { format, cardClass, cards } = await readJson(req);
      const { catalog, decks } = state();
      if (!FORMATS.includes(format)) throw httpError(400, 'format geçersiz');
      const hero = typeof cardClass === 'string' ? catalog.heroFor(cardClass) : null;
      if (!hero) throw httpError(400, 'cardClass geçersiz');
      const clean = cleanCards(cards);
      return {
        code: encode({ format, heroes: [hero], cards: clean }),
        problems: validateDeck({ format, cardClass, cards: clean }, catalog, standardSets(catalog, decks)),
      };
    },
  };

  async function handle(req, res) {
    if (!LOCAL_HOST.test(req.headers.host ?? '')) throw httpError(403, 'Geçersiz Host');
    const { origin } = req.headers;
    if (req.method !== 'GET' && origin !== undefined && !LOCAL_ORIGIN.test(origin)) {
      throw httpError(403, 'Geçersiz Origin');
    }
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && Object.hasOwn(STATIC, url.pathname)) {
      const [file, type] = STATIC[url.pathname];
      const content = await readFile(join(publicDir, file));
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(content);
      return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/decks/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/decks/'.length));
      if (!removePasted(store, id)) throw httpError(404, 'Deste bulunamadı');
      cache = null;
      send(res, 200, { ok: true });
      return;
    }

    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) throw httpError(404, 'Bulunamadı');
    const result = await route(url, req);
    if (result && result.status && result.body) send(res, result.status, result.body);
    else send(res, 200, result);
  }

  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) send(res, err.status ?? 500, { error: err.message });
      else res.end();
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createApp();
  server.on('error', (err) => {
    console.error(
      err.code === 'EADDRINUSE' ? `Port ${PORT} kullanımda; Stoner zaten açık olabilir.` : err.message,
    );
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${PORT}`;
    console.log(`Stoner çalışıyor: ${url}  (kapatmak için bu pencerede Ctrl+C)`);
    const opener = { win32: 'start ""', darwin: 'open' }[process.platform];
    if (opener && process.argv.includes('--open')) exec(`${opener} "${url}"`);
  });
}
```

Watch out: `GET /api/state` returns an object with a `status` key but no `body` key, so the `result.status && result.body` check does not mistake it for a custom-status response. Keep both conditions.

`public/index.html` (placeholder so `GET /` works before Task 9):

```html
<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <title>Stoner</title>
  </head>
  <body></body>
</html>
```

- [ ] **Step 4: Run tests, expect PASS, then commit**

```bash
npm test
git add server.js public/index.html test/server.test.js
git commit -m "Add local HTTP server and API"
```

---

### Task 9: User interface and Windows launcher

**Files:**
- Modify: `public/index.html` (replace the placeholder)
- Create: `public/app.js`, `public/style.css`, `start.bat`

**Interfaces:**
- Consumes: the API from Task 8, exactly as documented there.
- Produces: no code interfaces. Element ids used by `app.js`: `update`, `notice`, `sources`, `filters`, `paste`, `code`, `decks`, `swap`, `swap-h`, `swap-search`, `swap-list`.

Rules: build DOM with `textContent` and `append`, never `innerHTML` with data (deck names come from pasted text). Status and confidence are always written as words, never colour alone. Every control is a real `<button>`, `<select>`, `<input>` or `<textarea>` with a label. There is no automated UI test; verify manually in Step 4.

- [ ] **Step 1: Write the page**

`public/index.html`:

```html
<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Stoner</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <header>
      <h1>Stoner</h1>
      <button id="update" type="button">Güncelle</button>
    </header>

    <p id="notice" role="status" aria-live="polite"></p>

    <main>
      <section aria-labelledby="sources-h">
        <h2 id="sources-h">Veri durumu</h2>
        <ul id="sources"></ul>
      </section>

      <section aria-labelledby="filters-h">
        <h2 id="filters-h">Filtreler</h2>
        <form id="filters">
          <label>
            Format
            <select name="format">
              <option value="standard">Standard</option>
              <option value="wild">Wild</option>
            </select>
          </label>
          <label>
            Sınıf
            <select name="class">
              <option value="">Tümü</option>
            </select>
          </label>
          <label>
            Eksik destelerde en fazla toz
            <input name="maxDust" type="range" min="0" max="12000" step="400" value="12000" />
            <output name="dustOut">sınırsız</output>
          </label>
        </form>
      </section>

      <section aria-labelledby="paste-h">
        <h2 id="paste-h">Deste kodu ekle</h2>
        <form id="paste">
          <label for="code">Oyundan ya da bir siteden kopyaladığınız deste kodu</label>
          <textarea id="code" name="code" rows="3" required></textarea>
          <button type="submit">Ekle</button>
        </form>
      </section>

      <section aria-labelledby="decks-h">
        <h2 id="decks-h">Öneriler</h2>
        <div id="decks"></div>
      </section>
    </main>

    <dialog id="swap" aria-labelledby="swap-h">
      <h2 id="swap-h">Kart değiştir</h2>
      <label>
        Ara
        <input id="swap-search" type="search" />
      </label>
      <ul id="swap-list"></ul>
      <form method="dialog">
        <button>Kapat</button>
      </form>
    </dialog>

    <script type="module" src="/app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the script**

`public/app.js`:

```js
const $ = (selector) => document.querySelector(selector);

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const STATUS = { buildable: 'Hemen kurulabilir', substituted: 'İkameyle kurulabilir', missing: 'Kart eksik' };
const CONFIDENCE = { high: 'yüksek', medium: 'orta', low: 'düşük' };
const SOURCES = { cards: 'Kartlar', collection: 'Koleksiyon', decks: 'Meta desteler' };
const MAX_DUST = 12000;

const ownedCache = new Map();

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Sunucu hatası (${res.status})`);
  return data;
}

function notify(text) {
  $('#notice').textContent = text;
}

const byCost = (a, b) => a.cost - b.cost || a.name.localeCompare(b.name);

async function loadState() {
  const state = await api('/api/state');
  $('#sources').replaceChildren(
    ...Object.entries(SOURCES).map(([key, label]) => {
      const source = state.status[key];
      const when = source?.updatedAt ? new Date(source.updatedAt).toLocaleString('tr-TR') : 'hiç güncellenmedi';
      const failure = source?.error ? ` — son deneme başarısız: ${source.error}` : '';
      return el('li', { textContent: `${label}: ${when}${failure}` });
    }),
  );
  const select = $('#filters').elements.class;
  const current = select.value;
  select.replaceChildren(
    el('option', { value: '', textContent: 'Tümü' }),
    ...state.classes.map((c) => el('option', { value: c, textContent: c })),
  );
  select.value = state.classes.includes(current) ? current : '';
}

async function loadDecks() {
  const fields = $('#filters').elements;
  const query = new URLSearchParams({ format: fields.format.value });
  if (fields.class.value) query.set('class', fields.class.value);
  if (Number(fields.maxDust.value) < MAX_DUST) query.set('maxDust', fields.maxDust.value);
  const recs = await api(`/api/recommendations?${query}`);
  $('#decks').replaceChildren(
    ...(recs.length
      ? recs.map(deckCard)
      : [el('p', { textContent: "Gösterilecek deste yok. Güncelle'ye basın ya da bir deste kodu ekleyin." })]),
  );
}

async function refresh() {
  await loadState();
  await loadDecks();
}

function winRateText(rec) {
  if (rec.winRate == null) return 'kazanma oranı yok';
  return `%${rec.winRate.toFixed(1)} kazanma, ${rec.games} maç${rec.lowData ? ' (az veri)' : ''}`;
}

function statusText(rec) {
  const parts = [STATUS[rec.status]];
  if (rec.confidence) parts.push(`güven: ${CONFIDENCE[rec.confidence]} (tahmin)`);
  if (rec.dust > 0) parts.push(`eksikleri üretmek ${rec.dust} toz`);
  return parts.join(' · ');
}

function deckCard(rec) {
  const edit = new Map(rec.cards.map((c) => [String(c.dbfId), { ...c }]));
  let code = rec.code;

  const copy = el('button', { type: 'button', textContent: 'Deste kodunu kopyala', disabled: !code });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      notify(`${rec.name}: deste kodu kopyalandı. Oyunda yeni deste oluşturun; kod kendiliğinden algılanır.`);
    } catch {
      notify(`Kopyalanamadı. Kod: ${code}`);
    }
  });

  const problems = el('p', { className: 'problems' });
  const list = el('ul', { className: 'cards' });

  function renderList() {
    list.replaceChildren(
      ...[...edit.values()].sort(byCost).map((c) => {
        const change = el('button', { type: 'button', textContent: 'Değiştir' });
        change.setAttribute('aria-label', `${c.name} kartını değiştir`);
        change.addEventListener('click', () => openSwap(rec, c, applySwap));
        return el('li', {}, [`${c.cost} mana · ${c.name} ×${c.count} `, change]);
      }),
    );
  }

  async function applySwap(out, into) {
    const from = edit.get(String(out.dbfId));
    if (from.count > 1) from.count -= 1;
    else edit.delete(String(out.dbfId));
    const to = edit.get(String(into.dbfId));
    if (to) to.count += 1;
    else edit.set(String(into.dbfId), { dbfId: into.dbfId, name: into.name, cost: into.cost, count: 1 });
    renderList();
    const cards = Object.fromEntries([...edit].map(([id, c]) => [id, c.count]));
    try {
      const result = await api('/api/deckstring', {
        method: 'POST',
        body: { format: rec.format, cardClass: rec.cardClass, cards },
      });
      code = result.code;
      copy.disabled = false;
      problems.textContent = result.problems.length ? `Uyarı: ${result.problems.join(' · ')}` : '';
      notify(`${rec.name}: ${out.name} yerine ${into.name} kondu. Yeni kod hazır.`);
    } catch (err) {
      notify(err.message);
    }
  }

  renderList();

  const children = [
    el('h3', { textContent: rec.name }),
    el('p', { className: 'meta', textContent: `${rec.cardClass} · ${rec.format} · ${winRateText(rec)}` }),
    el('p', { className: `status status-${rec.status}`, textContent: statusText(rec) }),
  ];
  if (rec.stale) {
    children.push(el('p', { textContent: "Bu destede tanınmayan kart var; Güncelle'ye basın." }));
  }
  if (rec.missing.length) {
    const names = rec.missing.map((m) => `${m.name} ×${m.count}${m.core ? ' (çekirdek kart)' : ''}`);
    children.push(el('p', { textContent: `Eksik: ${names.join(', ')}` }));
  }
  if (rec.swaps.length) {
    children.push(
      el(
        'ul',
        { className: 'swaps' },
        rec.swaps.map((s) => {
          const others = s.alternatives.filter((a) => a.dbfId !== s.in.dbfId).map((a) => a.name);
          const tail = others.length ? ` (diğer adaylar: ${others.join(', ')})` : '';
          return el('li', { textContent: `${s.out.name} yerine ${s.in.name}${tail}` });
        }),
      ),
    );
  }
  children.push(el('details', {}, [el('summary', { textContent: 'Kart listesi ve değiştirme' }), list]), problems);

  const actions = el('div', { className: 'actions' }, [copy]);
  if (rec.source === 'pasted') {
    const remove = el('button', { type: 'button', textContent: 'Desteyi sil' });
    remove.addEventListener('click', async () => {
      try {
        await api(`/api/decks/${encodeURIComponent(rec.id)}`, { method: 'DELETE' });
        notify(`${rec.name} silindi.`);
        await refresh();
      } catch (err) {
        notify(err.message);
      }
    });
    actions.append(remove);
  }
  children.push(actions);

  return el('article', { className: 'deck' }, children);
}

async function openSwap(rec, card, apply) {
  const key = `${rec.cardClass}|${rec.format}`;
  try {
    if (!ownedCache.has(key)) {
      ownedCache.set(key, await api(`/api/owned?class=${rec.cardClass}&format=${rec.format}`));
    }
  } catch (err) {
    notify(err.message);
    return;
  }
  const dialog = $('#swap');
  const search = $('#swap-search');
  $('#swap-h').textContent = `${card.name} yerine hangi kart?`;

  const render = () => {
    // Card names are English, so use plain lowercasing (Turkish rules would turn "I" into "ı").
    const term = search.value.trim().toLowerCase();
    const matches = ownedCache
      .get(key)
      .filter((c) => c.dbfId !== card.dbfId && c.name.toLowerCase().includes(term))
      .slice(0, 100);
    $('#swap-list').replaceChildren(
      ...matches.map((c) => {
        const pick = el('button', { type: 'button', textContent: `${c.cost} mana · ${c.name} (sende ${c.owned})` });
        pick.addEventListener('click', () => {
          dialog.close();
          apply(card, c);
        });
        return el('li', {}, [pick]);
      }),
    );
  };

  search.value = '';
  search.oninput = render;
  render();
  dialog.showModal();
}

$('#filters').addEventListener('input', () => {
  const fields = $('#filters').elements;
  fields.dustOut.value = Number(fields.maxDust.value) < MAX_DUST ? `${fields.maxDust.value} toz` : 'sınırsız';
  loadDecks().catch((err) => notify(err.message));
});

$('#update').addEventListener('click', async () => {
  const button = $('#update');
  button.disabled = true;
  notify('Güncelleniyor…');
  try {
    const status = await api('/api/update', { method: 'POST' });
    const failed = Object.entries(status)
      .filter(([, source]) => source.error)
      .map(([key]) => SOURCES[key] ?? key);
    notify(
      failed.length
        ? `Güncelleme kısmen başarısız: ${failed.join(', ')}. Ayrıntı "Veri durumu" bölümünde.`
        : 'Tüm veriler güncellendi.',
    );
    ownedCache.clear();
    await refresh();
  } catch (err) {
    notify(err.message);
  } finally {
    button.disabled = false;
  }
});

$('#paste').addEventListener('submit', async (event) => {
  event.preventDefault();
  const field = $('#code');
  try {
    const added = await api('/api/decks', { method: 'POST', body: { code: field.value } });
    field.value = '';
    notify(`${added.name} eklendi.`);
    await refresh();
  } catch (err) {
    notify(err.message);
  }
});

refresh().catch((err) => notify(err.message));
```

- [ ] **Step 3: Write the styles and launcher**

`public/style.css`:

```css
:root {
  color-scheme: light dark;
  --bg: #f6f4ef;
  --panel: #ffffff;
  --text: #1d1b16;
  --muted: #5f5a4e;
  --line: #d9d4c7;
  --accent: #8a4b12;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #17150f;
    --panel: #221f17;
    --text: #efe9da;
    --muted: #b3ab97;
    --line: #3a3528;
    --accent: #e0a45c;
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0 auto;
  max-width: 60rem;
  padding: 1rem;
  background: var(--bg);
  color: var(--text);
  font: 1rem/1.5 system-ui, 'Segoe UI', sans-serif;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

h1 {
  margin: 0;
  font-size: 1.6rem;
}

h2 {
  margin: 1.5rem 0 0.5rem;
  font-size: 1.1rem;
}

h3 {
  margin: 0;
  font-size: 1.05rem;
}

button,
select,
input,
textarea {
  font: inherit;
  color: inherit;
}

button {
  padding: 0.4rem 0.8rem;
  border: 1px solid var(--accent);
  border-radius: 0.35rem;
  background: transparent;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

#notice {
  min-height: 1.5rem;
  color: var(--accent);
  font-weight: 600;
}

#filters {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: end;
}

#filters label,
#paste {
  display: grid;
  gap: 0.25rem;
}

#paste textarea {
  width: 100%;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 0.35rem;
  padding: 0.5rem;
  font-family: ui-monospace, Consolas, monospace;
}

#paste button {
  justify-self: start;
}

.deck {
  margin-bottom: 0.75rem;
  padding: 1rem;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 0.5rem;
}

.deck p {
  margin: 0.25rem 0;
}

.meta {
  color: var(--muted);
}

.status {
  font-weight: 600;
}

.cards,
.swaps,
#swap-list,
#sources {
  margin: 0.5rem 0;
  padding-left: 1.2rem;
}

.cards li {
  margin: 0.2rem 0;
}

.cards button {
  padding: 0.1rem 0.5rem;
  font-size: 0.85rem;
}

.problems {
  color: var(--accent);
}

.actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

dialog {
  width: min(32rem, 92vw);
  max-height: 80vh;
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 0.5rem;
}

#swap-list {
  max-height: 45vh;
  overflow: auto;
  list-style: none;
  padding-left: 0;
}

#swap-list button {
  width: 100%;
  margin: 0.15rem 0;
  text-align: left;
}
```

`start.bat`:

```bat
@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurun, sonra tekrar deneyin.
  pause
  exit /b 1
)
node server.js --open
pause
```

- [ ] **Step 4: Verify manually**

Run: `node server.js --open` (on the development Mac this opens the browser).

Check, with an empty `data/` folder:
1. The page loads, shows the three sources as "hiç güncellenmedi", and "Gösterilecek deste yok".
2. Press Güncelle. On the development network: Kartlar gets a timestamp; Koleksiyon and Meta desteler show a Turkish failure message; the notice says the update partly failed. Nothing crashes.
3. Paste this code and press Ekle: `AAECAQcBAQECAAA=`. Expect a Turkish error or a "Kart eksik" deck (the ids are test ids), with no crash and no raw HTML shown.
4. Tab through the page: every control is reachable and shows a focus ring.
5. Stop the server with Ctrl+C.

Then run `npm test` and confirm everything still passes.

- [ ] **Step 5: Commit**

```bash
git add public start.bat
git commit -m "Add user interface and Windows launcher"
```

---

### Task 10: Windows probe script and setup guide

**Files:**
- Create: `scripts/probe-hsreplay.js`
- Modify: `README.md` (replace the whole file)
- Test: `test/probe.test.js`

**Interfaces:**
- Consumes: `readConfig` (Task 7), `hsreplayGet`, `parseCollection`, `resolveAccount`, `parseDecks` (Task 7).
- Produces: `shape(value, depth = 0)`, exported from `scripts/probe-hsreplay.js`, which describes the structure of a value without revealing its contents. The script, when run directly, probes the four HSReplay endpoints, prints structure and parser results, and saves raw responses under `data/probe/` (git-ignored, because they contain the player's own data).

Why this exists: the HSReplay endpoints and response shapes in Task 7 are assumptions that could not be checked from the development network. This script is how the user finds out, on the Windows machine, which assumptions hold, and gives output that can be pasted back safely (it prints key names and types only, never values).

- [ ] **Step 1: Write the failing test**

`test/probe.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find module `../scripts/probe-hsreplay.js`.

- [ ] **Step 3: Implement the script**

`scripts/probe-hsreplay.js`:

```js
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readConfig } from '../src/config.js';
import { parseCollection, resolveAccount } from '../src/sources/collection.js';
import { parseDecks } from '../src/sources/decks-hsreplay.js';
import { hsreplayGet } from '../src/sources/hsreplay-http.js';

const MAX_KEYS = 8;
const MAX_DEPTH = 3;

// Describe structure only (key names and types), so the output is safe to share.
export function shape(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length ? [`array(${value.length})`, shape(value[0], depth + 1)] : ['array(0)'];
  }
  if (typeof value !== 'object') return typeof value;
  if (depth >= MAX_DEPTH) return 'object';
  const keys = Object.keys(value);
  const out = Object.fromEntries(keys.slice(0, MAX_KEYS).map((k) => [k, shape(value[k], depth + 1)]));
  if (keys.length > MAX_KEYS) out['…'] = `+${keys.length - MAX_KEYS} anahtar`;
  return out;
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const config = readConfig(join(root, 'config.local.json'));
  const outDir = join(root, 'data', 'probe');
  mkdirSync(outDir, { recursive: true });

  async function probe(name, path, check) {
    console.log(`\n== ${name}: ${path.split('?')[0]}`);
    try {
      const body = await hsreplayGet(path, config);
      writeFileSync(join(outDir, `${name}.json`), JSON.stringify(body));
      console.log('Biçim:', JSON.stringify(shape(body), null, 2));
      if (check) console.log('Ayrıştırma:', check(body));
      return body;
    } catch (err) {
      console.log('BAŞARISIZ:', err.message);
      return null;
    }
  }

  const describe = (fn) => (body) => {
    try {
      return fn(body);
    } catch (err) {
      return `BAŞARISIZ: ${err.message}`;
    }
  };

  await probe('account', '/api/v1/account/');
  let account = null;
  try {
    account = await resolveAccount(config);
    console.log('\nHesap bulundu (region ve accountLo alındı).');
  } catch (err) {
    console.log('\nHesap bulunamadı:', err.message);
  }
  if (account) {
    const query = new URLSearchParams({ region: String(account.region), account_lo: String(account.accountLo) });
    await probe(
      'collection',
      `/api/v1/collection/?${query}`,
      describe((body) => `OK, ${Object.keys(parseCollection(body)).length} farklı kart`),
    );
  }
  const archetypes = await probe('archetypes', '/api/v1/archetypes/');
  await probe(
    'decks-standard',
    '/analytics/query/list_decks_by_win_rate_v2/?GameType=RANKED_STANDARD',
    describe((body) => `OK, ${parseDecks(body, archetypes ?? [], 'standard').length} deste`),
  );

  console.log(`\nHam yanıtlar ${outDir} klasörüne kaydedildi (kişisel veri içerir, paylaşmayın).`);
  console.log('Yukarıdaki "Biçim" ve "Ayrıştırma" satırları değer içermez; sorun olursa onları paylaşabilirsiniz.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Write the setup guide**

`README.md`:

````markdown
# Stoner

Hearthstone koleksiyonunuza bakarak güncel meta destelerden hangilerini kurabileceğinizi söyleyen,
eksik kartları elinizdeki kartlarla tamamlayan yerel bir web uygulaması.

Uygulama oyuna dokunmaz. Yalnızca öneri üretir ve deste kodu verir; desteyi oyuna siz yapıştırır,
maçları siz oynarsınız.

## Gerekenler (Windows)

1. **Node.js 22 veya üstü.** <https://nodejs.org> adresinden LTS sürümünü kurun.
2. **Hearthstone Deck Tracker**, HSReplay.net hesabınıza bağlı ve koleksiyon yüklemesi açık.
   Oyunda koleksiyon ekranını bir kez açtığınızda kartlarınız HSReplay'e yüklenir.

## Kurulum

1. Bu depoyu indirin (GitHub'da **Code → Download ZIP**) ve bir klasöre açın.
2. Klasörde `config.local.json` adında bir dosya oluşturun:

   ```json
   {
     "hsreplay": {
       "sessionid": "BURAYA_CEREZ_DEGERI"
     }
   }
   ```

3. Çerez değerini almak için: tarayıcıda <https://hsreplay.net> adresine giriş yapın, `F12` ile
   geliştirici araçlarını açın, **Application → Cookies → https://hsreplay.net** altında
   `sessionid` satırının değerini kopyalayıp yukarıdaki dosyaya yapıştırın.

Bu çerez hesabınıza giriş anahtarıdır: kimseyle paylaşmayın. Dosya yalnızca bilgisayarınızda durur,
git'e girmez ve yalnızca hsreplay.net adresine gönderilir.

## İlk çalıştırma: bağlantı denetimi

Bir komut istemi açıp klasöre gidin ve şunu çalıştırın:

```
node scripts/probe-hsreplay.js
```

Her satırda `Ayrıştırma: OK` görüyorsanız her şey hazır. `BAŞARISIZ` görürseniz ekrandaki
"Biçim" ve "Ayrıştırma" satırlarını geliştiriciye iletin (bu satırlar kişisel veri içermez).

## Kullanım

1. `start.bat` dosyasına çift tıklayın. Tarayıcıda `http://127.0.0.1:4717` açılır.
2. **Güncelle**'ye basın. Kartlar, koleksiyonunuz ve meta desteler indirilir.
3. Listeden bir deste seçip **Deste kodunu kopyala**'ya basın.
4. Hearthstone'da yeni deste oluşturun; oyun panodaki kodu kendiliğinden algılar.

Yeni bir genişleme ya da denge yaması çıktığında yapmanız gereken tek şey yeniden **Güncelle**'ye
basmaktır. Yeni paket açtıysanız önce oyunda koleksiyon ekranını bir kez açın.

Kapatmak için siyah pencerede `Ctrl+C` tuşlarına basın ya da pencereyi kapatın.

## Listeyi okumak

- **Hemen kurulabilir:** bütün kartlar sizde var.
- **İkameyle kurulabilir:** eksik kartlar elinizdeki benzer kartlarla değiştirildi. Güven seviyesi
  bir tahmindir: kaç kartın değiştiğine ve değişenlerin destenin çekirdeği olup olmadığına bakar.
- **Kart eksik:** deste, üretmeniz gereken toz miktarıyla birlikte gösterilir.
- **Az veri:** 200 maçtan az oynanmış destelerin kazanma oranı sıralamada kullanılmaz.

Başka bir siteden ya da arkadaşınızdan aldığınız deste kodunu **Deste kodu ekle** alanına
yapıştırabilirsiniz.

## Sorun giderme

| Belirti | Çözüm |
|---|---|
| "HSReplay oturumu reddetti" | Çerezin süresi dolmuş. Yeni `sessionid` değerini `config.local.json` dosyasına yazın. |
| "HSReplay'e bağlanılamadı" | Ağınız hsreplay.net adresini engelliyor olabilir. Başka bir ağda deneyin. |
| "Port 4717 kullanımda" | Uygulama zaten açık. Tarayıcıda `http://127.0.0.1:4717` adresine gidin. |
| Bir kaynak güncellenemedi | Diğerleri güncellenir; başarısız olan son indirilen veriyle çalışmaya devam eder. |

## Sınırlar

- Deste kurallarını değiştiren kartlar (örneğin 40 kartlık desteler) doğrulanamaz ve uyarıyla gösterilir.
- Kartı elle değiştirdiğiniz destelerde yan deste (sideboard) bilgisi korunmaz.
- HSReplay'in kullandığımız adresleri resmi değildir; site değişirse güncelleme bozulabilir.
  O durumda deste kodu yapıştırma yolu çalışmaya devam eder.

## Geliştirme

```
npm test
```

Çalışma zamanı bağımlılığı yoktur. Tasarım: `docs/superpowers/specs/2026-11-12-deck-recommender-design.md`.
````

- [ ] **Step 5: Run tests, expect PASS, then commit**

```bash
npm test
git add scripts/probe-hsreplay.js test/probe.test.js README.md
git commit -m "Add HSReplay probe script and Windows setup guide"
```

---

## After the last task

The engine, server and UI are complete and tested against assumed HSReplay response shapes. What remains can only happen on the Windows machine: run `node scripts/probe-hsreplay.js`, and if any line reports `BAŞARISIZ`, adjust the matching parser in `src/sources/` to the real shape and update the spec's "Riskler" section with the verified endpoints.
