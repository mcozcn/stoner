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
