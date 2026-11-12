import { readFileSync } from 'node:fs';

export function readConfig(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`config.local.json okunamadı: ${err.message}`);
  }
}
