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
  if (format !== 'standard' && format !== 'wild') throw new Error('Yalnızca Standard ve Wild desteleri destekleniyor');
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
