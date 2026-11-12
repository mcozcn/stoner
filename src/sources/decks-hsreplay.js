import { hsreplayGet } from './hsreplay-http.js';

const GAME_TYPES = { standard: 'RANKED_STANDARD', wild: 'RANKED_WILD' };
const BAD = 'Deste yanıtı beklenen biçimde değil';

function cardList(value) {
  let list = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
    } catch {
      throw new Error(BAD);
    }
  }
  if (!Array.isArray(list) || !list.every((e) => Array.isArray(e) && Number.isInteger(e[0]) && Number.isInteger(e[1]))) {
    throw new Error(BAD);
  }
  return Object.fromEntries(list.map(([id, n]) => [id, n]));
}

export function parseDecks(body, archetypes, format) {
  const data = body?.series?.data;
  if (!data || typeof data !== 'object') throw new Error(BAD);
  const names = new Map((Array.isArray(archetypes) ? archetypes : []).map((a) => [a.id, a.name]));
  const decks = [];
  for (const [cardClass, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) throw new Error(BAD);
    for (const row of rows) {
      if (!row?.deck_id) throw new Error(BAD);
      const archetype = names.get(row.archetype_id) ?? null;
      const winRate = Number(row.win_rate);
      const games = Number(row.total_games);
      decks.push({
        id: `hsreplay:${format}:${row.deck_id}`,
        source: 'hsreplay',
        name: archetype ?? `${cardClass} destesi`,
        archetype,
        cardClass,
        format,
        cards: cardList(row.deck_list),
        winRate: Number.isFinite(winRate) ? winRate : null,
        games: Number.isFinite(games) ? games : null,
      });
    }
  }
  if (!decks.length) throw new Error(BAD);
  return decks;
}

export async function fetchHsreplayDecks(config, fetchImpl = fetch) {
  const archetypes = await hsreplayGet('/api/v1/archetypes/', config, fetchImpl);
  const decks = [];
  for (const [format, gameType] of Object.entries(GAME_TYPES)) {
    const path = `/analytics/query/list_decks_by_win_rate_v2/?GameType=${gameType}`;
    decks.push(...parseDecks(await hsreplayGet(path, config, fetchImpl), archetypes, format));
  }
  return decks;
}
