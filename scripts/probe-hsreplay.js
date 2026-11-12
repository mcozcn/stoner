import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readConfig } from '../src/config.js';
import { parseCollection, resolveAccount } from '../src/sources/collection.js';
import { parseDecks } from '../src/sources/decks-hsreplay.js';
import { hsreplayGet } from '../src/sources/hsreplay-http.js';

const MAX_KEYS = 8;
const MAX_DEPTH = 3;

// Describe structure only (key names of small objects, and types), so the output is safe to share.
export function shape(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length ? [`array(${value.length})`, shape(value[0], depth + 1)] : ['array(0)'];
  }
  if (typeof value !== 'object') return typeof value;
  if (depth >= MAX_DEPTH) return 'object';
  const keys = Object.keys(value);
  // A large object is a map keyed by data (such as card ids), so its keys are never printed.
  if (keys.length > MAX_KEYS) return { [`<${keys.length} anahtar>`]: shape(value[keys[0]], depth + 1) };
  return Object.fromEntries(keys.map((k) => [k, shape(value[k], depth + 1)]));
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
