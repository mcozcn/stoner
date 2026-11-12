import { MAX_RUNES, inFormat, runeTotal } from './legality.js';

export function validateDeck({ format, cardClass, cards }, catalog, sets) {
  const problems = [];
  const perCanon = new Map();
  let total = 0;
  for (const [id, n] of Object.entries(cards)) {
    const canon = catalog.canonical(id);
    if (canon === null) {
      problems.push(`Bilinmeyen kart: ${id}`);
      continue;
    }
    total += n;
    perCanon.set(canon, (perCanon.get(canon) ?? 0) + n);
  }
  if (total !== 30) problems.push(`Deste 30 kart olmalı (şu an ${total})`);
  for (const [canon, n] of perCanon) {
    const { name } = catalog.card(canon);
    const max = catalog.maxCopies(canon);
    if (n > max) problems.push(`${name}: en fazla ${max} kopya olabilir`);
    if (!catalog.fitsClass(canon, cardClass)) problems.push(`${name}: bu sınıfta kullanılamaz`);
    if (!inFormat(canon, format, catalog, sets)) problems.push(`${name}: Standard'da geçerli değil`);
  }
  const known = [...perCanon.keys()].map((canon) => catalog.card(canon));
  if (runeTotal(known) > MAX_RUNES) problems.push(`Rün sınırı aşıldı (en fazla ${MAX_RUNES})`);
  return problems;
}
