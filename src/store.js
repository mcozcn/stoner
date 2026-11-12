import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function createStore(dir) {
  const file = (name) => join(dir, `${name}.json`);
  return {
    read(name, fallback = null) {
      try {
        return JSON.parse(readFileSync(file(name), 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT') return fallback;
        throw err;
      }
    },
    // Write to a temp file first so a crash never leaves a half-written file.
    write(name, value) {
      mkdirSync(dir, { recursive: true });
      const tmp = `${file(name)}.tmp`;
      writeFileSync(tmp, JSON.stringify(value));
      renameSync(tmp, file(name));
    },
  };
}
