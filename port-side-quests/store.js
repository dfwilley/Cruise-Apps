/* Port Side Quests — the journal kept on this phone (IndexedDB, so photos have room).
   Each entry: { id, theme, title, kind, port, portId, foundAt, note, photos: [Blob], tripId, uploaded } */
(function (root) {
  'use strict';
  const DB = 'port-side-quests', STORE = 'entries';
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error('This browser cannot store the journal (no IndexedDB). Try Safari or Chrome.'));
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { const s = req.result.createObjectStore(STORE, { keyPath: 'id' }); s.createIndex('foundAt', 'foundAt'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open the journal storage'));
    });
    return dbp;
  }
  function tx(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode), s = t.objectStore(STORE);
      let result;
      Promise.resolve(fn(s, r => { result = r; })).catch(reject);
      t.oncomplete = () => resolve(result);
      t.onerror = t.onabort = () => reject(t.error || new Error('Journal storage error (the phone may be out of space)'));
    }));
  }
  const all = () => tx('readonly', (s, done) => { const r = s.getAll(); r.onsuccess = () => done((r.result || []).sort((a, b) => (b.foundAt || '').localeCompare(a.foundAt || ''))); });
  const put = e => tx('readwrite', s => { s.put(e); });
  const get = id => tx('readonly', (s, done) => { const r = s.get(id); r.onsuccess = () => done(r.result || null); });
  const remove = id => tx('readwrite', s => { s.delete(id); });

  /** Shrinks a photo to at most 1600 px on the long side, saved as JPEG (about 200–500 KB). */
  function compress(file, maxSide = 1600, quality = 0.8) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve(null);
      if (file.size > 30e6) return reject(new Error('That photo is over 30 MB'));
      const url = URL.createObjectURL(file), img = new Image();
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a photo this browser can read')); };
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => b ? resolve(b) : reject(new Error('Could not compress the photo')), 'image/jpeg', quality);
      };
      img.src = url;
    });
  }

  const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  const dataUrlToBlob = async d => (await fetch(d)).blob();

  /** Backup file: the whole journal, photos included, as one JSON file. */
  async function exportJson() {
    const entries = await all(), out = [];
    for (const e of entries) out.push(Object.assign({}, e, { photos: await Promise.all((e.photos || []).map(blobToDataUrl)) }));
    return JSON.stringify({ schema: 'port-side-quests-journal-v2', exported: new Date().toISOString(), entries: out });
  }
  async function importJson(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.entries) || !/^port-side-quests-journal-v[12]$/.test(data.schema || '')) throw new Error('This is not a Port Side Quests journal file');
    const have = new Set((await all()).map(e => e.id));
    let added = 0;
    for (const x of data.entries.slice(0, 2000)) {
      if (!x || typeof x.id !== 'string' || have.has(x.id) || typeof x.title !== 'string') continue;
      const pics = (Array.isArray(x.photos) ? x.photos : x.photo ? [x.photo] : []).filter(p => typeof p === 'string' && p.startsWith('data:image/')).slice(0, 3);
      await put({ id: x.id.slice(0, 64), theme: ['waterfront', 'taste', 'mechanism', 'story'].includes(x.theme || x.type) ? (x.theme || x.type) : 'other',
        title: x.title.slice(0, 200), kind: String(x.kind || '').slice(0, 60), port: String(x.port || '').slice(0, 200), portId: String(x.portId || '').slice(0, 100),
        foundAt: String(x.foundAt || x.date || new Date().toISOString()).slice(0, 40), note: String(x.note || x.notes || '').slice(0, 5000),
        photos: await Promise.all(pics.map(dataUrlToBlob)), tripId: null, uploaded: false });
      added++;
    }
    return added;
  }

  root.QuestStore = { all, put, get, remove, compress, exportJson, importJson };
})(window);
