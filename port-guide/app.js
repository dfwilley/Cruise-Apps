/* Port Pocket Guide — screens. Port facts: data/ports.js. Sights, hours, typical weather, saved rates: data/places.js. */
(function () {
  const P = window.Port, FACTS = window.PORT_FACTS, PLACES = window.PORT_PLACES || { ports: {}, climate: {} };
  const VOYAGES = FACTS.voyages, COUNTRIES = FACTS.countries;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.port;

  // ?now=2027-02-04T10:00+01:00 previews the app as if it were that moment.
  const qs = new URLSearchParams(location.search);
  let fakeNow = qs.get("now") ? new Date(qs.get("now").replace(" ", "+")) : null;   // a "+" in a link can arrive as a space
  if (fakeNow && isNaN(fakeNow)) fakeNow = null;
  const now = () => fakeNow || new Date();

  const store = {
    get(k, d) { try { const v = localStorage.getItem("ppg." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("ppg." + k, JSON.stringify(v)); } catch (e) {} }
  };

  // Which voyage: from the link, else the one picked last (unless it's over), else the next one by date.
  const voyageEnd = v => P.portCall(v.ports[v.ports.length - 1]).end;
  const picked = VOYAGES.find(v => v.id === store.get("voyage", null));
  let voyage = (qs.get("voyage") && VOYAGES.find(v => v.id === qs.get("voyage")))
    || (qs.get("port") && VOYAGES.find(v => v.ports.some(p => p.id === qs.get("port"))))
    || (picked && now() < voyageEnd(picked) ? picked : null) || P.currentVoyage(VOYAGES, now());
  let cur = P.currentPort(voyage.ports, now());
  const state = {
    port: (qs.get("port") && voyage.ports.find(p => p.id === qs.get("port"))) || cur.port,
    tab: qs.get("tab") || store.get("tab", "walk"),
    filter: "all",
    me: null,           // { lat, lon, at }
    rates: (() => {   // newest of the saved rate and the one bundled with the app, as long as it has every currency
      const a = store.get("rates", null), b = PLACES.rates || null, ok = r => r && ["NOK", "GBP", "EUR", "CHF"].every(k => r[k]);
      if (ok(a) && ok(b)) return a.date >= b.date ? a : b;
      return ok(a) ? a : b || a;
    })(),
    amount: store.get("amount", 100),
    dir: store.get("dir", "local"),   // "local" → amounts typed in local money; "usd" → typed in dollars
    forecast: {}
  };

  const pierOf = p => {
    const id = store.get("pier." + p.id, null);
    return p.piers.find(x => x.id === id) || p.piers.find(x => x.primary) || p.piers[0];
  };
  // Where walking distances are measured from: the pier, or the city centre when the pier is out of town (Rosyth, Tilbury).
  const refOf = p => { const pr = pierOf(p); return pr.walkFromPier === false ? { ...p.center, label: p.center.name } : { ...pr, label: pr.name }; };

  // ---- Voyage switcher and port chips -----------------------------------------------------------------------
  function renderVoyages() {
    $("#voyages").innerHTML = VOYAGES.map(v => `<button role="tab" data-v="${v.id}" aria-selected="${v === voyage}">${esc(v.short)}<span>${esc(v.dates)}</span></button>`).join("");
    $("#voyages").querySelectorAll("button").forEach(b => b.onclick = () => {
      if (b.dataset.v === voyage.id) return;
      voyage = VOYAGES.find(v => v.id === b.dataset.v); store.set("voyage", voyage.id);
      cur = P.currentPort(voyage.ports, now()); state.port = cur.port; state.filter = "all";
      render(); window.scrollTo(0, 0);
    });
    $("#voyage").textContent = voyage.ship + " · " + voyage.name;
  }
  function renderPorts() {
    $("#ports").innerHTML = voyage.ports.map(p => {
      const c = P.portCall(p), [Y, M, D] = p.days[0].date.split("-").map(Number);
      const here = cur.port === p && cur.state === "in";
      return `<button class="chip${p === state.port ? " on" : ""}" data-port="${p.id}" aria-pressed="${p === state.port}">
        <b>${esc(p.name.replace(/ \(.*\)/, ""))}</b><span>${MON[M - 1]} ${D}${p.days.length > 1 ? "–" + p.days[p.days.length - 1].date.slice(8).replace(/^0/, "") : ""}${here ? " · here" : ""}</span></button>`;
    }).join("");
    $("#ports").querySelectorAll("button").forEach(b => b.onclick = () => { state.port = voyage.ports.find(p => p.id === b.dataset.port); render(); window.scrollTo(0, 0); });
    const on = $("#ports .on"); if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "center" });
  }

  // ---- Hero: time in port ------------------------------------------------------------------------------------
  function renderHero() {
    const p = state.port, c = P.portCall(p), t = now();
    const dayTxt = p.days.map(d => P.dayLabel(d.date)).join(" – ");
    const tzTxt = `local time UTC+${p.tz} (Arizona +${p.tz + 7} h)`.replace("UTC+0", "UTC");
    let status = "", times = "";
    if (!c.timed) {
      const notes = p.days.map(d => d.note).filter(Boolean);
      if (t < c.start) { const days = Math.ceil((c.start - t) / 864e5); status = days > 1 ? `In ${days} days` : "Tomorrow"; }
      else if (t < c.end) status = "<strong>In port today</strong>";
      else status = "Sailed";
      times = `<div><span>${p.days.length > 1 ? "Days" : "Day"}</span><b>${p.days.map(d => MON[+d.date.slice(5, 7) - 1] + " " + +d.date.slice(8)).join(" – ")}</b></div>
        <div><span>Ship's times</span><b class="small">In the daily program</b></div>`;
      if (notes.length) status += " · " + esc(notes.join(" · "));
    } else {
      if (c.disembark) status = t < c.arrive ? `Arrive ${P.fmt12(c.arrive, p.tz)} · disembarkation day` : "Disembarkation day";
      else if (t < c.arrive) {
        const days = Math.ceil((c.arrive - t) / 864e5);
        status = days > 1 ? `In ${days} days` : `Arriving in ${P.fmtMin(Math.round((c.arrive - t) / 60e3))}`;
      } else if (t < c.allAboard) status = `<strong>All aboard in ${P.fmtMin(Math.round((c.allAboard - t) / 60e3))}</strong>`;
      else if (t < c.depart) status = "<strong>All aboard now</strong>";
      else status = "Sailed";
      times = c.disembark
        ? `<div><span>Arrive</span><b>${P.fmt12(c.arrive, p.tz)}</b></div><div><span>Ashore</span><b>Final day</b></div>`
        : `<div><span>Arrive</span><b>${P.fmt12(c.arrive, p.tz)}</b>${c.overnight ? `<i>${P.dayLabel(p.days[0].date).split(",")[0]}</i>` : ""}</div>
           <div class="aboard"><span>All aboard</span><b>${P.fmt12(c.allAboard, p.tz)}</b>${c.overnight ? `<i>${P.dayLabel(p.days[p.days.length - 1].date).split(",")[0]}</i>` : ""}</div>
           <div><span>Sail</span><b>${P.fmt12(c.depart, p.tz)}</b></div>`;
    }
    const alertBtn = native && c.allAboard && !c.disembark && t < c.allAboard ? `<button id="remind" class="ghost">⏰ Remind me 1 hour before all aboard</button>` : "";
    const fine = !c.timed ? "Viking publishes the ports but not the docking times for river voyages — check the daily program on board for arrival and all-aboard times."
      : c.disembark ? "" : "All aboard is assumed 30 minutes before sailing — Viking's daily program has the exact time.";
    $("#hero").innerHTML = `
      <h2>${esc(p.name)}</h2>
      <p class="sub">${esc(dayTxt)} · ${esc(COUNTRIES[p.country].name)} · ${tzTxt}</p>
      <div class="times">${times}</div>
      <p class="status">${status}</p>
      ${fine ? `<p class="fine">${fine}</p>` : ""}
      ${alertBtn}`;
    const r = $("#remind");
    if (r) r.onclick = () => {
      native.postMessage({ cmd: "alerts", items: [{ id: "aboard-" + p.id, at: c.allAboard.getTime() - 3600e3,
        title: "All aboard in 1 hour", body: `${p.name}: all aboard ${P.fmt12(c.allAboard, p.tz)}, ship sails ${P.fmt12(c.depart, p.tz)}.` },
        { id: "aboard30-" + p.id, at: c.allAboard.getTime() - 1800e3, title: "All aboard in 30 minutes", body: `Head back to ${pierOf(p).name}.` }] });
      r.textContent = "⏰ Reminders set (1 hour and 30 minutes before)"; r.disabled = true;
    };
  }

  // ---- Pier & walking ---------------------------------------------------------------------------------------
  const ICON = { museum: "🏛", gallery: "🖼", viewpoint: "⛰", attraction: "★", historic: "🏰", church: "⛪", "cable car": "🚡",
    "tourist info": "ℹ︎", pharmacy: "✚", cash: "💳", groceries: "🛒", toilets: "🚻", "shopping centre": "🛍", "outdoor gear": "🧤", "train station": "🚆", taxi: "🚕" };
  const FILTERS = [["all", "All"], ["museum", "Museums"], ["church", "Churches"], ["viewpoint", "Views"], ["historic", "Historic"], ["attraction", "Sights"]];

  // When we're ashore on a given day, in minutes after local midnight.
  function ashoreWindow(p, day) {
    const timed = p.days.some(d => d.from || d.to);
    const from = day.from || (timed ? "08:00" : "09:00"), to = day.to || (timed ? "23:59" : "18:00");
    const m = s => +s.split(":")[0] * 60 + +s.split(":")[1];
    return [m(from), m(to)];
  }
  function hoursBadge(item, p) {
    if (!item.hours) return `<span class="hrs unk">Hours not listed</span>`;
    const parts = p.days.map(d => {
      const h = P.hoursOn(item.hours, P.dowOf(d.date), +d.date.slice(5, 7));
      if (!h) return null;
      const [a, b] = ashoreWindow(p, d), st = P.openWhileAshore(h, a, b);
      return { d, h, st };
    });
    if (parts.some(x => !x)) return `<span class="hrs unk" title="${esc(item.hours)}">${esc(item.hours)}</span>`;
    return parts.map(({ d, h, st }) => {
      const lbl = p.days.length > 1 ? P.dayLabel(d.date).slice(0, 3) + " " : "";
      const cls = st === "open" ? "ok" : st === "outside" ? "warn" : "no";
      const txt = h.closed ? "Closed" : P.fmtRanges(h) + (st === "outside" ? " (not while we're in)" : "");
      return `<span class="hrs ${cls}">${lbl}${esc(txt)}</span>`;
    }).join(" ");
  }
  function placeRow(it, p, from) {
    const w = P.walk(P.km(from.lat, from.lon, it.lat, it.lon));
    const far = w.min > 45;
    return `<li class="place">
      <span class="ico" aria-hidden="true">${ICON[it.kind] || "•"}</span>
      <div class="pbody">
        <b>${esc(it.name)}</b>${it.local ? ` <small>${esc(it.local)}</small>` : ""}
        <div class="meta"><span>${esc(it.kind)}</span><span>${P.fmtMi(w.mi)} · ${far ? "taxi or bus" : P.fmtMin(w.min) + " walk"}</span></div>
        <div>${hoursBadge(it, p)}</div>
      </div>
      <a class="go" href="${P.mapsLink(it, from)}" target="_blank" rel="noopener" aria-label="Directions to ${esc(it.name)}">Map</a>
    </li>`;
  }
  function renderWalk() {
    const p = state.port, pr = pierOf(p), ref = refOf(p), data = PLACES.ports[p.id] || { sights: [], practical: [] };
    const from = state.me || ref;
    const fromLabel = state.me ? "your location" : (pr.walkFromPier === false ? p.center.name : pr.name.replace(/ \(.*\)/, ""));
    const toCentre = P.walk(P.km(pr.lat, pr.lon, p.center.lat, p.center.lon));
    const piers = p.piers.map(x => `
      <label class="pier${x === pr ? " on" : ""}">
        <input type="radio" name="pier" value="${x.id}"${x === pr ? " checked" : ""}>
        <div><b>${esc(x.name)}</b><p>${esc(x.note)}</p>
          <a href="${P.mapsLink({ lat: x.lat, lon: x.lon, name: x.name })}" target="_blank" rel="noopener">Show pier in Maps</a></div>
      </label>`).join("");
    const c = P.portCall(p);
    let back = "";
    if (state.me) {
      const w = P.walk(P.km(state.me.lat, state.me.lon, pr.lat, pr.lon));
      const left = c.allAboard ? Math.round((c.allAboard - now()) / 60e3) : null;
      const tight = left != null && left > 0 && w.min + 15 > left;
      back = `<div class="back${tight ? " tight" : ""}"><b>Back to the ship:</b> ${P.fmtMi(w.mi)}, about ${w.min > 60 ? "a taxi ride (" + P.fmtMin(w.min) + " on foot)" : P.fmtMin(w.min) + " on foot"}.
        ${left != null && left > 0 ? `All aboard in ${P.fmtMin(left)}.${tight ? " <strong>Start back now.</strong>" : ""}` : ""}
        <a href="${P.mapsLink({ lat: pr.lat, lon: pr.lon, name: pr.name })}" target="_blank" rel="noopener">Walk me back</a></div>`;
    }
    const sights = data.sights.filter(s => state.filter === "all" || s.kind === state.filter)
      .map(s => ({ s, d: P.km(from.lat, from.lon, s.lat, s.lon) })).sort((a, b) => a.d - b.d).map(x => x.s);
    const kindsHere = new Set(data.sights.map(s => s.kind));
    const filters = FILTERS.filter(([k]) => k === "all" || kindsHere.has(k))
      .map(([k, l]) => `<button class="f${state.filter === k ? " on" : ""}" data-f="${k}">${l}</button>`).join("");
    const practical = data.practical.slice().sort((a, b) => P.km(from.lat, from.lon, a.lat, a.lon) - P.km(from.lat, from.lon, b.lat, b.lon));
    $("#walk").innerHTML = `
      <h3>Where the ship docks</h3>
      <p class="fine">Viking confirms the berth near arrival. Pick the one in the daily program and distances update.</p>
      <div class="piers">${piers}</div>
      ${pr.walkFromPier === false ? `<p class="callout">${esc(p.transport)}</p>`
        : `<p class="callout">To ${esc(p.center.name)}: <b>${P.fmtMi(toCentre.mi)}</b>, about <b>${P.fmtMin(toCentre.min)}</b> on foot.
            <a href="${P.mapsLink({ ...p.center }, pr)}" target="_blank" rel="noopener">Walking route</a><br><span class="fine">${esc(p.transport)}</span></p>`}
      <div class="row"><button id="locate" class="ghost locate">📍 ${state.me ? "Update my location" : "Use my location"}</button>
        <span class="fine">${state.me ? "Distances from where you are now." : "Distances from " + esc(fromLabel) + "."}</span></div>
      ${back}
      <h3>Sights</h3>
      <div class="filters">${filters}</div>
      ${sights.length ? `<ul class="places">${sights.map(s => placeRow(s, p, from)).join("")}</ul>`
        : `<p class="fine">Sights load with the port data file — check back after the next update.</p>`}
      <h3>Handy nearby</h3>
      ${practical.length ? `<ul class="places compact">${practical.map(s => placeRow(s, p, from)).join("")}</ul>` : `<p class="fine">No data yet.</p>`}
      <p class="tip"><b>Before you go ashore:</b> in Apple Maps, download an offline map of ${esc(p.name.replace(/ \(.*\)/, ""))} (tap your picture › Offline Maps) so the walking links work without a signal. Walking times assume about 2½ mph on winter pavements and streets that wander a little; they're estimates.</p>`;
    $("#walk").querySelectorAll("input[name=pier]").forEach(i => i.onchange = () => { store.set("pier." + p.id, i.value); renderWalk(); });
    $("#walk").querySelectorAll(".f").forEach(b => b.onclick = () => { state.filter = b.dataset.f; renderWalk(); });
    $("#locate").onclick = locate;
  }

  function locate() {
    document.querySelectorAll(".locate").forEach(b => { b.textContent = "📍 Finding you…"; b.disabled = true; });
    if (native) { native.postMessage({ cmd: "locate" }); return; }
    if (!navigator.geolocation) return gotError("This browser can't share location.");
    navigator.geolocation.getCurrentPosition(
      pos => gotLocation(pos.coords.latitude, pos.coords.longitude),
      err => gotError(err.code === 1 ? "Location is off for this site. Turn it on in Settings › Privacy › Location Services › Safari Websites." : "Couldn't get a GPS fix — try again in the open."),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
  }
  function gotLocation(lat, lon) {
    const p = state.port, d = P.km(lat, lon, p.area.lat, p.area.lon);
    state.me = { lat, lon, at: Date.now() };
    renderWalk(); renderNear(); loadLive();
    if (d > 40) toast(`You're ${Math.round(d / 1.609)} miles from ${p.name} — distances are from where you are now.`);
  }
  function gotError(msg) { toast(msg); renderWalk(); renderNear(); }
  window.__portNative = m => {
    if (m.type === "location") gotLocation(m.lat, m.lon);
    else if (m.type === "error") gotError(m.message);
  };
  function toast(msg) {
    let t = $("#toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.className = "show"; clearTimeout(t._h); t._h = setTimeout(() => t.className = "", 5000);
  }


  // ---- Near me: ideas for this port, places within a short walk, and (online) cafés and sights around you -----
  const FOOD = { cafe: "☕", restaurant: "🍽", bakery: "🥨", pastry: "🍰", ice_cream: "🍦", pub: "🍺", biergarten: "🍺", bar: "🍷", fast_food: "🌭", wine: "🍷" };
  const portOfLocation = loc => {   // the port (any voyage) you're at, if you're within its area
    let best = null;
    for (const v of VOYAGES) for (const p of v.ports) {
      const d = P.km(loc.lat, loc.lon, p.area.lat, p.area.lon);
      if (d <= p.area.r + 3 && (!best || d < best.d)) best = { p, v, d };
    }
    return best;
  };
  // Local clock for "open now": the port's zone when you're at a port (or previewing), else the phone's own clock.
  function clockFor(p) {
    if (fakeNow || (state.me && portOfLocation(state.me))) {
      const lp = P.localParts(now(), p.tz);
      return { dow: lp.dow, month: lp.mo, min: lp.h * 60 + lp.mi, label: (lp.h % 12 || 12) + ":" + String(lp.mi).padStart(2, "0") + (lp.h < 12 ? " AM" : " PM") };
    }
    const d = new Date();
    return { dow: d.getDay(), month: d.getMonth() + 1, min: d.getHours() * 60 + d.getMinutes(), label: d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) };
  }
  function openNow(hours, ck) {
    const h = P.hoursOn(hours, ck.dow, ck.month);
    if (!h) return hours ? { cls: "unk", txt: hours } : null;
    if (h.closed) return { cls: "no", txt: "Closed today" };
    for (const [a, b0] of h.ranges) {
      const b = b0 <= a ? b0 + 1440 : b0;
      if (ck.min >= a && ck.min < b) return { cls: "ok", txt: "Open now · until " + P.fmtRanges({ ranges: [[a, b0]] }).split("–")[1] + (b - ck.min <= 45 ? " (closing soon)" : "") };
    }
    const next = h.ranges.find(([a]) => a > ck.min);
    return next ? { cls: "warn", txt: "Opens " + P.fmtRanges({ ranges: [next] }).split("–")[0] } : { cls: "no", txt: "Closed for today" };
  }
  function findSight(p, q) {   // match an idea to a mapped place, for its distance and hours
    const data = PLACES.ports[p.id]; if (!data) return null;
    const key = q.toLowerCase().split(" ").filter(w => w.length > 3);
    return data.sights.concat(data.practical).find(s => {
      const n = (s.name + " " + (s.local || "")).toLowerCase();
      return key.length && key.every(w => n.includes(w));
    }) || null;
  }
  function renderNear() {
    const p = state.port, me = state.me, ck = clockFor(p), c = P.portCall(p);
    const at = me ? portOfLocation(me) : null;
    const from = me || refOf(p);
    const left = c.allAboard && now() < c.allAboard && now() >= c.start ? Math.round((c.allAboard - now()) / 60e3) : null;
    const ideas = (p.ideas || []).map(idea => {
      const s = findSight(p, idea.q);
      const w = s ? P.walk(P.km(from.lat, from.lon, s.lat, s.lon)) : null;
      const o = s && s.hours ? openNow(s.hours, ck) : null;
      const near = s || p.center;
      const link = s ? P.mapsLink(s, me) : `https://maps.apple.com/?q=${encodeURIComponent(idea.q)}&sll=${near.lat},${near.lon}`;
      const fits = left != null && w ? (w.min * 2 + 30 <= left) : null;
      return `<li class="idea">
        <div><b>${esc(idea.title)}</b> <span class="tag">${esc(idea.time)}</span>
          <p>${esc(idea.what)}</p>
          <div class="meta">${w ? `<span>${P.fmtMi(w.mi)} · ${w.min > 45 ? "taxi, tram or tour" : P.fmtMin(w.min) + " walk"}${me ? "" : " from the pier"}</span>` : ""}
            ${o ? `<span class="hrs ${o.cls}">${esc(o.txt)}</span>` : ""}${fits === false ? `<span class="hrs warn">Tight before all aboard</span>` : ""}</div></div>
        <a class="go" href="${link}" target="_blank" rel="noopener" aria-label="Map for ${esc(idea.title)}">Map</a></li>`;
    }).join("");
    let here = "";
    if (me) {
      const data = PLACES.ports[(at && at.p.id) || p.id] || { sights: [], practical: [] };
      const close = data.sights.concat(data.practical).map(s => ({ s, d: P.km(me.lat, me.lon, s.lat, s.lon) }))
        .filter(x => x.d <= 1.2).sort((a, b) => a.d - b.d).slice(0, 15);
      here = at
        ? `<h3>Within about 15 minutes' walk</h3>${close.length ? `<ul class="places">${close.map(({ s }) => {
            const o = s.hours ? openNow(s.hours, ck) : null, w = P.walk(P.km(me.lat, me.lon, s.lat, s.lon));
            return `<li class="place"><span class="ico" aria-hidden="true">${ICON[s.kind] || "•"}</span><div class="pbody"><b>${esc(s.name)}</b>
              <div class="meta"><span>${esc(s.kind)}</span><span>${P.fmtMi(w.mi)} · ${P.fmtMin(w.min)}</span></div>${o ? `<span class="hrs ${o.cls}">${esc(o.txt)}</span>` : ""}</div>
              <a class="go" href="${P.mapsLink(s, me)}" target="_blank" rel="noopener">Map</a></li>`; }).join("")}</ul>` : `<p class="fine">Nothing from the saved list right here — see the live list below.</p>`}`
        : `<p class="callout">You're ${Math.round(P.km(me.lat, me.lon, p.area.lat, p.area.lon) / 1.609).toLocaleString("en-US")} miles from ${esc(p.name)}. The ideas below are for ${esc(p.name)}; the live list shows what's around you now.</p>`;
      if (at && at.p !== p) here = `<p class="callout">You're in ${esc(at.p.name)}. <button class="link" id="gohere">Show ${esc(at.p.name)}</button></p>` + here;
    }
    const live = state.live;
    const liveHtml = !me ? "" : !live ? `<p class="fine">Looking for cafés and sights around you…</p>`
      : live.error ? `<p class="fine">${esc(live.error)}</p>`
      : `<h3>Around you now${live.cached ? " (saved list)" : ""}</h3>
         ${["food", "sight"].map(g => {
           const items = live.items.filter(x => x.g === g).slice(0, g === "food" ? 12 : 10);
           if (!items.length) return "";
           return `<h4 class="sub4">${g === "food" ? "Coffee, food and drink" : "Sights"}</h4><ul class="places compact">${items.map(x => {
             const o = x.hours ? openNow(x.hours, ck) : null, w = P.walk(P.km(me.lat, me.lon, x.lat, x.lon));
             return `<li class="place"><span class="ico" aria-hidden="true">${FOOD[x.kind] || ICON[x.kind] || "•"}</span><div class="pbody"><b>${esc(x.name)}</b>
               <div class="meta"><span>${esc(x.label)}</span><span>${P.fmtMi(w.mi)} · ${P.fmtMin(w.min)}</span></div>${o ? `<span class="hrs ${o.cls}">${esc(o.txt)}</span>` : ""}</div>
               <a class="go" href="${P.mapsLink(x, me)}" target="_blank" rel="noopener">Map</a></li>`; }).join("")}</ul>`;
         }).join("")}
         <p class="fine">Live from OpenStreetMap${live.at ? ", " + new Date(live.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}. Hours shown where the map has them.</p>`;
    $("#near").innerHTML = `
      <p class="clock">It's <b>${esc(ck.label)}</b>${me && !at ? " where you are" : " in " + esc(p.name.replace(/ \(.*\)| &.*/, ""))}${left != null ? ` · all aboard in <b>${P.fmtMin(left)}</b>` : ""}.</p>
      <div class="row"><button class="ghost locate" id="locate2">📍 ${me ? "Update my location" : "Find ideas near me"}</button>
        <span class="fine">${me ? "Using where you are now." : "Uses your location once; nothing is sent anywhere except the map lookup."}</span></div>
      ${here}
      ${liveHtml}
      <h3>Ideas for ${esc(p.name)}</h3>
      <ul class="ideas">${ideas}</ul>
      <p class="fine">Suggestions to pick from on your own time — check hours and Viking's included tours before you set off.</p>`;
    $("#locate2").onclick = locate;
    const g = $("#gohere"); if (g) g.onclick = () => { voyage = at.v; state.port = at.p; store.set("voyage", voyage.id); render(); };
  }
  async function loadLive() {
    const me = state.me; if (!me) return;
    state.live = null; if (state.tab === "near") renderNear();
    const q = `[out:json][timeout:20];(
      nwr(around:800,${me.lat},${me.lon})[amenity~"^(cafe|restaurant|ice_cream|pub|biergarten|bar|fast_food)$"][name];
      nwr(around:800,${me.lat},${me.lon})[shop~"^(bakery|pastry|wine)$"][name];
      nwr(around:1500,${me.lat},${me.lon})[tourism~"^(museum|attraction|viewpoint|gallery)$"][name];
      nwr(around:1500,${me.lat},${me.lon})[historic~"^(castle|monument|ruins|city_gate|church|fort)$"][name];
    );out center 120;`;
    const LABEL = { cafe: "café", restaurant: "restaurant", ice_cream: "ice cream", pub: "pub", biergarten: "beer garden", bar: "bar", fast_food: "snacks", bakery: "bakery", pastry: "pastry shop", wine: "wine shop" };
    for (const url of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
      try {
        const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        if (!r.ok) continue;
        const j = await r.json(), seen = new Set();
        const items = j.elements.map(e => {
          const t = e.tags || {}, lat = e.lat || (e.center && e.center.lat), lon = e.lon || (e.center && e.center.lon);
          const food = t.amenity && FOOD[t.amenity] ? t.amenity : t.shop && FOOD[t.shop] ? t.shop : null;
          const kind = food || t.tourism || (t.historic ? "historic" : null);
          return { name: t["name:en"] || t.name, lat, lon, hours: t.opening_hours, g: food ? "food" : "sight", kind, label: food ? LABEL[food] : (t.tourism || t.historic || "").replace(/_/g, " ") };
        }).filter(x => x.lat && x.name && !seen.has(x.name) && seen.add(x.name))
          .sort((a, b) => P.km(me.lat, me.lon, a.lat, a.lon) - P.km(me.lat, me.lon, b.lat, b.lon));
        state.live = { items, at: Date.now() }; store.set("live", { ...state.live, lat: me.lat, lon: me.lon });
        if (state.tab === "near") renderNear();
        return;
      } catch (e) {}
    }
    const saved = store.get("live", null);
    state.live = saved && P.km(me.lat, me.lon, saved.lat, saved.lon) < 1 ? { ...saved, cached: true }
      : { error: "No connection for the live list right now — the ideas and saved places still work offline." };
    if (state.tab === "near") renderNear();
  }

  // ---- Hours, weather & daylight ----------------------------------------------------------------------------
  function dayBar(p, d, ev) {
    const pct = date => { const lp = P.localParts(date, p.tz); return ((lp.h * 60 + lp.mi) / 1440 * 100).toFixed(2); };
    let seg = "";
    if (!ev.civil.never && !ev.civil.always) seg += `<i class="tw" style="left:${pct(ev.civil.rise)}%;width:${pct(ev.civil.set) - pct(ev.civil.rise)}%"></i>`;
    if (!ev.sun.never && !ev.sun.always) seg += `<i class="sun" style="left:${pct(ev.sun.rise)}%;width:${pct(ev.sun.set) - pct(ev.sun.rise)}%"></i>`;
    const [a, b] = [d.from ? d.from : "00:00", d.to ? d.to : "24:00"].map(s => (+s.split(":")[0] * 60 + +s.split(":")[1]) / 14.4);
    if (d.from || d.to) seg += `<i class="ship" style="left:${a}%;width:${b - a}%"></i>`;
    const ticks = [0, 6, 12, 18, 24].map(h => `<span style="left:${h / 24 * 100}%">${h === 24 ? "" : String(h).padStart(2, "0")}</span>`).join("");
    return `<div class="bar" role="img" aria-label="Daylight and time in port">${seg}</div><div class="ticks">${ticks}</div>`;
  }
  function weatherCard(p) {
    const c = (PLACES.climate || {})[p.id];
    if (!c) return `<p class="fine">Typical weather loads with the port data file.</p>`;
    return `<div class="wx">
      <div><span>Typical high</span><b>${P.fmtTemp(c.hi)}</b></div>
      <div><span>Typical low</span><b>${P.fmtTemp(c.lo)}</b></div>
      <div><span>Cold night (1 in 10)</span><b>${P.fmtTemp(c.coldLo)}</b></div>
      <div><span>Days with rain or snow</span><b>${c.wetPct}%</b></div>
      <div><span>Days with fresh snow</span><b>${c.snowPct}%</b></div>
      <div><span>Typical gusts</span><b>${Math.round(c.gust / 1.609)} mph</b></div>
    </div><p class="fine">From ${c.days} days around these dates in ${c.years} (Open-Meteo / ERA5 records — a regional average, so the waterfront is often a little milder than the coldest figures).</p>`;
  }
  async function loadForecast(p) {
    const key = p.id, first = P.portDate(p.days[0].date, "12:00", p.tz), days = (first - now()) / 864e5;
    if (state.forecast[key] || days > 15 || days < -2 || fakeNow) return;
    state.forecast[key] = "loading";
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.center.lat}&longitude=${p.center.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_gusts_10m_max,weather_code&timezone=auto&forecast_days=16`);
      const j = await r.json(); state.forecast[key] = j.daily; store.set("fc." + key, { at: Date.now(), daily: j.daily });
    } catch (e) { state.forecast[key] = store.get("fc." + key, {}).daily || null; }
    if (state.port.id === key && state.tab === "day") renderDay();
  }
  function forecastRows(p) {
    const f = state.forecast[p.id];
    if (!f || f === "loading") return "";
    const rows = p.days.map(d => {
      const i = f.time.indexOf(d.date); if (i < 0) return "";
      const sn = f.snowfall_sum[i], pr = f.precipitation_sum[i];
      return `<li><b>${P.dayLabel(d.date).split(",")[0]}</b> ${P.fmtTemp(f.temperature_2m_max[i])} / ${P.fmtTemp(f.temperature_2m_min[i])} ·
        ${sn >= 0.5 ? (sn / 2.54).toFixed(1) + " in snow" : pr >= 0.5 ? (pr / 25.4).toFixed(2) + " in rain" : "dry"} · gusts ${Math.round(f.wind_gusts_10m_max[i] / 1.609)} mph</li>`;
    }).join("");
    return rows ? `<div class="forecast"><h4>Forecast</h4><ul>${rows}</ul><p class="fine">Open-Meteo forecast.</p></div>` : "";
  }
  function renderDay() {
    const p = state.port, co = COUNTRIES[p.country];
    const days = p.days.map(d => {
      const ev = P.sunEvents(d.date, p.center.lat, p.center.lon, p.tz), dl = P.daylightMinutes(ev);
      const shut = P.closedDay(co, d.date);
      const sunTxt = ev.sun.never ? "The sun stays below the horizon" : ev.sun.always ? "The sun doesn't set" :
        `Sunrise <b>${P.fmt12(ev.sun.rise, p.tz)}</b> · sunset <b>${P.fmt12(ev.sun.set, p.tz)}</b> · ${Math.floor(dl / 60)} h ${dl % 60} min of daylight`;
      const tw = ev.civil.rise && ev.civil.set ? `Usable light (civil twilight) ${P.fmt12(ev.civil.rise, p.tz)} – ${P.fmt12(ev.civil.set, p.tz)}.${ev.noonAlt < 25 ? ` The sun climbs only ${Math.max(0, ev.noonAlt).toFixed(0)}° at noon.` : ""}` : "";
      const ship = d.from && d.to ? `Ship in ${d.from}–${d.to}` : d.from ? `Ship arrives ${d.from}` : d.to ? `Ship sails ${d.to}` : "";
      const shutNote = shut.holiday ? `<p class="callout warn"><b>${esc(shut.holiday)}.</b> ${esc(co.sunday)}</p>`
        : shut.sunday && co.currency !== "GBP" ? `<p class="callout warn"><b>Sunday:</b> ${esc(co.sunday)}</p>` : "";
      return `<article class="dayc">
        <h4>${P.dayLabel(d.date)}${shutNote ? ` <span class="pill">${shut.holiday ? "Holiday" : "Sunday"} · shops closed</span>` : ""}</h4>
        <p>${sunTxt}</p>${dayBar(p, d, ev)}
        <p class="fine">${tw} <span class="key"><i class="k sun"></i>sun up <i class="k tw"></i>twilight ${ship ? `<i class="k ship"></i>${ship}` : ""}</span></p>
        ${d.note ? `<p class="fine">${esc(d.note)}</p>` : ""}
        ${shutNote}
      </article>`;
    }).join("");
    $("#day").innerHTML = `
      ${days}
      <h3>Typical weather these days</h3>
      ${weatherCard(p)}
      ${forecastRows(p)}
      <h3>What to wear</h3><p>${esc(co.winter)}</p>
      <h3>Shop hours</h3><p>${esc(co.hours)}${co.currency !== "GBP" ? " " + esc(co.sunday) : ""}</p>
      <p class="fine">Museum and shop hours under Sights come from OpenStreetMap and can be out of date — check a place's website before a long walk.</p>`;
    loadForecast(p);
  }

  // ---- Money & phrases --------------------------------------------------------------------------------------
  async function refreshRates(btn) {
    if (btn) { btn.textContent = "Updating…"; btn.disabled = true; }
    for (const u of ["https://api.frankfurter.dev/v1/latest?base=USD&symbols=NOK,GBP,EUR,CHF", "https://api.frankfurter.app/latest?from=USD&to=NOK,GBP,EUR,CHF"]) {
      try {
        const j = await (await fetch(u)).json();
        if (j.rates && j.rates.NOK) { state.rates = { date: j.date, ...j.rates }; store.set("rates", state.rates); renderMoney(); return; }
      } catch (e) {}
    }
    toast("No connection — using the saved rate.");
    renderMoney();
  }
  function renderMoney() {
    const p = state.port, co = COUNTRIES[p.country], cur = co.currency, r = state.rates;
    const conv = r && r[cur] ? (() => {
      const a = +state.amount || 0;
      const out = state.dir === "local" ? P.fmtMoney(P.convert(a, cur, "USD", r), "USD") : P.fmtMoney(P.convert(a, "USD", cur, r), cur);
      const table = (cur === "NOK" ? [20, 50, 100, 200, 500, 1000] : [2, 5, 10, 20, 50, 100, 200])
        .map(v => `<tr><td>${P.fmtMoney(v, cur)}</td><td>${P.fmtMoney(P.convert(v, cur, "USD", r), "USD")}</td></tr>`).join("");
      return `<div class="conv">
        <label><span>${state.dir === "local" ? esc(co.currencyPlural) : "US dollars"}</span>
          <input id="amt" type="text" inputmode="decimal" value="${esc(state.amount)}" aria-label="Amount"></label>
        <button id="swap" class="ghost" aria-label="Swap currencies">⇅</button>
        <div class="res"><span>${state.dir === "local" ? "US dollars" : esc(co.currencyPlural)}</span><b id="res">${out}</b></div>
      </div>
      <p class="fine">$1 = ${P.fmtMoney(r[cur], cur)} · ECB rate of ${esc(r.date)} · your card's rate will differ slightly.
        <button id="rates" class="link">Update rate</button></p>
      <table class="quick"><tbody>${table}</tbody></table>`;
    })() : `<p>No saved rate for ${esc(co.currencyPlural)} yet. <button id="rates" class="ghost">Get today's rate</button></p>`;
    const speak = native || "speechSynthesis" in window;
    const phrases = co.phrases.map((x, i) => `<li><div><b>${esc(x.local)}</b> <span class="say">${esc(x.say)}</span><small>${esc(x.en)}${x.note ? " · " + esc(x.note) : ""}</small></div>
      ${speak && x.lang !== "en-GB" ? `<button class="spk" data-i="${i}" aria-label="Say ${esc(x.local)}">🔊</button>` : ""}</li>`).join("");
    $("#money").innerHTML = `
      <h3>Money</h3>${conv}
      <p>${esc(co.money)}</p>
      <h3>Tipping</h3><p>${esc(co.tipping)}</p>
      <h3>${({ NO: "Norwegian (and a little Sámi)", GB: "Words you'll hear", DE: "German", FR: "French", CH: "Swiss German" })[p.country] || "Phrases"}</h3>
      <ul class="phrases">${phrases}</ul>
      ${p.country === "NO" ? `<p class="fine">Almost everyone in Norway speaks excellent English; a "hei" and "takk" still go a long way.</p>` : ""}`;
    const amt = $("#amt");
    if (amt) amt.oninput = () => {
      state.amount = amt.value.replace(",", "."); store.set("amount", state.amount);
      const a = +state.amount || 0;
      $("#res").textContent = state.dir === "local" ? P.fmtMoney(P.convert(a, cur, "USD", r), "USD") : P.fmtMoney(P.convert(a, "USD", cur, r), cur);
    };
    const sw = $("#swap"); if (sw) sw.onclick = () => { state.dir = state.dir === "local" ? "usd" : "local"; store.set("dir", state.dir); renderMoney(); };
    const rb = $("#rates"); if (rb) rb.onclick = () => refreshRates(rb);
    $("#money").querySelectorAll(".spk").forEach(b => b.onclick = () => {
      const x = co.phrases[+b.dataset.i];
      if (native) { native.postMessage({ cmd: "speak", text: x.local.replace(/…/g, ""), lang: x.lang === "se" ? "nb-NO" : x.lang }); return; }
      const u = new SpeechSynthesisUtterance(x.local.replace(/…/g, ""));
      u.lang = x.lang === "se" ? "nb-NO" : x.lang; u.rate = 0.8;
      const v = speechSynthesis.getVoices().find(v => v.lang && v.lang.replace("_", "-").startsWith(u.lang.slice(0, 2)));
      if (v) u.voice = v;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    });
  }

  // ---- Footer: sources --------------------------------------------------------------------------------------
  function renderFoot() {
    const p = state.port, src = p.sources.concat(COUNTRIES[p.country].sources, voyage.sources || []);
    $("#foot").innerHTML = `<details><summary>Sources for ${esc(p.name)}</summary><ul>${src.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join("")}</ul></details>
      <p class="fine">Sights, coordinates and opening hours © OpenStreetMap contributors (ODbL)${PLACES.generated ? ", updated " + esc(PLACES.generated) : ""}. Weather: Open-Meteo.com (CC BY 4.0). Rates: European Central Bank via Frankfurter. Sun times calculated on your phone. Works offline once opened.</p>`;
  }

  function renderTabs() {
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === state.tab));
    ["walk", "near", "day", "money"].forEach(id => $("#" + id).hidden = id !== state.tab);
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => { state.tab = b.dataset.tab; store.set("tab", state.tab); renderTabs(); renderPanel(); });
  function renderPanel() { ({ walk: renderWalk, near: renderNear, day: renderDay, money: renderMoney })[state.tab](); }

  function render() { renderVoyages(); renderPorts(); renderHero(); renderTabs(); renderWalk(); renderNear(); renderDay(); renderMoney(); renderFoot(); }
  render();
  setInterval(renderHero, 60e3);

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
