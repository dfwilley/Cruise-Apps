/* Port Pocket Guide — screens. Port facts: data/ports.js. Sights, hours, typical weather, saved rates: data/places.js. */
(function () {
  const P = window.Port, FACTS = window.PORT_FACTS, PLACES = window.PORT_PLACES || { ports: {}, climate: {} };
  const PORTS = FACTS.ports, COUNTRIES = FACTS.countries;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.port;

  // ?now=2027-02-04T10:00+01:00 previews the app as if it were that moment.
  const qs = new URLSearchParams(location.search);
  const fakeNow = qs.get("now") ? new Date(qs.get("now")) : null;
  const now = () => fakeNow || new Date();

  const store = {
    get(k, d) { try { const v = localStorage.getItem("ppg." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("ppg." + k, JSON.stringify(v)); } catch (e) {} }
  };

  const cur = P.currentPort(PORTS, now());
  const state = {
    port: (qs.get("port") && PORTS.find(p => p.id === qs.get("port"))) || cur.port,
    tab: qs.get("tab") || store.get("tab", "walk"),
    filter: "all",
    me: null,           // { lat, lon, at }
    rates: store.get("rates", null) || PLACES.rates || null,
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

  // ---- Port chips --------------------------------------------------------------------------------------------
  function renderPorts() {
    $("#ports").innerHTML = PORTS.map(p => {
      const c = P.portCall(p), [Y, M, D] = p.days[0].date.split("-").map(Number);
      const here = cur.port === p && cur.state === "in";
      return `<button class="chip${p === state.port ? " on" : ""}" data-port="${p.id}" aria-pressed="${p === state.port}">
        <b>${esc(p.name.replace(/ \(.*\)/, ""))}</b><span>${["Jan", "Feb"][M - 1]} ${D}${p.days.length > 1 ? "–" + p.days[p.days.length - 1].date.slice(8).replace(/^0/, "") : ""}${here ? " · here" : ""}</span></button>`;
    }).join("");
    $("#ports").querySelectorAll("button").forEach(b => b.onclick = () => { state.port = PORTS.find(p => p.id === b.dataset.port); state.me = null; render(); window.scrollTo(0, 0); });
    const on = $("#ports .on"); if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "center" });
  }

  // ---- Hero: time in port ------------------------------------------------------------------------------------
  function renderHero() {
    const p = state.port, c = P.portCall(p), t = now();
    const dayTxt = p.days.map(d => P.dayLabel(d.date)).join(" – ");
    let status = "";
    if (c.disembark) status = t < c.arrive ? `Arrive ${P.fmt12(c.arrive, p.tz)} · disembarkation day` : "Disembarkation day";
    else if (t < c.arrive) {
      const days = Math.ceil((c.arrive - t) / 864e5);
      status = days > 1 ? `In ${days} days` : `Arriving in ${P.fmtMin(Math.round((c.arrive - t) / 60e3))}`;
    } else if (t < c.allAboard) status = `<strong>All aboard in ${P.fmtMin(Math.round((c.allAboard - t) / 60e3))}</strong>`;
    else if (t < c.depart) status = "<strong>All aboard now</strong>";
    else status = "Sailed";
    const times = c.disembark
      ? `<div><span>Arrive</span><b>${P.fmt12(c.arrive, p.tz)}</b></div><div><span>Ashore</span><b>Final day</b></div>`
      : `<div><span>Arrive</span><b>${P.fmt12(c.arrive, p.tz)}</b>${c.overnight ? `<i>${P.dayLabel(p.days[0].date).split(",")[0]}</i>` : ""}</div>
         <div class="aboard"><span>All aboard</span><b>${P.fmt12(c.allAboard, p.tz)}</b>${c.overnight ? `<i>${P.dayLabel(p.days[p.days.length - 1].date).split(",")[0]}</i>` : ""}</div>
         <div><span>Sail</span><b>${P.fmt12(c.depart, p.tz)}</b></div>`;
    const alertBtn = native && !c.disembark && t < c.allAboard ? `<button id="remind" class="ghost">⏰ Remind me 1 hour before all aboard</button>` : "";
    $("#hero").innerHTML = `
      <h2>${esc(p.name)}</h2>
      <p class="sub">${esc(dayTxt)} · ${esc(COUNTRIES[p.country].name)} · local time ${p.tz ? "UTC+1" : "UTC"}${p.tz ? " (Arizona +8 h)" : " (Arizona +7 h)"}</p>
      <div class="times">${times}</div>
      <p class="status">${status}</p>
      <p class="fine">All aboard is assumed 30 minutes before sailing — Viking's daily program has the exact time.</p>
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
    const from = day.from ? day.from : "08:00", to = day.to ? day.to : "23:59";
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
      <div class="row"><button id="locate" class="ghost">📍 ${state.me ? "Update my location" : "Use my location"}</button>
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
    const b = $("#locate"); if (b) { b.textContent = "📍 Finding you…"; b.disabled = true; }
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
    renderWalk();
    if (d > 40) toast(`You're ${Math.round(d / 1.609)} miles from ${p.name} — distances are from where you are now.`);
  }
  function gotError(msg) { toast(msg); renderWalk(); }
  window.__portNative = m => {
    if (m.type === "location") gotLocation(m.lat, m.lon);
    else if (m.type === "error") gotError(m.message);
  };
  function toast(msg) {
    let t = $("#toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.className = "show"; clearTimeout(t._h); t._h = setTimeout(() => t.className = "", 5000);
  }

  // ---- Hours, weather & daylight ----------------------------------------------------------------------------
  function dayBar(p, d, ev) {
    const pct = date => { const lp = P.localParts(date, p.tz); return ((lp.h * 60 + lp.mi) / 1440 * 100).toFixed(2); };
    let seg = "";
    if (!ev.civil.never && !ev.civil.always) seg += `<i class="tw" style="left:${pct(ev.civil.rise)}%;width:${pct(ev.civil.set) - pct(ev.civil.rise)}%"></i>`;
    if (!ev.sun.never && !ev.sun.always) seg += `<i class="sun" style="left:${pct(ev.sun.rise)}%;width:${pct(ev.sun.set) - pct(ev.sun.rise)}%"></i>`;
    const [a, b] = [d.from ? d.from : "00:00", d.to ? d.to : "24:00"].map(s => (+s.split(":")[0] * 60 + +s.split(":")[1]) / 14.4);
    seg += `<i class="ship" style="left:${a}%;width:${b - a}%"></i>`;
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
      const sunday = P.dowOf(d.date) === 0;
      const sunTxt = ev.sun.never ? "The sun stays below the horizon" : ev.sun.always ? "The sun doesn't set" :
        `Sunrise <b>${P.fmt12(ev.sun.rise, p.tz)}</b> · sunset <b>${P.fmt12(ev.sun.set, p.tz)}</b> · ${Math.floor(dl / 60)} h ${dl % 60} min of daylight`;
      const tw = ev.civil.rise && ev.civil.set ? `Usable light (civil twilight) ${P.fmt12(ev.civil.rise, p.tz)} – ${P.fmt12(ev.civil.set, p.tz)}. The sun climbs only ${Math.max(0, ev.noonAlt).toFixed(0)}° at noon.` : "";
      const ship = d.from && d.to ? `Ship in ${d.from}–${d.to}` : d.from ? `Ship arrives ${d.from}` : `Ship sails ${d.to}`;
      return `<article class="dayc">
        <h4>${P.dayLabel(d.date)}${sunday && p.country === "NO" ? ` <span class="pill">Shops closed</span>` : ""}</h4>
        <p>${sunTxt}</p>${dayBar(p, d, ev)}
        <p class="fine">${tw} <span class="key"><i class="k sun"></i>sun up <i class="k tw"></i>twilight <i class="k ship"></i>${ship}</span></p>
        ${sunday && p.country === "NO" ? `<p class="callout warn"><b>Sunday:</b> ${esc(co.sunday)}</p>` : ""}
      </article>`;
    }).join("");
    $("#day").innerHTML = `
      ${days}
      <h3>Typical weather these days</h3>
      ${weatherCard(p)}
      ${forecastRows(p)}
      <h3>What to wear</h3><p>${esc(co.winter)}</p>
      <h3>Shop hours</h3><p>${esc(co.hours)}${p.country === "NO" ? " " + esc(co.sunday) : ""}</p>
      <p class="fine">Museum and shop hours under Sights come from OpenStreetMap and can be out of date in winter — check a place's website before a long walk.</p>`;
    loadForecast(p);
  }

  // ---- Money & phrases --------------------------------------------------------------------------------------
  async function refreshRates(btn) {
    if (btn) { btn.textContent = "Updating…"; btn.disabled = true; }
    for (const u of ["https://api.frankfurter.dev/v1/latest?base=USD&symbols=NOK,GBP", "https://api.frankfurter.app/latest?from=USD&to=NOK,GBP"]) {
      try {
        const j = await (await fetch(u)).json();
        if (j.rates && j.rates.NOK) { state.rates = { date: j.date, NOK: j.rates.NOK, GBP: j.rates.GBP }; store.set("rates", state.rates); renderMoney(); return; }
      } catch (e) {}
    }
    toast("No connection — using the saved rate.");
    renderMoney();
  }
  function renderMoney() {
    const p = state.port, co = COUNTRIES[p.country], cur = co.currency, r = state.rates;
    const conv = r ? (() => {
      const a = +state.amount || 0;
      const out = state.dir === "local" ? P.fmtMoney(P.convert(a, cur, "USD", r), "USD") : P.fmtMoney(P.convert(a, "USD", cur, r), cur);
      const table = (cur === "NOK" ? [20, 50, 100, 200, 500, 1000] : [5, 10, 20, 50, 100, 200])
        .map(v => `<tr><td>${P.fmtMoney(v, cur)}</td><td>${P.fmtMoney(P.convert(v, cur, "USD", r), "USD")}</td></tr>`).join("");
      return `<div class="conv">
        <label><span>${state.dir === "local" ? esc(co.currency === "NOK" ? "Norwegian kroner" : co.currencyName + "s") : "US dollars"}</span>
          <input id="amt" type="text" inputmode="decimal" value="${esc(state.amount)}" aria-label="Amount"></label>
        <button id="swap" class="ghost" aria-label="Swap currencies">⇅</button>
        <div class="res"><span>${state.dir === "local" ? "US dollars" : esc(co.currency === "NOK" ? "Norwegian kroner" : co.currencyName + "s")}</span><b id="res">${out}</b></div>
      </div>
      <p class="fine">$1 = ${cur === "NOK" ? r.NOK.toFixed(2) + " kr" : "£" + r.GBP.toFixed(3)} · ECB rate of ${esc(r.date)} · your card's rate will differ slightly.
        <button id="rates" class="link">Update rate</button></p>
      <table class="quick"><tbody>${table}</tbody></table>`;
    })() : `<p>No saved rate yet. <button id="rates" class="ghost">Get today's rate</button></p>`;
    const speak = native || "speechSynthesis" in window;
    const phrases = co.phrases.map((x, i) => `<li><div><b>${esc(x.local)}</b> <span class="say">${esc(x.say)}</span><small>${esc(x.en)}${x.note ? " · " + esc(x.note) : ""}</small></div>
      ${speak && x.lang !== "en-GB" ? `<button class="spk" data-i="${i}" aria-label="Say ${esc(x.local)}">🔊</button>` : ""}</li>`).join("");
    $("#money").innerHTML = `
      <h3>Money</h3>${conv}
      <p>${esc(co.money)}</p>
      <h3>Tipping</h3><p>${esc(co.tipping)}</p>
      <h3>${p.country === "NO" ? "Norwegian (and a little Sámi)" : "Words you'll hear"}</h3>
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
    const p = state.port, src = p.sources.concat(COUNTRIES[p.country].sources);
    $("#foot").innerHTML = `<details><summary>Sources for ${esc(p.name)}</summary><ul>${src.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join("")}</ul></details>
      <p class="fine">Sights, coordinates and opening hours © OpenStreetMap contributors (ODbL)${PLACES.generated ? ", updated " + esc(PLACES.generated) : ""}. Weather: Open-Meteo.com (CC BY 4.0). Rates: European Central Bank via Frankfurter. Sun times calculated on your phone. Works offline once opened.</p>`;
  }

  function renderTabs() {
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === state.tab));
    ["walk", "day", "money"].forEach(id => $("#" + id).hidden = id !== state.tab);
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => { state.tab = b.dataset.tab; store.set("tab", state.tab); renderTabs(); renderPanel(); });
  function renderPanel() { ({ walk: renderWalk, day: renderDay, money: renderMoney })[state.tab](); }

  function render() { renderPorts(); renderHero(); renderTabs(); renderWalk(); renderDay(); renderMoney(); renderFoot(); }
  render();
  setInterval(renderHero, 60e3);

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
