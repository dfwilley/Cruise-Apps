/* Port Side Quests — screens. Logic lives in quests.js, the phone journal in store.js, sharing in sync.js. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const Q = window.Quests, P = window.HourPlanner, S = window.QuestStore, Sync = window.QuestSync;
  const FACTS = window.PORT_FACTS, WEB_URL = 'https://dfwilley.github.io/Cruise-Apps/port-side-quests/';
  const native = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.psq);
  const isApple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
               set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } } };

  let voyage, port, quests = [], seed = Math.floor(Math.random() * 1000);
  let themes = ls.get('psq-themes', Q.ORDER.slice());
  let active = ls.get('psq-active', null);
  let recording = null, photoBlobs = [], editing = null;
  let tripId = ls.get('psq-trip', ''), trips = [], sharedRows = [], memberNames = {}, objectUrls = [];

  if (native) $('backLink').hidden = true;

  /* ---------- 1. Port stop ---------- */
  const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  function fillVoyages() {
    if (!FACTS || !FACTS.voyages) { $('questStatus').textContent = 'Port data did not load. Open the app once with a connection.'; return; }
    $('voyage').innerHTML = FACTS.voyages.map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('');
    const saved = ls.get('psq-stop', {});
    if (saved.voyage && FACTS.voyages.some(v => v.id === saved.voyage)) $('voyage').value = saved.voyage;
    chooseVoyage(saved);
  }
  function chooseVoyage(saved) {
    voyage = FACTS.voyages.find(v => v.id === $('voyage').value) || FACTS.voyages[0];
    $('port').innerHTML = voyage.ports.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    if (saved && saved.port && voyage.ports.some(p => p.id === saved.port)) $('port').value = saved.port;
    choosePort(saved);
  }
  function choosePort(saved) {
    port = voyage.ports.find(p => p.id === $('port').value) || voyage.ports[0];
    $('day').innerHTML = port.days.map((d, i) => {
      const t = [d.from ? 'arrives ' + d.from : '', d.to ? 'leaves ' + d.to : ''].filter(Boolean).join(', ');
      return `<option value="${i}">${esc(fmtDate(d.date))}${t ? ' · ' + esc(t) : ''}${d.note ? ' · ' + esc(d.note) : ''}</option>`;
    }).join('');
    $('pier').innerHTML = port.piers.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('');
    const primary = port.piers.findIndex(p => p.primary);
    $('pier').value = String(primary >= 0 ? primary : 0);
    if (saved && saved.port === port.id) {
      if (saved.day != null && port.days[saved.day]) $('day').value = String(saved.day);
      if (saved.pier != null && port.piers[saved.pier]) $('pier').value = String(saved.pier);
    }
    chooseDay(saved && saved.port === port.id ? saved : null);
  }
  function chooseDay(saved) {
    const day = port.days[+$('day').value], w = Q.suggestedWindow(day);
    if (saved && saved.ready) { $('ready').value = saved.ready; $('back').value = saved.back; $('overnight').checked = !!saved.overnight; $('confirmed').checked = !!saved.confirmed; }
    else {
      $('ready').value = w.ready;
      $('back').value = w.back;
      $('overnight').checked = w.overnight;
      $('confirmed').checked = false;
    }
    const parts = [];
    if (day && (day.from || day.to)) parts.push(`Itinerary: ${day.from ? 'ship arrives ' + day.from : ''}${day.from && day.to ? ', ' : ''}${day.to ? 'leaves ' + day.to : ''} (local time).`);
    if (!w.guessReady && !w.guessBack) parts.push('Times above assume you can go ashore 30 minutes after arrival and must be back 30 minutes before departure. Change them to match the ship’s daily program.');
    else if (w.guessReady && w.guessBack) parts.push('The itinerary has no times for this day, so ' + w.ready + ' to ' + w.back + ' is only a placeholder. Enter the real times from the ship’s daily program.');
    else parts.push('The ' + (w.guessBack ? 'return' : 'going-ashore') + ' time (' + (w.guessBack ? w.back : w.ready) + ') is only a placeholder; the itinerary doesn’t list it. Enter the real time from the ship’s daily program.');
    $('timeSource').textContent = parts.join(' ');
    $('pierNote').textContent = (port.piers[+$('pier').value] || {}).note || '';
    renderQuests();
  }
  function saveStop() {
    ls.set('psq-stop', { voyage: voyage.id, port: port.id, day: +$('day').value, pier: +$('pier').value, ready: $('ready').value,
      back: $('back').value, overnight: $('overnight').checked, confirmed: $('confirmed').checked });
    ls.set('psq-walk', { buffer: $('buffer').value, extra: $('extra').value, speed: $('speed').value, factor: $('factor').value, origin: $('origin').value });
  }
  (function restoreWalk() { const w = ls.get('psq-walk', null); if (!w) return; for (const k of ['buffer', 'extra', 'speed', 'factor', 'origin']) if (w[k] != null) $(k).value = w[k]; })();

  function planOptions() {
    const total = P.budget($('ready').value, $('back').value, $('overnight').checked);
    const buffer = +$('buffer').value, extra = +$('extra').value;
    if (!Number.isFinite(total) || total <= 0) throw new Error('"Back at the ship" must be after "Ready to go ashore" (tick the overnight box if it is the next day).');
    if (total > 1440) throw new Error('That time ashore is longer than a day.');
    if (!(buffer >= 15 && buffer <= 180) || !(extra >= 0 && extra <= 120)) throw new Error('Safety buffer must be 15–180 minutes and extra slack 0–120.');
    const pier = port.piers[+$('pier').value] || port.piers[0];
    return { total, buffer, extra, speed: +$('speed').value, factor: +$('factor').value, start: $('origin').value === 'center' ? port.center : pier, end: pier, endTime: $('back').value };
  }

  /* ---------- 2. Quests ---------- */
  function renderThemes() {
    $('themes').innerHTML = Q.ORDER.map(t => `<button type="button" class="chip" data-theme="${t}" aria-pressed="${themes.includes(t)}">${Q.THEMES[t].icon} ${esc(Q.THEMES[t].short)}</button>`).join('');
  }
  function timeline(q, o) {
    const p = q.plan, parts = [['t-out', p.out], ['t-visit', q.visit], ['t-back', p.back], ['t-buffer', o.buffer + o.extra], ['t-spare', Math.max(0, p.spare)]];
    const sum = parts.reduce((a, x) => a + x[1], 0) || 1;
    return `<div class="timeline" aria-hidden="true">${parts.map(([c, v]) => `<span class="${c}" style="width:${(v / sum * 100).toFixed(1)}%"></span>`).join('')}</div>`;
  }
  function mapLink(pl) {
    return isApple ? `https://maps.apple.com/?daddr=${pl.lat},${pl.lon}&dirflg=w` : `https://www.google.com/maps/dir/?api=1&destination=${pl.lat},${pl.lon}&travelmode=walking`;
  }
  function questCard(q, o) {
    const T = Q.THEMES[q.theme], p = q.plan;
    return `<article class="quest ${q.theme}${p.fits ? '' : ' nofit'}">
      <p class="eyebrow">${T.icon} ${esc(T.title)}</p>
      <h3>${esc(q.place.name)}</h3><div class="kind">${esc(q.kind)}${q.place.fallback ? ' · from Port Pocket Guide' : ''}</div>
      <p>${esc(q.task)}</p>
      ${q.clues.length ? `<ul class="clues">${q.clues.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      ${timeline(q, o)}
      <div class="timing">${p.out} min there · ${q.visit} min quest · ${p.back} min back · ${o.buffer + o.extra} min safety<br>
      ${p.fits ? `<span class="headback">Head back by ${esc(q.headBackBy)}</span> · ${p.spare} min to spare` : `<b>Doesn't fit: needs ${-p.spare} more minutes</b>`}</div>
      <p class="hint">${q.place.hours ? 'Listed hours: ' + esc(q.place.hours) + ' (check on the day).' : 'Opening hours not listed; check on the day.'}</p>
      <div class="row"><button data-start="${esc(q.id)}" ${p.fits ? '' : 'disabled'}>Start this quest</button>
      <a class="btn soft" href="${mapLink(q.place)}" target="_blank" rel="noopener">Walking directions</a></div></article>`;
  }
  function renderQuests() {
    if (!port) return;
    saveStop();
    $('picks').innerHTML = ''; $('more').innerHTML = ''; $('moreBox').hidden = true; $('surpriseRow').hidden = true;
    let o;
    try { o = planOptions(); } catch (e) { $('questStatus').textContent = e.message; return; }
    if (!$('confirmed').checked) { $('questStatus').textContent = 'Tick the box above once you have checked the all-aboard time. Then your quests appear.'; return; }
    if (!themes.length) { $('questStatus').textContent = 'Pick at least one kind of quest.'; return; }
    quests = Q.buildQuests(port.id, o, { questPlaces: window.QUEST_PLACES, guidePlaces: window.PORT_PLACES }, P);
    const picks = Q.pickFour(quests, themes, seed);
    const fitting = quests.filter(q => q.plan.fits && themes.includes(q.theme));
    const ashore = o.total - o.buffer - o.extra;
    if (!picks.length) {
      $('questStatus').textContent = ashore < 30 ? `Only ${Math.max(0, ashore)} minutes ashore after your safety margins. Not enough for a quest this time.` : 'No quests of these kinds fit your time from here. Try other kinds, start from the town centre, or a brisker pace.';
    } else {
      $('questStatus').textContent = `${fitting.length} quest${fitting.length === 1 ? '' : 's'} fit your ${Math.floor(o.total / 60)} h ${o.total % 60} min ashore. Here ${picks.length === 1 ? 'is one' : 'are ' + picks.length}:`;
      $('picks').innerHTML = picks.map(q => questCard(q, o)).join('');
      $('surpriseRow').hidden = fitting.length <= picks.length;
    }
    if (!window.QUEST_PLACES) $('questStatus').textContent += ' (Quest places are still being prepared; showing places from Port Pocket Guide.)';
    const rest = quests.filter(q => themes.includes(q.theme) && !picks.includes(q)).slice(0, 40);
    if (rest.length) {
      $('moreBox').hidden = false;
      $('moreSummary').textContent = `More quests nearby (${rest.length})`;
      $('more').innerHTML = rest.map(q => `<div class="mini"><div><b>${Q.THEMES[q.theme].icon} ${esc(q.place.name)}</b><small>${esc(q.kind)} · ${q.plan.out} min walk · ${q.plan.fits ? 'head back by ' + esc(q.headBackBy) : 'doesn’t fit'}</small></div>
        <button class="soft small" data-show="${esc(q.id)}">Show</button></div>`).join('');
    }
  }
  function startQuest(q) {
    active = { id: q.id, theme: q.theme, title: q.place.name, kind: q.kind, task: q.task, record: q.record, port: port.name, portId: port.id, headBackBy: q.headBackBy, back: $('back').value };
    ls.set('psq-active', active); showActive();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function showActive() {
    $('activeBar').hidden = !active;
    if (!active) return;
    $('activeTitle').textContent = Q.THEMES[active.theme].icon + ' ' + active.title;
    $('activeTime').textContent = `Head back by ${active.headBackBy} · all aboard ${active.back}`;
  }

  /* ---------- Recording a discovery ---------- */
  function openRecord(q) {
    recording = q; photoBlobs = [];
    const free = !q;
    $('freeFields').hidden = !free;
    $('recordTheme').textContent = free ? 'Your own discovery' : Q.THEMES[q.theme].icon + ' ' + Q.THEMES[q.theme].title;
    $('recordTitle').textContent = free ? 'Add a discovery' : q.title;
    $('recordTask').textContent = free ? '' : q.task;
    $('note').value = ''; $('note').placeholder = free ? 'What did you find?' : (q.record || []).map(r => r + ': ').join('\n');
    if (free) { $('freeTitle').value = ''; $('freeTheme').innerHTML = Q.ORDER.map(t => `<option value="${t}">${Q.THEMES[t].icon} ${esc(Q.THEMES[t].short)}</option>`).join(''); }
    $('photos').value = ''; $('thumbs').innerHTML = '';
    const trip = trips.find(t => t.id === tripId);
    $('recordShare').textContent = Sync.user() && trip ? `Will be shared with “${trip.name}”.` : 'Saved on this phone only.';
    $('recordDialog').showModal();
  }
  $('photos').onchange = async () => {
    const files = [...$('photos').files].slice(0, 3);
    if ($('photos').files.length > 3) alert('Only the first 3 photos are kept.');
    $('thumbs').textContent = 'Preparing photos…';
    try {
      photoBlobs = [];
      for (const f of files) photoBlobs.push(await S.compress(f));
      $('thumbs').innerHTML = photoBlobs.map(b => `<img alt="" src="${URL.createObjectURL(b)}">`).join('');
    } catch (e) { photoBlobs = []; $('thumbs').textContent = e.message; }
  };
  $('saveRecord').onclick = async () => {
    const free = !recording;
    const title = free ? $('freeTitle').value.trim() : recording.title;
    if (!title) { alert('Give your discovery a name.'); return; }
    const p = port || { name: '', id: '' };
    const entry = { id: crypto.randomUUID ? crypto.randomUUID() : fallbackUuid(), theme: free ? $('freeTheme').value : recording.theme,
      title: title.slice(0, 200), kind: free ? '' : recording.kind, port: free ? p.name : recording.port, portId: free ? p.id : recording.portId,
      foundAt: new Date().toISOString(), note: $('note').value.slice(0, 5000), photos: photoBlobs.slice(0, 3), sharedTrips: [], pendingTrip: Sync.user() && tripId ? tripId : null };
    try { await S.put(entry); } catch (e) { alert('Could not save: ' + e.message); return; }
    $('recordDialog').close();
    if (!free) { active = null; ls.set('psq-active', null); showActive(); }
    showTab('journal');
    await renderJournal();
    if (Sync.user() && tripId) shareEntry(entry).then(renderJournal);
  };
  $('cancelRecord').onclick = () => $('recordDialog').close();
  function fallbackUuid() { const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; const h = [...b].map(x => x.toString(16).padStart(2, '0')).join(''); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; }

  /* ---------- Journal ---------- */
  function clearUrls() { objectUrls.forEach(u => URL.revokeObjectURL(u)); objectUrls = []; }
  const blobUrl = b => { const u = URL.createObjectURL(b); objectUrls.push(u); return u; };
  async function renderJournal() {
    let local = [];
    try { local = await S.all(); } catch (e) { $('entries').innerHTML = `<p class="notice">${esc(e.message)}</p>`; return; }
    const inTrip = !!(Sync.user() && tripId && trips.some(t => t.id === tripId));
    const sharedIds = new Set(sharedRows.map(r => r.id));
    const items = [];
    if (inTrip) {
      for (const r of sharedRows) items.push({ shared: r, id: r.id, theme: r.theme, title: r.title, kind: r.kind, port: r.port, portId: r.port_id, foundAt: r.found_at, note: r.note, pics: r.photoUrls, mine: r.mine, author: memberNames[r.author_id] || 'Someone' });
      for (const e of local) if (!sharedIds.has(e.id)) items.push({ local: e, id: e.id, theme: e.theme, title: e.title, kind: e.kind, port: e.port, portId: e.portId, foundAt: e.foundAt, note: e.note, pics: (e.photos || []).map(blobUrl), mine: true, waiting: true });
      const trip = trips.find(t => t.id === tripId);
      $('journalWhere').textContent = `Showing the shared journal for “${trip.name}”, plus anything on this phone not shared yet.`;
    } else {
      for (const e of local) items.push({ local: e, id: e.id, theme: e.theme, title: e.title, kind: e.kind, port: e.port, portId: e.portId, foundAt: e.foundAt, note: e.note, pics: (e.photos || []).map(blobUrl), mine: true });
      $('journalWhere').textContent = Sync.configured() ? 'Saved on this phone. Join a shared trip to see and add to a journal with your travel partner.' : 'Saved on this phone.';
    }
    items.sort((a, b) => String(b.foundAt).localeCompare(String(a.foundAt)));
    $('journalCount').textContent = items.length;
    $('badges').innerHTML = Q.badges(items).map(b => `<div class="badge${b.earned ? ' earned' : ''}"><b>${b.icon}</b>${esc(b.badge)}<br>${b.count} / 3</div>`).join('');
    const ports = [...new Map(items.filter(i => i.port).map(i => [i.portId || i.port, i.port])).entries()];
    const sel = $('journalPort').value;
    $('journalPort').innerHTML = '<option value="">All ports</option>' + ports.map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
    $('journalPort').value = ports.some(([id]) => id === sel) ? sel : '';
    const shown = items.filter(i => !$('journalPort').value || (i.portId || i.port) === $('journalPort').value);
    const canDelete = i => i.local || i.mine || (trips.find(t => t.id === tripId) || {}).mine;
    $('entries').innerHTML = shown.length ? shown.map(i => {
      const T = Q.THEMES[i.theme] || { icon: '✨', short: 'Discovery' };
      return `<article class="entry"><div class="eyebrow">${T.icon} ${esc(T.short)}${i.waiting ? '<span class="tag wait">not shared yet</span>' : ''}</div>
        <h3>${esc(i.title)}</h3>
        <div class="meta">${esc(i.port)} · ${esc(new Date(i.foundAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }))}${i.author ? ' · by ' + esc(i.author) : ''}</div>
        ${i.note ? `<p>${esc(i.note)}</p>` : ''}
        ${i.pics && i.pics.length ? `<div class="pics">${i.pics.map(u => `<img loading="lazy" alt="Photo of ${esc(i.title)}" src="${esc(u)}">`).join('')}</div>` : ''}
        <div class="row">${i.mine ? `<button class="soft small" data-edit="${esc(i.id)}">Edit note</button>` : ''}${canDelete(i) ? `<button class="danger small" data-del="${esc(i.id)}">Delete</button>` : ''}</div></article>`;
    }).join('') : '<p>No discoveries yet. Start a quest, then tap “Record discovery”.</p>';
    $('entries')._items = items;
  }
  $('journalPort').onchange = renderJournal;
  $('entries').onclick = async ev => {
    const items = $('entries')._items || [];
    const ed = ev.target.closest('[data-edit]'), del = ev.target.closest('[data-del]');
    if (ed) { editing = items.find(i => i.id === ed.dataset.edit); if (!editing) return; $('editNote').value = editing.note || ''; $('editDialog').showModal(); }
    if (del) {
      const it = items.find(i => i.id === del.dataset.del); if (!it) return;
      if (!confirm(it.shared ? 'Delete this discovery from the shared trip for everyone, and from this phone? This cannot be undone.' : 'Delete this discovery from this phone? This cannot be undone.')) return;
      await run(async () => { if (it.shared) await Sync.deleteEntry(it.shared); await S.remove(it.id); sharedRows = sharedRows.filter(r => r.id !== it.id); }, 'Deleted.');
      renderJournal();
    }
  };
  $('saveEdit').onclick = async () => {
    const note = $('editNote').value.slice(0, 5000), it = editing;
    $('editDialog').close();
    await run(async () => {
      const local = await S.get(it.id);
      if (local) { local.note = note; await S.put(local); }
      if (it.shared) { await Sync.updateNote(it.id, note); it.shared.note = note; }
    }, 'Note saved.');
    renderJournal();
  };
  $('cancelEdit').onclick = () => $('editDialog').close();
  $('addFree').onclick = () => openRecord(null);
  $('exportBtn').onclick = async () => {
    const text = await S.exportJson(), name = 'Port-Side-Quests-journal-' + new Date().toISOString().slice(0, 10) + '.json';
    if (native) { window.webkit.messageHandlers.psq.postMessage({ cmd: 'shareFile', name, text }); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('importFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { if (f.size > 200e6) throw new Error('File too large'); const n = await S.importJson(await f.text()); alert(`Added ${n} discover${n === 1 ? 'y' : 'ies'}.`); renderJournal(); }
    catch (err) { alert(err.message); }
  };

  /* ---------- Shared trip ---------- */
  const say = t => { $('syncStatus').textContent = t || ''; };
  async function run(fn, done) { try { say('Working…'); await fn(); say(done || ''); return true; } catch (e) { say(e.message || String(e)); return false; } }

  async function shareEntry(entry) {
    if (!Sync.user() || !tripId) return;
    try {
      await Sync.upload(entry, tripId);
      entry.sharedTrips = [...new Set([...(entry.sharedTrips || []), tripId])]; entry.pendingTrip = null;
      await S.put(entry);
      await refreshShared();
    } catch (e) { say('Saved on this phone; sharing will retry when you are online. (' + e.message + ')'); }
  }
  async function uploadPending(all) {
    if (!Sync.user() || !tripId || !navigator.onLine) return 0;
    const local = await S.all(); let n = 0;
    for (const e of local) {
      if ((e.sharedTrips || []).includes(tripId)) continue;
      if (!all && e.pendingTrip !== tripId) continue;
      await Sync.upload(e, tripId);
      e.sharedTrips = [...new Set([...(e.sharedTrips || []), tripId])]; e.pendingTrip = null;
      await S.put(e); n++;
    }
    return n;
  }
  async function refreshShared() {
    if (!Sync.user() || !tripId) { sharedRows = []; return; }
    const [rows, mem] = await Promise.all([Sync.entries(tripId), Sync.members(tripId)]);
    sharedRows = rows;
    memberNames = Object.fromEntries(mem.map(m => [m.user_id, m.display_name || (m.email || '').split('@')[0]]));
    renderMembers(mem);
  }
  function renderMembers(mem) {
    const trip = trips.find(t => t.id === tripId);
    $('memberList').innerHTML = mem.map(m => `<li><div><b>${esc(m.display_name || m.email)}</b>${m.is_me ? ' (you)' : ''}${m.is_owner ? ' · owner' : ''}<small>${esc(m.email)}</small></div>
      ${trip && trip.mine && !m.is_me ? `<button class="danger small" data-remove="${esc(m.user_id)}" data-name="${esc(m.display_name || m.email)}">Remove</button>` : ''}</li>`).join('');
  }
  async function loadTrips() {
    trips = await Sync.trips();
    if (!trips.some(t => t.id === tripId)) tripId = trips[0] ? trips[0].id : '';
    ls.set('psq-trip', tripId);
    $('tripSelect').innerHTML = trips.length ? trips.map(t => `<option value="${esc(t.id)}">${esc(t.name)}${t.mine ? ' (yours)' : ''}</option>`).join('') : '<option value="">No trips yet: start or join one below</option>';
    $('tripSelect').value = tripId;
    $('newTripBox').open = !trips.length;
    renderTrip();
    await refreshShared();
  }
  function renderTrip() {
    const trip = trips.find(t => t.id === tripId);
    $('tripBox').hidden = !trip;
    $('sharedDot').hidden = !trip;
    if (!trip) return;
    $('ownerActions').hidden = !trip.mine; $('memberActions').hidden = trip.mine;
    const code = ls.get('psq-invite-' + trip.id, '');
    $('inviteBox').hidden = !(trip.mine && trip.invitesOn && code);
    if (trip.mine && trip.invitesOn && code) {
      $('inviteCode').value = code;
      $('inviteInfo').textContent = `Send this to your travel partner. It works until ${new Date(trip.invite_expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}, and only for people who also sign in.`;
    }
    $('stopInvite').hidden = !trip.invitesOn;
  }
  function inviteText() {
    const trip = trips.find(t => t.id === tripId), code = $('inviteCode').value;
    return `Join my Port Side Quests trip “${trip ? trip.name : ''}”: ${WEB_URL}#join=${code}\n\nOr open Port Side Quests › Shared trip › Join a trip and paste this code:\n${code}`;
  }
  function showSignedIn() {
    const u = Sync.user();
    $('signedOut').hidden = !!u; $('signedIn').hidden = !u;
    if (u) { $('whoami').textContent = u.email || 'you'; $('myName').value = ls.get('psq-name', ''); loadTrips().then(renderJournal).catch(e => say(e.message)); }
    else { trips = []; sharedRows = []; $('sharedDot').hidden = true; renderJournal(); }
  }

  $('sendCode').onclick = () => run(async () => { await Sync.sendCode($('email').value); ls.set('psq-email', $('email').value.trim()); $('codeBox').hidden = false; $('code').focus(); }, 'Code sent. Check your email (and the spam folder).');
  $('verifyCode').onclick = () => run(() => Sync.verifyCode($('email').value, $('code').value), 'Signed in.');
  $('signOut').onclick = () => run(() => Sync.signOut(), 'Signed out. Your journal on this phone is unchanged.');
  $('myName').onchange = () => { ls.set('psq-name', $('myName').value.trim()); if (tripId) run(() => Sync.setName(tripId, $('myName').value.trim()).then(refreshShared), 'Name saved.'); };
  $('tripSelect').onchange = () => { tripId = $('tripSelect').value; ls.set('psq-trip', tripId); renderTrip(); run(refreshShared).then(renderJournal); };
  $('createTrip').onclick = () => run(async () => {
    const name = $('tripName').value.trim(); if (!name) throw new Error('Give the trip a name.');
    const r = await Sync.createTrip(name, $('myName').value.trim());
    ls.set('psq-invite-' + r.id, r.code); tripId = r.id; $('tripName').value = ''; $('newTripBox').open = false;
    await loadTrips(); await renderJournal();
  }, 'Trip created. Send the invitation to your travel partner.');
  $('joinTrip').onclick = () => run(async () => {
    tripId = await Sync.joinTrip($('joinCode').value, $('myName').value.trim()); $('joinCode').value = ''; $('joinBox').open = false;
    if (location.hash.includes('join=')) history.replaceState(null, '', location.pathname + location.search);
    await loadTrips(); await renderJournal();
  }, 'You joined the trip.');
  $('shareInvite').onclick = async () => {
    if (native) { window.webkit.messageHandlers.psq.postMessage({ cmd: 'share', text: inviteText() }); return; }
    if (navigator.share) { try { await navigator.share({ title: 'Port Side Quests trip', text: inviteText() }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    $('copyInvite').click();
  };
  $('copyInvite').onclick = async () => { try { await navigator.clipboard.writeText(inviteText()); say('Invitation copied.'); } catch { $('inviteCode').select(); say('Select the code and copy it.'); } };
  $('newInvite').onclick = () => { if (!confirm('Make a new invitation? The old one stops working right away. People already in the trip stay in.')) return;
    run(async () => { const r = await Sync.newInvite(tripId); ls.set('psq-invite-' + tripId, r.code); await loadTrips(); }, 'New invitation ready. The old one no longer works.'); };
  $('stopInvite').onclick = () => { if (!confirm('Turn off invitations? Nobody new can join until you make a new one.')) return;
    run(async () => { await Sync.stopInvite(tripId); localStorage.removeItem('psq-invite-' + tripId); await loadTrips(); }, 'Invitations turned off.'); };
  $('memberList').onclick = ev => {
    const b = ev.target.closest('[data-remove]'); if (!b) return;
    if (!confirm(`Remove ${b.dataset.name} from this trip? They will no longer see its journal. Their entries stay.`)) return;
    run(async () => { await Sync.removeMember(tripId, b.dataset.remove); await refreshShared(); }, 'Removed.');
  };
  $('leaveTrip').onclick = () => { if (!confirm('Leave this trip? You will no longer see its shared journal. Your entries stay in it, and your copies stay on this phone.')) return;
    run(async () => { await Sync.leaveTrip(tripId); tripId = ''; await loadTrips(); await renderJournal(); }, 'You left the trip.'); };
  $('deleteTrip').onclick = () => {
    const trip = trips.find(t => t.id === tripId); if (!trip) return;
    if (!confirm(`Delete “${trip.name}” for everyone, with all its shared entries and photos? Copies on each person's phone stay. This cannot be undone.`)) return;
    run(async () => { await Sync.deleteTrip(tripId); localStorage.removeItem('psq-invite-' + tripId); tripId = ''; await loadTrips(); await renderJournal(); }, 'Trip deleted.');
  };
  $('refreshShared').onclick = () => run(async () => { await uploadPending(false); await refreshShared(); await renderJournal(); }, 'Up to date.');
  $('uploadPending').onclick = () => run(async () => { const n = await uploadPending(true); await refreshShared(); await renderJournal(); say(`Shared ${n} earlier discover${n === 1 ? 'y' : 'ies'}.`); });

  // Discoveries saved while offline: retry when back online, and every minute while open.
  async function background() {
    if (!Sync.user() || !tripId || document.visibilityState !== 'visible' || !navigator.onLine) return;
    try {
      await uploadPending(false);
      await refreshShared(); await renderJournal();
    } catch (e) { say('Will retry sharing: ' + e.message); }
  }
  window.addEventListener('online', background);
  setInterval(background, 60000);

  /* ---------- Tabs and wiring ---------- */
  function showTab(name) {
    for (const [t, v] of [['Quests', 'questsView'], ['Journal', 'journalView'], ['Shared', 'sharedView']]) {
      const on = name.toLowerCase() === t.toLowerCase();
      $('tab' + t).setAttribute('aria-selected', String(on)); $(v).hidden = !on;
    }
    if (name === 'journal') renderJournal();
  }
  $('tabQuests').onclick = () => showTab('quests'); $('tabJournal').onclick = () => showTab('journal'); $('tabShared').onclick = () => showTab('shared');
  $('voyage').onchange = () => chooseVoyage(null); $('port').onchange = () => choosePort(null); $('day').onchange = () => chooseDay(null);
  $('pier').onchange = () => { $('confirmed').checked = false; $('pierNote').textContent = (port.piers[+$('pier').value] || {}).note || ''; renderQuests(); };
  for (const id of ['ready', 'back', 'overnight']) $(id).addEventListener('change', () => { $('confirmed').checked = false; renderQuests(); });
  for (const id of ['confirmed', 'origin', 'buffer', 'extra', 'speed', 'factor']) $(id).addEventListener('change', renderQuests);
  $('themes').onclick = e => { const b = e.target.closest('[data-theme]'); if (!b) return; const t = b.dataset.theme;
    themes = themes.includes(t) ? themes.filter(x => x !== t) : Q.ORDER.filter(x => x === t || themes.includes(x)); ls.set('psq-themes', themes); renderThemes(); renderQuests(); };
  $('surprise').onclick = () => { seed++; renderQuests(); };
  document.addEventListener('click', e => {
    const s = e.target.closest('[data-start]'); if (s) { const q = quests.find(x => x.id === s.dataset.start); if (q) startQuest(q); }
    const m = e.target.closest('[data-show]'); if (m) { const q = quests.find(x => x.id === m.dataset.show); if (q) { $('picks').insertAdjacentHTML('afterbegin', questCard(q, planOptions())); $('picks').scrollIntoView({ behavior: 'smooth' }); } }
  });
  $('activeRecord').onclick = () => openRecord(active);
  $('activeClear').onclick = () => { if (!confirm('Finish this quest without recording a discovery?')) return; active = null; ls.set('psq-active', null); showActive(); };

  // Invitation link: …/port-side-quests/#join=CODE
  const join = /join=([a-f0-9]{64})/i.exec(location.hash);
  if (join) { $('joinCode').value = join[1].toLowerCase(); $('joinBox').open = true; showTab('shared'); }
  $('email').value = ls.get('psq-email', '');

  renderThemes(); fillVoyages(); showActive(); renderJournal();
  if (Sync.configured()) { Sync.onChange(showSignedIn); Sync.init().catch(e => say(e.message)); }
  else { $('notConfigured').hidden = false; $('signedOut').hidden = true; $('signedIn').hidden = true; }
})();
