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
      runeCost: c.runeCost ?? null,
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
