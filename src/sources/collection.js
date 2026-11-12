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
  if (!config?.hsreplay?.sessionid) {
    throw new Error('config.local.json bulunamadı ya da içinde hsreplay.sessionid yok (dosya adı .txt ile bitmemeli)');
  }
  const { region, accountLo } = await resolveAccount(config, fetchImpl);
  const query = new URLSearchParams({ region: String(region), account_lo: String(accountLo) });
  return parseCollection(await hsreplayGet(`/api/v1/collection/?${query}`, config, fetchImpl));
}
