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
