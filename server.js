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
        recommendations: new Map(),
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

  function present(rec, catalog, sets) {
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
      // Decks that break the normal rules are shown with these problems instead of being hidden.
      problems: validateDeck({ format: deck.format, cardClass: deck.cardClass, cards: finalCards }, catalog, sets),
      sideboard: (deck.sideboard ?? []).length > 0,
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
      let config = {};
      let configError = null;
      try {
        config = readConfig(configPath);
      } catch (err) {
        configError = err.message;
      }
      const status = await runUpdate({ store, config, configError, fetchImpl });
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
      const { catalog, collection, decks, recommendations } = state();
      // The expensive ranking is cached per format and class; the dust limit is applied afterwards.
      const key = `${format}|${cardClass}`;
      if (!recommendations.has(key)) {
        recommendations.set(key, recommend({ catalog, collection, decks, filters: { format, cardClass } }));
      }
      const maxDust = maxDustRaw === null ? null : Number(maxDustRaw);
      const sets = standardSets(catalog, decks);
      return recommendations
        .get(key)
        .filter((rec) => maxDust === null || rec.status !== 'missing' || rec.dust <= maxDust)
        .slice(0, MAX_RESULTS)
        .map((rec) => present(rec, catalog, sets));
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
      const unknown = Object.keys(clean).find((id) => !catalog.card(id));
      if (unknown) throw httpError(400, `Bilinmeyen kart: ${unknown}`);
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
