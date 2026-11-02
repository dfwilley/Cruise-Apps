/* Port Pocket Guide — screens. Port facts: data/ports.js. Sights, hours, typical weather, saved rates: data/places.js. */
(function () {
  const P = window.Port, I = window.PortImport, FACTS = window.PORT_FACTS, PLACES = window.PORT_PLACES || { ports: {}, climate: {} };
  const COUNTRIES = FACTS.countries, BUILT_IN = Object.keys(COUNTRIES);
  let VOYAGES = [];
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
    set(k, v) { try { localStorage.setItem("ppg." + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };

  // ---- Your own cruises (added on the phone): kept in this app's storage, and in the iPhone app also in a file -----------
  // Each: { voyage, places: { ports: {id: {sights, practical}}, climate: {id: {...}} }, countries: {code: {...}} }
  function loadCruises() {
    let list = store.get("cruises", null);
    if (!list && window.__savedCruises) { try { list = JSON.parse(window.__savedCruises); store.set("cruises", list); } catch (e) {} }
    return Array.isArray(list) ? list : [];
  }
  let CRUISES = loadCruises();
  function saveCruises() {
    const ok = store.set("cruises", CRUISES);
    if (native) native.postMessage({ cmd: "saveCruises", json: JSON.stringify(CRUISES) });
    if (!ok && !native) toast("This browser's storage is full — the cruise is only kept until you close the page.");
    mergeCruises();
  }
  const firstDate = v => v.ports[0].days[0].date;
  function mergeCruises() {
    for (const c of CRUISES) {
      Object.assign(PLACES.ports, c.places.ports); PLACES.climate = Object.assign(PLACES.climate || {}, c.places.climate);
      for (const [k, co] of Object.entries(c.countries || {})) if (!BUILT_IN.includes(k)) COUNTRIES[k] = co;
    }
    VOYAGES = FACTS.voyages.concat(CRUISES.map(c => c.voyage)).sort((a, b) => firstDate(a) < firstDate(b) ? -1 : 1);
  }
  mergeCruises();

  // Which voyage: from the link, else the one picked last (unless it's over), else the next one by date.
  const voyageEnd = v => P.portCall(v.ports[v.ports.length - 1]).end;
  const picked = VOYAGES.find(v => v.id === store.get("voyage", null));
  let voyage = (qs.get("voyage") && VOYAGES.find(v => v.id === qs.get("voyage")))
    || (qs.get("port") && VOYAGES.find(v => v.ports.some(p => p.id === qs.get("port"))))
    || (picked && now() < voyageEnd(picked) ? picked : null) || P.currentVoyage(VOYAGES, now());
  let cur = P.currentPort(voyage.ports, now());
  const TABS = ["walk", "ideas", "day", "money"];
  const state = {
    mode: ["near", "add"].includes(qs.get("mode")) ? qs.get("mode") : "voyage",   // "voyage" (a cruise's guide), "near" (places around you), "add" (add a cruise)
    port: (qs.get("port") && voyage.ports.find(p => p.id === qs.get("port"))) || cur.port,
    tab: (t => t === "near" ? "ideas" : TABS.includes(t) ? t : "walk")(qs.get("tab") || store.get("tab", "walk")),
    cat: store.get("cat", "all"), radius: store.get("radius", 1600), more: 0,
    draft: null,
    filter: "all",
    me: null,           // { lat, lon, at }
    rates: (() => {   // newest of the saved rate and the one bundled with the app, as long as it has every currency
      const a = store.get("rates", null), b = PLACES.rates || null, ok = r => r && ["NOK", "GBP", "EUR", "CHF"].every(k => r[k]);
      if (ok(a) && ok(b)) return a.date >= b.date ? Object.assign({}, b, a) : Object.assign({}, a, b);
      return ok(a) ? a : b || a;
    })(),
    amount: store.get("amount", 100),
    dir: store.get("dir", "local"),   // "local" → amounts typed in local money; "usd" → typed in dollars
    forecast: {}
  };

  // Piers: the guide's list, plus the spot you marked as the ship ("The ship is here").
  const piersOf = p => { const b = store.get("berth." + p.id, null);
    return b ? p.piers.concat({ id: "mine", name: "The ship (marked by you)", lat: b.lat, lon: b.lon, note: "Saved from your phone's location on the dock." }) : p.piers; };
  const pierOf = p => {
    const id = store.get("pier." + p.id, null), list = piersOf(p);
    return list.find(x => x.id === id) || list.find(x => x.id === "mine") || list.find(x => x.primary) || list[0];
  };
  // Where walking distances are measured from: the pier, or the city centre when the pier is out of town (Rosyth, Tilbury).
  const refOf = p => { const pr = pierOf(p); return pr.walkFromPier === false ? { ...p.center, label: p.center.name } : { ...pr, label: pr.name }; };

  // ---- Voyage switcher and port chips -----------------------------------------------------------------------
  // Top bar: Near me · each cruise · Add cruise
  function renderVoyages() {
    const sel = v => state.mode === "voyage" && v === voyage;
    $("#voyages").innerHTML = `<button role="tab" class="nearbtn" data-m="near" aria-selected="${state.mode === "near"}">📍 Near me<span>Anywhere</span></button>`
      + VOYAGES.map(v => `<button role="tab" data-v="${v.id}" aria-selected="${sel(v)}">${esc(v.short)}<span>${esc(v.dates)}</span></button>`).join("")
      + `<button role="tab" class="addbtn" data-m="add" aria-selected="${state.mode === "add"}">＋ Add cruise<span>From your itinerary</span></button>`;
    $("#voyages").querySelectorAll("button").forEach(b => b.onclick = () => {
      if (b.dataset.m) { setMode(b.dataset.m); return; }
      const v = VOYAGES.find(v => v.id === b.dataset.v);
      if (state.mode === "voyage" && v === voyage) return;
      if (v !== voyage) { voyage = v; cur = P.currentPort(voyage.ports, now()); state.port = cur.port; state.filter = "all"; }
      store.set("voyage", voyage.id); setMode("voyage");
    });
    const on = $("#voyages [aria-selected=true]"); if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "center" });
    $("#voyage").textContent = state.mode === "near" ? "Places of interest around you" : state.mode === "add" ? "Add a cruise from your itinerary"
      : [voyage.ship, voyage.name].filter(Boolean).join(" · ");
  }
  function setMode(m) {
    state.mode = m;
    if (m === "near" && (!state.me || Date.now() - state.me.at > 120e3)) locate();
    render(); window.scrollTo(0, 0);
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
    const sg = n => (n < 0 ? "−" : "+") + Math.abs(n);
    const tzTxt = p.tz === 0 ? "local time UTC (Arizona +7 h)" : `local time UTC${sg(p.tz)} (Arizona ${p.tz + 7 === 0 ? "same time" : sg(p.tz + 7) + " h"})`;
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
      if (c.disembark) status = c.arrive && t < c.arrive ? `Arrive ${P.fmt12(c.arrive, p.tz)} · disembarkation day` : "Disembarkation day";
      else if (!c.arrive) status = t < c.start ? (d => d > 1 ? `In ${d} days` : "Tomorrow")(Math.ceil((c.start - t) / 864e5)) + " · embarkation" : t < c.allAboard ? `<strong>All aboard in ${P.fmtMin(Math.round((c.allAboard - t) / 60e3))}</strong>` : t < c.depart ? "<strong>All aboard now</strong>" : "Sailed";
      else if (t < c.arrive) {
        const days = Math.ceil((c.arrive - t) / 864e5);
        status = days > 1 ? `In ${days} days` : `Arriving in ${P.fmtMin(Math.round((c.arrive - t) / 60e3))}`;
      } else if (t < c.allAboard) status = `<strong>All aboard in ${P.fmtMin(Math.round((c.allAboard - t) / 60e3))}</strong>`;
      else if (t < c.depart) status = "<strong>All aboard now</strong>";
      else status = "Sailed";
      times = c.disembark
        ? `<div><span>Arrive</span><b>${c.arrive ? P.fmt12(c.arrive, p.tz) : "—"}</b></div><div><span>Ashore</span><b>Final day</b></div>`
        : `<div><span>${c.arrive ? "Arrive" : "Board"}</span><b${c.arrive ? "" : ' class="small"'}>${c.arrive ? P.fmt12(c.arrive, p.tz) : "See your documents"}</b>${c.overnight && c.arrive ? `<i>${P.dayLabel(p.days[0].date).split(",")[0]}</i>` : ""}</div>
           <div class="aboard"><span>All aboard</span><b>${P.fmt12(c.allAboard, p.tz)}</b>${c.overnight ? `<i>${P.dayLabel(p.days[p.days.length - 1].date).split(",")[0]}</i>` : ""}</div>
           <div><span>Sail</span><b>${P.fmt12(c.depart, p.tz)}</b></div>`;
    }
    const alertBtn = native && c.allAboard && !c.disembark && t < c.allAboard ? `<button id="remind" class="ghost">⏰ Remind me 1 hour before all aboard</button>` : "";
    const fine = !c.timed ? (voyage.imported ? "Your itinerary has no times for this port — check the daily program on board for arrival and all-aboard times."
        : "Viking publishes the ports but not the docking times for river voyages — check the daily program on board for arrival and all-aboard times.")
      : c.disembark ? "" : "All aboard is assumed 30 minutes before sailing — " + (voyage.imported ? "the ship's" : "Viking's") + " daily program has the exact time.";
    $("#hero").innerHTML = `
      <h2>${esc(p.name)}</h2>
      <p class="sub">${esc(dayTxt)} · ${esc((COUNTRIES[p.country] || {}).name || p.country)} · ${tzTxt}</p>
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
  const ICON = { museum: "🏛", "air museum": "✈️", gallery: "🖼", viewpoint: "⛰", attraction: "★", historic: "🏰", church: "⛪", "cable car": "🚡", park: "🌳",
    "tourist info": "ℹ︎", pharmacy: "✚", cash: "💳", "money exchange": "💱", groceries: "🛒", toilets: "🚻", "shopping centre": "🛍", shop: "🛍", "outdoor gear": "🧤",
    "train station": "🚆", taxi: "🚕", ferry: "⛴", hospital: "🏥", "post office": "✉️" };
  const FILTERS = [["all", "All"], ["museum", "Museums"], ["church", "Churches"], ["viewpoint", "Views"], ["park", "Parks"], ["historic", "Historic"], ["attraction", "Sights"]];

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
    const kind = it.label || it.kind;
    return `<li class="place">
      <span class="ico" aria-hidden="true">${ICON[it.kind] || "•"}</span>
      <div class="pbody">
        <b>${esc(it.name)}</b>${it.local ? ` <small>${esc(it.local)}</small>` : ""}
        <div class="meta"><span>${esc(kind)}</span><span>${P.fmtMi(w.mi)} · ${far ? "taxi or bus" : P.fmtMin(w.min) + " walk"}</span></div>
        <div>${hoursBadge(it, p)}</div>
      </div>
      <a class="go" href="${P.mapsLink(it, from, far ? "d" : "w")}" target="_blank" rel="noopener" aria-label="Directions to ${esc(it.name)}">Map</a>
    </li>`;
  }
  function renderWalk() {
    const p = state.port, pr = pierOf(p), ref = refOf(p), data = PLACES.ports[p.id] || { sights: [], practical: [] };
    const from = state.me || ref;
    const fromLabel = state.me ? "your location" : (pr.walkFromPier === false ? p.center.name : pr.name.replace(/ \(.*\)/, ""));
    const toCentre = P.walk(P.km(pr.lat, pr.lon, p.center.lat, p.center.lon));
    const piers = piersOf(p).map(x => `
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
      <p class="fine">${p.imported ? "Pick the berth when you know it, or mark it on the dock with your location." : "Viking confirms the berth near arrival. Pick the one in the daily program and distances update."}</p>
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
    const mark = state.me && P.km(state.me.lat, state.me.lon, p.area.lat, p.area.lon) <= p.area.r + 10
      ? `<div class="row"><button id="shiphere" class="ghost">🚢 The ship is here</button><span class="fine">Standing at the gangway? Save this spot so "back to the ship" measures from the real berth.</span></div>` : "";
    if (mark) $("#walk .piers").insertAdjacentHTML("afterend", mark);
    const sh = $("#shiphere");
    if (sh) sh.onclick = () => { store.set("berth." + p.id, { lat: state.me.lat, lon: state.me.lon }); store.set("pier." + p.id, "mine"); toast("Saved — distances back to the ship now start from here."); renderWalk(); };
    $("#walk").querySelectorAll("input[name=pier]").forEach(i => i.onchange = () => { store.set("pier." + p.id, i.value); renderWalk(); });
    $("#walk").querySelectorAll(".f").forEach(b => b.onclick = () => { state.filter = b.dataset.f; renderWalk(); });
    $("#locate").onclick = locate;
  }

  function locate() {
    document.querySelectorAll(".locate").forEach(b => { b.textContent = "📍 Finding you…"; b.disabled = true; });
    if (native) { native.postMessage({ cmd: "locate" }); return; }
    if (!navigator.geolocation) return gotError("This browser can't share location.");
    navigator.geolocation.getCurrentPosition(
      pos => gotLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
      err => gotError(err.code === 1 ? "Location is off for this site. Turn it on in Settings › Privacy › Location Services › Safari Websites." : "Couldn't get a GPS fix — try again in the open."),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
  }
  function gotLocation(lat, lon, acc) {
    const p = state.port, d = P.km(lat, lon, p.area.lat, p.area.lon);
    state.me = { lat, lon, acc, at: Date.now() };
    renderWalk(); renderIdeas(); renderAround();
    if (state.mode === "near") loadAround();
    else if (d > 40) toast(`You're ${Math.round(d / 1.609)} miles from ${p.name} — distances are from where you are now.`);
  }
  function gotError(msg) { toast(msg); renderWalk(); renderIdeas(); renderAround(); }
  window.__portNative = m => {
    if (m.type === "location") gotLocation(m.lat, m.lon, m.acc);
    else if (m.type === "error") gotError(m.message);
  };
  function toast(msg) {
    let t = $("#toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.className = "show"; clearTimeout(t._h); t._h = setTimeout(() => t.className = "", 5000);
  }


  // ---- Shared by Ideas and Near me ---------------------------------------------------------------------------
  const FOOD = { cafe: "☕", restaurant: "🍽", bakery: "🥨", pastry: "🍰", ice_cream: "🍦", pub: "🍺", biergarten: "🍺", bar: "🍷", fast_food: "🌭", wine: "🍷", chocolate: "🍫", confectionery: "🍬" };
  const portOfLocation = loc => {   // the port (any cruise) you're at, if you're within its area
    let best = null;
    for (const v of VOYAGES) for (const p of v.ports) {
      const d = P.km(loc.lat, loc.lon, p.area.lat, p.area.lon);
      if (d <= p.area.r + 3 && (!best || d < best.d)) best = { p, v, d };
    }
    return best;
  };
  // Local clock for "open now": the port's zone when you're at a port (or previewing), else the phone's own clock.
  function clockFor(p) {
    if (p && (fakeNow || (state.me && portOfLocation(state.me)))) {
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
  function findSight(p, idea) {   // match an idea to a mapped place, for its distance and hours
    if (idea.lat != null) return { name: idea.title, lat: idea.lat, lon: idea.lon };
    const data = PLACES.ports[p.id]; if (!data) return null;
    const key = idea.q.toLowerCase().split(" ").filter(w => w.length > 3);
    return data.sights.concat(data.practical).find(s => {
      const n = (s.name + " " + (s.local || "")).toLowerCase();
      return key.length && key.every(w => n.includes(w));
    }) || null;
  }
  // How far, in words: a walk up to about 2 miles, a ride beyond.
  function howFar(from, to) {
    const w = P.walk(P.km(from.lat, from.lon, to.lat, to.lon));
    return { w, txt: P.fmtMi(w.mi) + " · " + (w.min > 45 ? "drive, taxi or bus" : P.fmtMin(w.min) + " walk"), mode: w.min > 45 ? "d" : "w" };
  }
  function ideaList(p, from, ck, left, fromLabel) {
    return (p.ideas || []).map(idea => {
      const s = findSight(p, idea);
      const f = s ? howFar(from, s) : null;
      const o = s && s.hours ? openNow(s.hours, ck) : null;
      const near = s || p.center;
      const link = s ? P.mapsLink(s, from === state.me ? from : null, f && f.mode) : `https://maps.apple.com/?q=${encodeURIComponent(idea.q)}&sll=${near.lat},${near.lon}`;
      const fits = left != null && f ? (f.w.min * 2 + 30 <= left) : null;
      return `<li class="idea">
        <div><b>${esc(idea.title)}</b>${idea.time ? ` <span class="tag">${esc(idea.time)}</span>` : ""}
          <p>${esc(idea.what)}${idea.url ? ` <a href="${esc(idea.url)}" target="_blank" rel="noopener">More</a>` : ""}</p>
          <div class="meta">${f ? `<span>${f.txt}${fromLabel ? " " + fromLabel : ""}</span>` : ""}
            ${o ? `<span class="hrs ${o.cls}">${esc(o.txt)}</span>` : ""}${fits === false ? `<span class="hrs warn">Tight before all aboard</span>` : ""}</div></div>
        <a class="go" href="${link}" target="_blank" rel="noopener" aria-label="Map for ${esc(idea.title)}">Map</a></li>`;
    }).join("");
  }

  // ---- Ideas (lower tab): things to do in the selected port, for planning ahead -------------------------------------
  function renderIdeas() {
    const p = state.port, me = state.me, ck = clockFor(p), c = P.portCall(p);
    const at = me ? portOfLocation(me) : null, here = at && at.p === p;
    const from = here ? me : refOf(p);
    const left = c.allAboard && now() < c.allAboard && now() >= c.start ? Math.round((c.allAboard - now()) / 60e3) : null;
    const ideas = ideaList(p, from, ck, left, here ? "" : p.imported ? "from the centre" : "from the pier");
    $("#ideas").innerHTML = `
      <p class="clock">It's <b>${esc(ck.label)}</b> ${fakeNow || here ? "in " + esc(p.name.replace(/ \(.*\)| &.*/, "")) : "on your phone"}${left != null ? ` · all aboard in <b>${P.fmtMin(left)}</b>` : ""}.</p>
      <p class="callout">For what's around you right now — anywhere — tap <button class="link" id="gonear">📍 Near me</button> at the top.</p>
      <h3>Ideas for ${esc(p.name)}</h3>
      ${ideas ? `<ul class="ideas">${ideas}</ul>
      <p class="fine">${p.imported ? "Notable places near the town centre, from Wikipedia." : "Suggestions to pick from on your own time"} — check hours and Viking's included tours before you set off.</p>`
        : `<p class="fine">No ideas saved for this port yet. Sights are under Pier &amp; walking, and Near me finds what's around you once you're ashore.</p>`}`;
    $("#gonear").onclick = () => setMode("near");
  }

  // ---- Near me (top bar): places of interest around the phone's location, anywhere ---------------------------------
  const RADII = [[800, "10-min walk"], [1600, "20-min walk"], [8000, "Short drive"]];
  const CATS = [["all", "All"], ["sight", "Sights"], ["museum", "Museums"], ["food", "Food & drink"], ["park", "Views & parks"], ["shop", "Shops"], ["handy", "Handy"]];
  const inCat = (x, c) => c === "all" || (c === "museum" ? /museum|gallery/.test(x.kind) : c === "park" ? x.kind === "park" || x.kind === "viewpoint" : x.g === c);
  function placeItem(x, me, ck) {
    const o = x.hours ? openNow(x.hours, ck) : null, f = howFar(me, x);
    return `<li class="place"><span class="ico" aria-hidden="true">${FOOD[x.kind] || ICON[x.kind] || "•"}</span><div class="pbody"><b>${esc(x.name)}</b>${x.local ? ` <small>${esc(x.local)}</small>` : ""}
      <div class="meta"><span>${esc(x.label || x.kind)}</span><span>${f.txt}</span></div>${o ? `<span class="hrs ${o.cls}">${esc(o.txt)}</span>` : ""}</div>
      <a class="go" href="${P.mapsLink(x, me, f.mode)}" target="_blank" rel="noopener" aria-label="Directions to ${esc(x.name)}">Map</a></li>`;
  }
  function renderAround() {
    const el = $("#around"); if (!el || state.mode !== "near") return;
    const me = state.me, at = me ? portOfLocation(me) : null, ck = clockFor(at && at.p);
    const radius = RADII.map(([m, l]) => `<button class="f${state.radius === m ? " on" : ""}" data-r="${m}">${l}</button>`).join("");
    const cats = CATS.map(([k, l]) => `<button class="f${state.cat === k ? " on" : ""}" data-c="${k}">${l}</button>`).join("");
    const accTxt = me && me.acc ? ` · within ${me.acc < 100 ? Math.round(me.acc * 3.281) + " ft" : P.fmtMi(me.acc / 1609)}` : "";
    let body = "";
    if (!me) body = `<p class="callout">Tap <b>Find places near me</b> and allow location when your iPhone asks. Your position goes only to the map lookups.</p>`;
    else {
      let port = "";
      if (at) {   // in a cruise port: time left and the way back to the ship
        const p = at.p, c = P.portCall(p), pr = pierOf(p);
        const left = c.allAboard && now() < c.allAboard && now() >= c.start ? Math.round((c.allAboard - now()) / 60e3) : null;
        const back = howFar(me, pr);
        port = `<div class="back${left != null && back.w.min + 15 > left ? " tight" : ""}"><b>You're in ${esc(p.name)}</b> (${esc(at.v.short)}).
          ${left != null ? `All aboard in <b>${P.fmtMin(left)}</b>. ` : ""}${pr.walkFromPier === false ? "" : `Back to ${esc(pr.name.replace(/ \(.*\)/, ""))}: ${back.txt}. <a href="${P.mapsLink({ lat: pr.lat, lon: pr.lon, name: pr.name }, me, back.mode)}" target="_blank" rel="noopener">Walk me back</a>`}
          <br><button class="link" id="openport">Open the ${esc(p.name.replace(/ \(.*\)/, ""))} guide</button></div>`;
        const ideas = ideaList(p, me, ck, left, "");
        if (ideas && (state.cat === "all" || state.cat === "sight")) port += `<h3>Ideas for ${esc(p.name)}</h3><ul class="ideas">${ideas}</ul>`;
      }
      const a = state.around;
      let list = "";
      if (!a || a.loading) list = `<p class="fine">Looking for places around you…</p>`;
      else if (a.error) list = `<p class="callout warn">${esc(a.error)}</p>`;
      else {
        const notable = (state.cat === "all" || state.cat === "sight") ? a.notable.filter(n => n.d * 1000 <= state.radius * 1.2).slice(0, 8) : [];
        const items = a.items.filter(x => inCat(x, state.cat) && x.d * 1000 <= state.radius * 1.05);
        const shown = items.slice(0, 30 + state.more);
        list = (notable.length ? `<h3>Notable places</h3><ul class="places">${notable.map(n => {
            const f = howFar(me, n);
            return `<li class="place notable">${n.thumb ? `<img src="${esc(n.thumb)}" alt="" loading="lazy">` : `<span class="ico" aria-hidden="true">★</span>`}
              <div class="pbody"><b>${esc(n.title)}</b><p class="what">${esc(n.what)}</p><div class="meta"><span>${f.txt}</span><a href="${esc(n.url)}" target="_blank" rel="noopener">Read about it</a></div></div>
              <a class="go" href="${P.mapsLink({ lat: n.lat, lon: n.lon, name: n.title }, me, f.mode)}" target="_blank" rel="noopener">Map</a></li>`; }).join("")}</ul>` : "")
          + `<h3>${state.cat === "all" ? "Everything nearby" : esc(CATS.find(c => c[0] === state.cat)[1])} <small class="fine">${items.length} found</small></h3>`
          + (shown.length ? `<ul class="places compact">${shown.map(x => placeItem(x, me, ck)).join("")}</ul>`
              + (items.length > shown.length ? `<button class="ghost wide" id="more">Show ${Math.min(30, items.length - shown.length)} more</button>` : "")
            : `<p class="fine">Nothing of that kind within ${RADII.find(r => r[0] === state.radius)[1].toLowerCase()}. Try a wider distance.</p>`)
          + `<p class="fine">${a.cached ? "Saved list from " : "Live from "}OpenStreetMap and Wikipedia, ${new Date(a.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Hours shown where the map has them — check before a long walk.</p>`;
      }
      body = port + list;
    }
    el.innerHTML = `
      <div class="row"><button class="ghost locate" id="locate3">📍 ${me ? "Update my location" : "Find places near me"}</button>
        <span class="fine">${me ? `Updated ${new Date(me.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${accTxt}` : ""}</span></div>
      <p class="clock">It's <b>${esc(ck.label)}</b>${at ? " in " + esc(at.p.name.replace(/ \(.*\)| &.*/, "")) : ""}.</p>
      <div class="filters" aria-label="How far">${radius}</div>
      <div class="filters" aria-label="What">${cats}</div>
      ${body}`;
    $("#locate3").onclick = locate;
    el.querySelectorAll("[data-r]").forEach(b => b.onclick = () => {
      const r = +b.dataset.r, wider = r > (state.around && state.around.r || 0);
      state.radius = r; state.more = 0; store.set("radius", r);
      if (wider && me && state.around && !state.around.loading) loadAround(); else renderAround();
    });
    el.querySelectorAll("[data-c]").forEach(b => b.onclick = () => { state.cat = b.dataset.c; state.more = 0; store.set("cat", state.cat); renderAround(); });
    const mo = $("#more"); if (mo) mo.onclick = () => { state.more += 30; renderAround(); };
    const op = $("#openport"); if (op) op.onclick = () => { voyage = at.v; state.port = at.p; store.set("voyage", voyage.id); setMode("voyage"); };
  }
  async function overpass(q) {
    for (const url of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
      try {
        const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        if (r.ok) return await r.json();
      } catch (e) {}
    }
    throw new Error("map lookup failed");
  }
  async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return r.json(); }
  const wikiURL = (lat, lon, r, n) => `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch&ggscoord=${lat}%7C${lon}&ggsradius=${Math.min(10000, r)}&ggslimit=${n}&prop=coordinates%7Cdescription%7Cpageimages&piprop=thumbnail&pithumbsize=160&colimit=max`;
  async function loadAround() {
    const me = state.me; if (!me) return;
    const r = Math.max(state.radius, 1600);   // fetch at least a 20-minute walk, so narrowing needs no new lookup
    state.around = { loading: true }; renderAround();
    const [osm, wiki] = await Promise.allSettled([overpass(I.aroundQuery(me.lat, me.lon, r)), getJSON(wikiURL(me.lat, me.lon, r, 50))]);
    if (state.me !== me) return;
    if (osm.status === "fulfilled" || wiki.status === "fulfilled") {
      state.around = { items: osm.status === "fulfilled" ? I.placesFrom(osm.value.elements, me.lat, me.lon, P.km) : [],
        notable: wiki.status === "fulfilled" ? I.notableFrom((wiki.value.query || {}).pages, me.lat, me.lon, P.km) : [], at: Date.now(), r, lat: me.lat, lon: me.lon };
      store.set("around", state.around);
    } else {
      const saved = store.get("around", null);
      state.around = saved && P.km(me.lat, me.lon, saved.lat, saved.lon) < 1 ? Object.assign(saved, { cached: true })
        : { error: "No connection for the map lookup right now. When you're in a cruise port, the Ideas and Pier & walking tabs still work offline." };
    }
    renderAround();
  }

  // ---- Add cruise (top bar): paste or pick an itinerary, check it, build a tab ----------------------------------------
  const emptyRow = () => ({ date: "", port: "", from: "", to: "" });
  function newDraft() { return { name: "", ship: "", start: "", text: "", rows: [], editing: null, log: [], busy: false }; }
  function renderAdd() {
    const el = $("#add"); if (!el || state.mode !== "add") return;
    const d = state.draft || (state.draft = newDraft());
    const mine = CRUISES.map(c => `<li><div><b>${esc(c.voyage.name)}</b><span class="fine">${esc(c.voyage.dates)} · ${c.voyage.ports.length} ports</span></div>
      <button class="ghost" data-edit="${c.voyage.id}">Edit</button><button class="ghost danger" data-del="${c.voyage.id}">Remove</button></li>`).join("");
    const rows = d.rows.map((r, i) => `<li class="dayrow">
      <input class="port" type="text" data-i="${i}" data-k="port" value="${esc(r.port)}" placeholder="Town, Country" aria-label="Port">
      <button class="x" data-rm="${i}" aria-label="Remove this day">✕</button>
      <label><span>Date</span><input type="date" data-i="${i}" data-k="date" value="${esc(r.date)}"></label>
      <label><span>Arrive</span><input type="time" data-i="${i}" data-k="from" value="${esc(r.from || "")}"></label>
      <label><span>Depart</span><input type="time" data-i="${i}" data-k="to" value="${esc(r.to || "")}"></label></li>`).join("");
    el.innerHTML = `
      ${mine ? `<h3>Your cruises</h3><ul class="mine">${mine}</ul>` : ""}
      <h3>${d.editing ? "Edit " + esc(d.name) : "Add a cruise"}</h3>
      <p>Paste the itinerary — from the cruise line's website, your booking or an email — or pick a file. One port per line with its date, plus arrival and departure times if you have them. Sea days are skipped.</p>
      <div class="form">
        <label><span>Cruise name</span><input id="cname" type="text" value="${esc(d.name)}" placeholder="e.g. Mediterranean Odyssey"></label>
        <label><span>Ship (optional)</span><input id="cship" type="text" value="${esc(d.ship)}" placeholder="e.g. Viking Sea"></label>
        <label><span>First day (only needed if the lines say "Day 1, Day 2…" without dates)</span><input id="cstart" type="date" value="${esc(d.start)}"></label>
      </div>
      <textarea id="ctext" rows="7" placeholder="May 4, 2027   Basel, Switzerland&#10;May 6, 2027   Breisach, Germany   8:00 AM   6:00 PM&#10;May 7, 2027   At sea&#10;…">${esc(d.text)}</textarea>
      <div class="row"><button id="cread" class="ghost">Read itinerary</button>
        <label class="ghost file">Pick a file…<input id="cfile" type="file" accept=".txt,.csv,.tsv,.ics,text/plain,text/csv,text/calendar"></label>
        <span class="fine">Text, spreadsheet (.csv) or calendar (.ics)</span></div>
      <details class="fine"><summary>Examples it understands</summary>
        <pre>Sat, Jan 30, 2027  Tromsø, Norway  12:00 PM  11:00 PM
2027-09-12, Ajaccio, France, 08:00, 18:00
12/30/2027 Cozumel, Mexico 7am 5pm
Day 1   (then the port on the next line, with
Basel    the first day filled in above)</pre></details>
      ${d.rows.length ? `<h3>Check the ports <small class="fine">${new Set(d.rows.map(r => r.port.toLowerCase())).size} ports, ${d.rows.length} days</small></h3>
        <p class="fine">Fix anything that came through wrong. Times are local port times; leave them blank if you don't know them. Adding the country ("Ajaccio, France") helps find the right town.</p>
        <ul class="rows">${rows}</ul>
        <div class="row"><button id="caddrow" class="ghost">＋ Add a day</button></div>
        <button id="cbuild" class="build"${d.busy ? " disabled" : ""}>${d.busy ? "Building…" : d.editing ? "Update the cruise tab" : "Build the cruise tab"}</button>
        <p class="fine">Building looks up each port on the map and gathers its sights, opening hours and typical weather (about 10 seconds a port; needs a connection). After that the cruise works offline like the others.</p>` : ""}
      ${d.log.length ? `<ul class="log">${d.log.map(l => `<li class="${l.cls || ""}">${l.html}</li>`).join("")}</ul>` : ""}`;
    const bind = (id, k) => { const i = $("#" + id); i.oninput = () => { d[k] = i.value; }; };
    bind("cname", "name"); bind("cship", "ship"); bind("cstart", "start"); bind("ctext", "text");
    $("#cread").onclick = () => readItinerary(d.text);
    $("#cfile").onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { d.text = t; if (!d.name) d.name = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "); readItinerary(t); }); };
    el.querySelectorAll(".rows input").forEach(i => i.oninput = () => { d.rows[+i.dataset.i][i.dataset.k] = i.value; });
    el.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { d.rows.splice(+b.dataset.rm, 1); renderAdd(); });
    const ar = $("#caddrow"); if (ar) ar.onclick = () => { const last = d.rows[d.rows.length - 1]; d.rows.push(Object.assign(emptyRow(), last && last.date ? { date: I.addDays(last.date, 1) } : {})); renderAdd(); };
    const bb = $("#cbuild"); if (bb) bb.onclick = buildCruise;
    el.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editCruise(b.dataset.edit));
    el.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to remove"; return; }   // two taps, no pop-up
      const c = CRUISES.find(c => c.voyage.id === b.dataset.del);
      CRUISES = CRUISES.filter(x => x !== c); saveCruises();
      for (const p of c.voyage.ports) { delete PLACES.ports[p.id]; delete PLACES.climate[p.id]; }
      if (voyage === c.voyage) { voyage = P.currentVoyage(VOYAGES, now()); cur = P.currentPort(voyage.ports, now()); state.port = cur.port; }
      toast("Removed " + c.voyage.name + "."); render();
    });
  }
  function readItinerary(text) {
    const d = state.draft;
    if (!text || !text.trim()) { toast("Paste the itinerary in the box first, or pick a file."); return; }
    const res = I.parseAny(text, { start: d.start || null, today: now() });
    if (!res.rows.length) {
      d.log = [{ cls: "bad", html: res.skipped.length ? `Found "Day 1, Day 2…" lines without dates — fill in <b>First day</b> above and tap Read itinerary again.`
        : "Couldn't find any dates with ports in that text. Each port needs a date on its line (or a Day number plus the first day above)." }];
    } else {
      d.rows = res.rows.map(r => ({ date: r.date, port: r.port, from: r.from || "", to: r.to || "", fromUTC: r.fromUTC, toUTC: r.toUTC, note: r.note }));
      d.log = [];
      if (!d.name) d.name = "My cruise " + d.rows[0].date.slice(0, 4);
    }
    renderAdd();
    const t = $(".rows"); if (t && t.scrollIntoView) t.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function editCruise(id) {
    const c = CRUISES.find(c => c.voyage.id === id), v = c.voyage;
    state.draft = Object.assign(newDraft(), { name: v.name, ship: v.ship || "", editing: id,
      rows: v.ports.flatMap(p => p.days.map(day => ({ date: day.date, port: p.name + ", " + ((COUNTRIES[p.country] || {}).name || p.country), from: day.from || "", to: day.to || "", note: day.note }))) });
    renderAdd(); window.scrollTo(0, 0);
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function buildCruise() {
    const d = state.draft, log = (html, cls) => { d.log.push({ html, cls }); renderAdd(); };
    const rows = d.rows.filter(r => r.date && r.port.trim()).map(r => Object.assign({}, r, { port: r.port.trim(), from: r.from || null, to: r.to || null }));
    if (!rows.length) { toast("Add at least one port with a date."); return; }
    if (!d.name.trim()) d.name = "My cruise " + rows[0].date.slice(0, 4);
    d.busy = true; d.log = []; renderAdd();
    const id = d.editing || "my-" + I.slug(d.name) + "-" + Date.now().toString(36).slice(-4);
    const groups = I.groupRows(rows), ports = [], places = { ports: {}, climate: {} }, countries = {}, missing = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      log(`Looking up <b>${esc(g.name)}</b>…`);
      const geo = await I.geocode(g.name, getJSON);
      d.log.pop();
      if (!geo) { missing.push(g.name); log(`✕ Couldn't find <b>${esc(g.name)}</b> on the map — check the spelling or add the country.`, "bad"); continue; }
      const p = I.makePort(id, g, geo, i + 1);
      if (!countries[p.country] && !BUILT_IN.includes(p.country)) countries[p.country] = I.makeCountry(p.country, COUNTRIES);
      // Sights and handy places within about 1½ miles of the town centre.
      let nSights = 0;
      try {
        const all = I.placesFrom((await overpass(I.aroundQuery(geo.lat, geo.lon, 2500))).elements, geo.lat, geo.lon, P.km);
        const strip = x => { const o = Object.assign({}, x); delete o.d; delete o.g; return o; };
        places.ports[p.id] = { sights: all.filter(x => x.g === "sight").slice(0, 80).map(strip), practical: all.filter(x => x.g === "handy" || x.kind === "groceries").slice(0, 40).map(strip) };
        nSights = places.ports[p.id].sights.length;
      } catch (e) { places.ports[p.id] = { sights: [], practical: [] }; }
      // Ideas: notable places near the centre, from Wikipedia.
      try {
        const nb = I.notableFrom(((await getJSON(wikiURL(geo.lat, geo.lon, 4000, 40))).query || {}).pages, geo.lat, geo.lon, P.km);
        p.ideas = nb.slice(0, 8).map(n => ({ title: n.title, what: n.what.charAt(0).toUpperCase() + n.what.slice(1), time: "", q: n.title, lat: n.lat, lon: n.lon, url: n.url }));
      } catch (e) {}
      // Typical weather: days within a week of this date over the last five years.
      try {
        const y = new Date().getFullYear() - 1;
        const w = await getJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${geo.lat}&longitude=${geo.lon}&start_date=${y - 4}-01-01&end_date=${y}-12-31&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_gusts_10m_max&timezone=auto`);
        const cl = I.climateFrom(w.daily, p.days[0].date); if (cl) places.climate[p.id] = cl;
      } catch (e) {}
      ports.push(p);
      log(`✓ <b>${esc(p.name)}</b> — ${esc(geo.label)} · ${nSights} sights${p.ideas.length ? ", " + p.ideas.length + " ideas" : ""}${places.climate[p.id] ? ", typical weather" : ""}`, "good");
      if (i < groups.length - 1) await wait(1200);   // the free map services ask for a gentle pace
    }
    d.busy = false;
    if (missing.length || !ports.length) { log(missing.length ? "Fix the ports marked ✕ above, then tap the button again." : "Nothing to build.", "bad"); return; }
    // First and last days.
    const f = ports[0].days[0], last = ports[ports.length - 1];
    if (!f.note) f.note = "Embarkation day";
    last.disembark = true; const ld = last.days[last.days.length - 1]; if (!ld.note) ld.note = "Disembarkation day";
    const words = d.name.trim().split(/[\s:–-]+/).filter(Boolean);
    const short = d.name.trim().length <= 22 ? d.name.trim() : words.slice(0, 2).join(" ").length <= 22 ? words.slice(0, 2).join(" ") : words[0].slice(0, 22);
    const v = { id, name: d.name.trim(), short, dates: I.voyageDates(ports), ship: d.ship.trim(), imported: true,
      about: "Added from your itinerary on " + new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) + ".",
      timesKnown: ports.some(p => p.days.some(x => x.from || x.to)), ports, sources: [] };
    const entry = { voyage: v, places, countries };
    CRUISES = CRUISES.filter(c => c.voyage.id !== id).concat(entry);
    saveCruises();
    // Exchange rates for any new currency.
    const need = Object.values(COUNTRIES).map(c => c.currency).filter(c => I.RATED.includes(c) && !(state.rates && state.rates[c]));
    if (need.length) refreshRates(null, true);
    voyage = v; cur = P.currentPort(v.ports, now()); state.port = cur.port; state.filter = "all"; store.set("voyage", v.id);
    state.draft = null; toast(`${v.name} added — ${ports.length} ports.`);
    setMode("voyage");
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
  async function refreshRates(btn, quiet) {
    if (btn) { btn.textContent = "Updating…"; btn.disabled = true; }
    const want = [...new Set(["NOK", "GBP", "EUR", "CHF"].concat(Object.values(COUNTRIES).map(c => c.currency)))].filter(c => I.RATED.includes(c)).join(",");
    for (const u of [`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${want}`, `https://api.frankfurter.app/latest?from=USD&to=${want}`]) {
      try {
        const j = await (await fetch(u)).json();
        if (j.rates && j.rates.EUR) { state.rates = Object.assign({}, state.rates, { date: j.date }, j.rates); store.set("rates", state.rates); renderMoney(); return; }
      } catch (e) {}
    }
    if (!quiet) toast("No connection — using the saved rate.");
    renderMoney();
  }
  function renderMoney() {
    const p = state.port, co = COUNTRIES[p.country], cur = co.currency, r = state.rates;
    const conv = cur === "USD" ? `<p>Prices here are in <b>US dollars</b>.</p>`
      : !I.RATED.includes(cur) ? `<p>The European Central Bank's daily rates don't include the ${esc(co.currencyName)} (${esc(cur)}) — your bank's app or a card terminal shows today's rate.</p>`
      : r && r[cur] ? (() => {
      const a = +state.amount || 0;
      const out = state.dir === "local" ? P.fmtMoney(P.convert(a, cur, "USD", r), "USD") : P.fmtMoney(P.convert(a, "USD", cur, r), cur);
      const table = (r[cur] > 40 ? [500, 1000, 2000, 5000, 10000, 20000] : r[cur] > 4 ? [20, 50, 100, 200, 500, 1000] : [2, 5, 10, 20, 50, 100, 200])
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
      ${phrases ? `<h3>${({ NO: "Norwegian (and a little Sámi)", GB: "Words you'll hear", DE: "German", FR: "French", CH: "Swiss German" })[p.country] || co.language || "Phrases"}</h3>
      <ul class="phrases">${phrases}</ul>` : ""}
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
    const p = state.port, src = p.sources.concat(COUNTRIES[p.country].sources || [], voyage.sources || []);
    $("#foot").innerHTML = `<details><summary>Sources for ${esc(p.name)}</summary><ul>${src.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join("")}</ul></details>
      <p class="fine">Sights, coordinates and opening hours © OpenStreetMap contributors (ODbL)${PLACES.generated ? ", updated " + esc(PLACES.generated) : ""}. Weather: Open-Meteo.com (CC BY 4.0). Rates: European Central Bank via Frankfurter. Sun times calculated on your phone. Works offline once opened.</p>`;
  }

  function renderTabs() {
    const g = state.mode === "voyage";
    ["#ports", "#hero", "#tabs", "#foot"].forEach(s => $(s).hidden = !g);
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === state.tab));
    TABS.forEach(id => $("#" + id).hidden = !g || id !== state.tab);
    $("#around").hidden = state.mode !== "near"; $("#add").hidden = state.mode !== "add";
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => { state.tab = b.dataset.tab; store.set("tab", state.tab); renderTabs(); renderPanel(); });
  function renderPanel() { ({ walk: renderWalk, ideas: renderIdeas, day: renderDay, money: renderMoney })[state.tab](); }

  function render() {
    renderVoyages(); renderTabs();
    if (state.mode === "near") { renderAround(); if (state.me && !state.around) loadAround(); return; }
    if (state.mode === "add") { renderAdd(); return; }
    renderPorts(); renderHero(); renderWalk(); renderIdeas(); renderDay(); renderMoney(); renderFoot();
  }
  if (state.mode === "near") locate();
  render();
  setInterval(() => { if (state.mode === "voyage") renderHero(); }, 60e3);

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
