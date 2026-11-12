const $ = (selector) => document.querySelector(selector);

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const STATUS = { buildable: 'Hemen kurulabilir', substituted: 'İkameyle kurulabilir', missing: 'Kart eksik' };
const CONFIDENCE = { high: 'yüksek', medium: 'orta', low: 'düşük' };
const SOURCES = { cards: 'Kartlar', collection: 'Koleksiyon', decks: 'Meta desteler' };
const MAX_DUST = 12000;

const ownedCache = new Map();

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Sunucu hatası (${res.status})`);
  return data;
}

function notify(text) {
  $('#notice').textContent = text;
}

const byCost = (a, b) => a.cost - b.cost || a.name.localeCompare(b.name);

async function loadState() {
  const state = await api('/api/state');
  $('#sources').replaceChildren(
    ...Object.entries(SOURCES).map(([key, label]) => {
      const source = state.status[key];
      const when = source?.updatedAt ? new Date(source.updatedAt).toLocaleString('tr-TR') : 'hiç güncellenmedi';
      const failure = source?.error ? ` — son deneme başarısız: ${source.error}` : '';
      return el('li', { textContent: `${label}: ${when}${failure}` });
    }),
  );
  const select = $('#filters').elements.class;
  const current = select.value;
  select.replaceChildren(
    el('option', { value: '', textContent: 'Tümü' }),
    ...state.classes.map((c) => el('option', { value: c, textContent: c })),
  );
  select.value = state.classes.includes(current) ? current : '';
}

async function loadDecks() {
  const fields = $('#filters').elements;
  const query = new URLSearchParams({ format: fields.format.value });
  if (fields.class.value) query.set('class', fields.class.value);
  if (Number(fields.maxDust.value) < MAX_DUST) query.set('maxDust', fields.maxDust.value);
  const recs = await api(`/api/recommendations?${query}`);
  $('#decks').replaceChildren(
    ...(recs.length
      ? recs.map(deckCard)
      : [el('p', { textContent: "Gösterilecek deste yok. Güncelle'ye basın ya da bir deste kodu ekleyin." })]),
  );
}

async function refresh() {
  await loadState();
  await loadDecks();
}

function winRateText(rec) {
  if (rec.winRate == null) return 'kazanma oranı yok';
  return `%${rec.winRate.toFixed(1)} kazanma, ${rec.games} maç${rec.lowData ? ' (az veri)' : ''}`;
}

function statusText(rec) {
  const parts = [STATUS[rec.status]];
  if (rec.confidence) parts.push(`güven: ${CONFIDENCE[rec.confidence]} (tahmin)`);
  if (rec.dust > 0) parts.push(`eksikleri üretmek ${rec.dust} toz`);
  return parts.join(' · ');
}

function deckCard(rec) {
  const edit = new Map(rec.cards.map((c) => [String(c.dbfId), { ...c }]));
  let code = rec.code;

  const copy = el('button', { type: 'button', textContent: 'Deste kodunu kopyala', disabled: !code });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      notify(`${rec.name}: deste kodu kopyalandı. Oyunda yeni deste oluşturun; kod kendiliğinden algılanır.`);
    } catch {
      notify(`Kopyalanamadı. Kod: ${code}`);
    }
  });

  const problems = el('p', { className: 'problems' });
  const list = el('ul', { className: 'cards' });

  function renderList() {
    list.replaceChildren(
      ...[...edit.values()].sort(byCost).map((c) => {
        const change = el('button', { type: 'button', textContent: 'Değiştir' });
        change.setAttribute('aria-label', `${c.name} kartını değiştir`);
        change.addEventListener('click', () => openSwap(rec, c, applySwap));
        return el('li', {}, [`${c.cost} mana · ${c.name} ×${c.count} `, change]);
      }),
    );
  }

  async function applySwap(out, into) {
    const from = edit.get(String(out.dbfId));
    if (from.count > 1) from.count -= 1;
    else edit.delete(String(out.dbfId));
    const to = edit.get(String(into.dbfId));
    if (to) to.count += 1;
    else edit.set(String(into.dbfId), { dbfId: into.dbfId, name: into.name, cost: into.cost, count: 1 });
    renderList();
    const cards = Object.fromEntries([...edit].map(([id, c]) => [id, c.count]));
    try {
      const result = await api('/api/deckstring', {
        method: 'POST',
        body: { format: rec.format, cardClass: rec.cardClass, cards },
      });
      code = result.code;
      copy.disabled = false;
      problems.textContent = result.problems.length ? `Uyarı: ${result.problems.join(' · ')}` : '';
      notify(`${rec.name}: ${out.name} yerine ${into.name} kondu. Yeni kod hazır.`);
    } catch (err) {
      notify(err.message);
    }
  }

  renderList();

  const children = [
    el('h3', { textContent: rec.name }),
    el('p', { className: 'meta', textContent: `${rec.cardClass} · ${rec.format} · ${winRateText(rec)}` }),
    el('p', { className: `status status-${rec.status}`, textContent: statusText(rec) }),
  ];
  if (rec.stale) {
    children.push(el('p', { textContent: "Bu destede tanınmayan kart var; Güncelle'ye basın." }));
  }
  if (rec.missing.length) {
    const names = rec.missing.map((m) => `${m.name} ×${m.count}${m.core ? ' (çekirdek kart)' : ''}`);
    children.push(el('p', { textContent: `Eksik: ${names.join(', ')}` }));
  }
  if (rec.swaps.length) {
    children.push(
      el(
        'ul',
        { className: 'swaps' },
        rec.swaps.map((s) => {
          const others = s.alternatives.filter((a) => a.dbfId !== s.in.dbfId).map((a) => a.name);
          const tail = others.length ? ` (diğer adaylar: ${others.join(', ')})` : '';
          return el('li', { textContent: `${s.out.name} yerine ${s.in.name}${tail}` });
        }),
      ),
    );
  }
  children.push(el('details', {}, [el('summary', { textContent: 'Kart listesi ve değiştirme' }), list]), problems);

  const actions = el('div', { className: 'actions' }, [copy]);
  if (rec.source === 'pasted') {
    const remove = el('button', { type: 'button', textContent: 'Desteyi sil' });
    remove.addEventListener('click', async () => {
      try {
        await api(`/api/decks/${encodeURIComponent(rec.id)}`, { method: 'DELETE' });
        notify(`${rec.name} silindi.`);
        await refresh();
      } catch (err) {
        notify(err.message);
      }
    });
    actions.append(remove);
  }
  children.push(actions);

  return el('article', { className: 'deck' }, children);
}

async function openSwap(rec, card, apply) {
  const key = `${rec.cardClass}|${rec.format}`;
  try {
    if (!ownedCache.has(key)) {
      ownedCache.set(key, await api(`/api/owned?class=${rec.cardClass}&format=${rec.format}`));
    }
  } catch (err) {
    notify(err.message);
    return;
  }
  const dialog = $('#swap');
  const search = $('#swap-search');
  $('#swap-h').textContent = `${card.name} yerine hangi kart?`;

  const render = () => {
    // Card names are English, so use plain lowercasing (Turkish rules would turn "I" into "ı").
    const term = search.value.trim().toLowerCase();
    const matches = ownedCache
      .get(key)
      .filter((c) => c.dbfId !== card.dbfId && c.name.toLowerCase().includes(term))
      .slice(0, 100);
    $('#swap-list').replaceChildren(
      ...matches.map((c) => {
        const pick = el('button', { type: 'button', textContent: `${c.cost} mana · ${c.name} (sende ${c.owned})` });
        pick.addEventListener('click', () => {
          dialog.close();
          apply(card, c);
        });
        return el('li', {}, [pick]);
      }),
    );
  };

  search.value = '';
  search.oninput = render;
  render();
  dialog.showModal();
}

$('#filters').addEventListener('input', () => {
  const fields = $('#filters').elements;
  fields.dustOut.value = Number(fields.maxDust.value) < MAX_DUST ? `${fields.maxDust.value} toz` : 'sınırsız';
  loadDecks().catch((err) => notify(err.message));
});

$('#update').addEventListener('click', async () => {
  const button = $('#update');
  button.disabled = true;
  notify('Güncelleniyor…');
  try {
    const status = await api('/api/update', { method: 'POST' });
    const failed = Object.entries(status)
      .filter(([, source]) => source.error)
      .map(([key]) => SOURCES[key] ?? key);
    notify(
      failed.length
        ? `Güncelleme kısmen başarısız: ${failed.join(', ')}. Ayrıntı "Veri durumu" bölümünde.`
        : 'Tüm veriler güncellendi.',
    );
    ownedCache.clear();
    await refresh();
  } catch (err) {
    notify(err.message);
  } finally {
    button.disabled = false;
  }
});

$('#paste').addEventListener('submit', async (event) => {
  event.preventDefault();
  const field = $('#code');
  try {
    const added = await api('/api/decks', { method: 'POST', body: { code: field.value } });
    field.value = '';
    notify(`${added.name} eklendi.`);
    await refresh();
  } catch (err) {
    notify(err.message);
  }
});

refresh().catch((err) => notify(err.message));
