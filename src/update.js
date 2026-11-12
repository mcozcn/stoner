import { fetchCards } from './sources/cards.js';
import { fetchCollection } from './sources/collection.js';
import { fetchHsreplayDecks } from './sources/decks-hsreplay.js';

export async function runUpdate({ store, config, fetchImpl = fetch, now = () => new Date().toISOString() }) {
  const sources = [
    ['cards', () => fetchCards(fetchImpl)],
    ['collection', () => fetchCollection(config, fetchImpl)],
    ['decks', () => fetchHsreplayDecks(config, fetchImpl)],
  ];
  const status = store.read('status', {});
  for (const [name, run] of sources) {
    try {
      store.write(name, await run());
      status[name] = { updatedAt: now(), error: null };
    } catch (err) {
      // Keep the previous file and its timestamp; only record why this attempt failed.
      status[name] = { updatedAt: status[name]?.updatedAt ?? null, error: err.message };
    }
  }
  store.write('status', status);
  return status;
}
