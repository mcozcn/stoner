const FORMAT_IDS = { wild: 1, standard: 2, classic: 3, twist: 4 };
const FORMAT_NAMES = Object.fromEntries(Object.entries(FORMAT_IDS).map(([name, id]) => [id, name]));
export const FORMATS = Object.keys(FORMAT_IDS);

const BAD = 'Deste kodu bozuk';

function extract(input) {
  const line = String(input ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  if (!line || !/^[A-Za-z0-9+/]+={0,2}$/.test(line)) throw new Error('Deste kodu bulunamadı');
  return line;
}

export function decode(input) {
  const bytes = Buffer.from(extract(input), 'base64');
  let pos = 0;
  const read = () => {
    let value = 0;
    let shift = 0;
    for (;;) {
      if (pos >= bytes.length || shift > 28) throw new Error(BAD);
      const byte = bytes[pos];
      pos += 1;
      value += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) return value;
      shift += 7;
    }
  };
  // A length prefix can never exceed the remaining bytes; this stops huge allocations.
  const many = (readItem) => {
    const n = read();
    if (n > bytes.length) throw new Error(BAD);
    return Array.from({ length: n }, readItem);
  };

  if (read() !== 0 || read() !== 1) throw new Error(BAD);
  const format = FORMAT_NAMES[read()];
  if (!format) throw new Error(BAD);
  const heroes = many(read);
  const cards = {};
  const add = (id, n) => {
    cards[id] = (cards[id] ?? 0) + n;
  };
  many(read).forEach((id) => add(id, 1));
  many(read).forEach((id) => add(id, 2));
  many(() => [read(), read()]).forEach(([id, n]) => add(id, n));

  let sideboard = [];
  if (pos < bytes.length && read() === 1) {
    // A sideboard we cannot parse must not make the whole deck unusable.
    try {
      const one = many(() => [read(), read()]).map(([id, owner]) => [id, 1, owner]);
      const two = many(() => [read(), read()]).map(([id, owner]) => [id, 2, owner]);
      const more = many(() => [read(), read(), read()]);
      sideboard = [...one, ...two, ...more];
    } catch {
      sideboard = [];
    }
  }
  return { format, heroes, cards, sideboard };
}

export function encode({ format, heroes, cards, sideboard = [] }) {
  if (!FORMAT_IDS[format]) throw new Error(`Bilinmeyen format: ${format}`);
  const out = [];
  const write = (value) => {
    let v = value;
    while (v > 0x7f) {
      out.push((v % 128) | 0x80);
      v = Math.floor(v / 128);
    }
    out.push(v);
  };
  // Entries are [dbfId, count, ...]; bucket 3 means "more than two copies".
  const bucket = (list, n) =>
    list.filter((entry) => (n === 3 ? entry[1] > 2 : entry[1] === n)).sort((a, b) => a[0] - b[0]);
  const entries = Object.entries(cards).map(([id, n]) => [Number(id), n]);

  [0, 1, FORMAT_IDS[format], heroes.length, ...heroes].forEach(write);
  for (const n of [1, 2]) {
    const group = bucket(entries, n);
    write(group.length);
    group.forEach(([id]) => write(id));
  }
  const rest = bucket(entries, 3);
  write(rest.length);
  rest.forEach(([id, n]) => [id, n].forEach(write));

  if (!sideboard.length) {
    write(0);
  } else {
    write(1);
    for (const n of [1, 2]) {
      const group = bucket(sideboard, n);
      write(group.length);
      group.forEach(([id, , owner]) => [id, owner].forEach(write));
    }
    const more = bucket(sideboard, 3);
    write(more.length);
    more.forEach((entry) => entry.forEach(write));
  }
  return Buffer.from(out).toString('base64');
}
