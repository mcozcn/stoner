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
