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
