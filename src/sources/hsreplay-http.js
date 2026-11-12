const BASE = 'https://hsreplay.net';

export async function hsreplayGet(path, config, fetchImpl = fetch) {
  const headers = { accept: 'application/json', 'user-agent': 'stoner-deck-helper' };
  const sessionid = config?.hsreplay?.sessionid;
  if (sessionid !== undefined) {
    // Reject anything that is not a plain token so it cannot smuggle extra headers.
    if (typeof sessionid !== 'string' || !/^[\w-]+$/.test(sessionid)) {
      throw new Error('config.local.json içindeki sessionid geçersiz görünüyor');
    }
    headers.cookie = `sessionid=${sessionid}`;
  }
  let res;
  try {
    res = await fetchImpl(`${BASE}${path}`, { headers, signal: AbortSignal.timeout(20000) });
  } catch (err) {
    const why = err.name === 'TimeoutError' ? 'zaman aşımı' : err.message;
    throw new Error(`HSReplay'e bağlanılamadı (${why})`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('HSReplay oturumu reddetti: config.local.json içindeki sessionid çerezini yenileyin');
  }
  if (!res.ok) throw new Error(`HSReplay ${res.status} yanıtı verdi`);
  try {
    return await res.json();
  } catch {
    throw new Error('HSReplay yanıtı JSON değil');
  }
}
