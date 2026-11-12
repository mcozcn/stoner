import { readFileSync } from 'node:fs';

// Windows Notepad may save a UTF-8 BOM, which JSON.parse rejects.
export function readConfig(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`config.local.json okunamadı: ${err.message}`);
  }
}
