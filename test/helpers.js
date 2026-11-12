export function card(dbfId, name, cardClass, cost, type, rarity, set, extra = {}) {
  return {
    dbfId,
    id: `T_${dbfId}`,
    name,
    cardClass,
    classes: [cardClass],
    cost,
    type,
    rarity,
    set,
    races: [],
    spellSchool: null,
    mechanics: [],
    text: '',
    copyOf: null,
    ...extra,
  };
}

// A tiny card universe. SPACE and CORE stand in for Standard sets, GVG and LEGACY for Wild-only sets.
export const CARDS = [
  card(7, 'Garrosh', 'WARRIOR', 0, 'HERO', 'FREE', 'HERO_SKINS', { id: 'HERO_01' }),
  card(637, 'Jaina', 'MAGE', 0, 'HERO', 'FREE', 'HERO_SKINS', { id: 'HERO_08' }),
  card(101, 'Arcane Bolt', 'MAGE', 1, 'SPELL', 'COMMON', 'SPACE', { spellSchool: 'ARCANE' }),
  card(102, 'Frost Ring', 'MAGE', 2, 'SPELL', 'RARE', 'SPACE', { spellSchool: 'FROST' }),
  card(103, 'Star Mage', 'MAGE', 3, 'MINION', 'EPIC', 'SPACE', { mechanics: ['BATTLECRY'] }),
  card(104, 'Archmage Prime', 'MAGE', 5, 'MINION', 'LEGENDARY', 'SPACE'),
  card(105, 'Arcane Dart', 'MAGE', 1, 'SPELL', 'COMMON', 'SPACE', { spellSchool: 'ARCANE' }),
  card(106, 'Apprentice', 'MAGE', 3, 'MINION', 'COMMON', 'SPACE', { mechanics: ['BATTLECRY'] }),
  card(201, 'Space Rat', 'NEUTRAL', 1, 'MINION', 'COMMON', 'SPACE'),
  card(202, 'Void Trader', 'NEUTRAL', 3, 'MINION', 'RARE', 'SPACE'),
  card(203, 'Old Mech', 'NEUTRAL', 3, 'MINION', 'COMMON', 'GVG'),
  card(301, 'Fireball', 'MAGE', 4, 'SPELL', 'COMMON', 'CORE', { copyOf: 302 }),
  card(302, 'Fireball', 'MAGE', 4, 'SPELL', 'COMMON', 'LEGACY'),
  card(401, 'War Axe', 'WARRIOR', 2, 'WEAPON', 'COMMON', 'SPACE'),
  ...Array.from({ length: 12 }, (_, i) =>
    card(500 + i, `Filler ${i}`, 'NEUTRAL', (i % 6) + 1, 'MINION', 'COMMON', 'SPACE'),
  ),
];

// A valid 30-card Standard Mage list: 12 fillers x2 plus three Mage cards x2.
export const FULL_DECK_CARDS = {
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [500 + i, 2])),
  101: 2,
  102: 2,
  103: 2,
};

export function deck(id, cards, extra = {}) {
  return {
    id,
    source: 'hsreplay',
    name: id,
    archetype: null,
    cardClass: 'MAGE',
    format: 'standard',
    cards,
    winRate: 55,
    games: 1000,
    ...extra,
  };
}

// Raw HearthstoneJSON-shaped cards, enough to pass the minimum-count check.
export function rawCards(n = 1000) {
  return Array.from({ length: n }, (_, i) => ({
    dbfId: i + 1,
    id: `RAW_${i + 1}`,
    name: `Raw ${i + 1}`,
    rarity: 'COMMON',
    set: 'SPACE',
    type: 'MINION',
    cardClass: 'NEUTRAL',
    cost: 1,
  }));
}

// routes: { 'substring of url': { status?: number, body: any } }. First matching key wins.
export function stubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const hit = Object.entries(routes).find(([key]) => String(url).includes(key));
    const { status = 200, body = {} } = hit ? hit[1] : { status: 404 };
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}
