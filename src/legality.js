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

export const MAX_RUNES = 3;
const RUNES = ['blood', 'frost', 'unholy'];

// A Death Knight deck may hold at most three runes: the sum of each rune's highest requirement.
export function runeTotal(cards) {
  return RUNES.reduce((sum, rune) => sum + Math.max(0, ...cards.map((c) => c.runeCost?.[rune] ?? 0)), 0);
}
