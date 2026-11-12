import { fetchCards } from './sources/cards.js';
import { fetchCollection } from './sources/collection.js';
import { fetchHsreplayDecks } from './sources/decks-hsreplay.js';

export async function runUpdate({ store, config, configError = null, fetchImpl = fetch, now = () => new Date().toISOString() }) {
  // Cards need no config; the HSReplay sources fail with the config error without making a request.
  const withConfig = (run) => (configError ? () => Promise.reject(new Error(configError)) : run);
  const sources = [
    ['cards', () => fetchCards(fetchImpl)],
    ['collection', withConfig(() => fetchCollection(config, fetchImpl))],
    ['decks', withConfig(() => fetchHsreplayDecks(config, fetchImpl))],
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
