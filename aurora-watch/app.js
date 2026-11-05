/* Arctic Night — screens. Runs as a web page and inside the native iPhone app (which adds alerts, GPS and background checks). */
(() => {
"use strict";
const A = window.Arctic, $ = (id) => document.getElementById(id), HOUR = A.HOUR;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- Clock (a ?now=2027-01-30T21:00Z link previews the trip) ---------- */
const nowParam = new URLSearchParams(location.search).get("now");
const offset = nowParam && Number.isFinite(Date.parse(nowParam)) ? Date.parse(nowParam) - Date.now() : 0;
const NOW = () => Date.now() + offset;

/* ---------- Native bridge (present only inside the iPhone app) ---------- */
const nativeH = window.webkit?.messageHandlers?.arctic;
const isNative = !!nativeH;
let reqId = 0; const pending = {};
window.__arcticReply = (id, ok, payload) => { const p = pending[id]; if (!p) return; delete pending[id]; ok ? p.res(payload) : p.rej(new Error(payload || "failed")); };
const native = (cmd, args = {}) => new Promise((res, rej) => { const id = ++reqId; pending[id] = { res, rej }; nativeH.postMessage({ id, cmd, ...args }); setTimeout(() => { if (pending[id]) { delete pending[id]; rej(new Error("timeout")); } }, 30000); });

/* ---------- Settings ---------- */
const SKEY = "arctic-settings-v1";
const S = Object.assign({ mode: "auto", red: "auto", alerts: true, minLevel: "Good", liveAlerts: true, liveMin: 30, quiet: false, here: null }, JSON.parse(localStorage.getItem(SKEY) || "{}"));
const save = () => { try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch {} };

/* ---------- Data, cached so it still works with spotty ship Wi-Fi ---------- */
async function getText(url, maxAgeMin) {
  const key = "arctic-cache:" + url.split("?")[0] + (url.includes("open-meteo") ? ":" + url.length : "");
  let cached = null; try { cached = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
  if (cached && Date.now() - cached.t < maxAgeMin * 60e3) return { text: cached.body, t: cached.t, fresh: true };
  try {
    const body = isNative ? await native("fetch", { url }) : await (await fetch(url, { cache: "no-store" })).text();
    if (!body || body.length < 20) throw new Error("empty");
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), body })); } catch { /* the big aurora map may not fit; fine */ }
    return { text: body, t: Date.now(), fresh: true };
  } catch (e) {
    if (cached) return { text: cached.body, t: cached.t, fresh: false };
    return null;
  }
}
const D = { kp: null, outlook: null, ovation: null, bz: null, clouds: null, times: {} };
let loading = false, lastLoad = 0;
async function loadAll(force) {
  if (loading) return; loading = true;
  const where = forecastWhere();
  const pts = where.kind === "voyage" ? A.voyageCloudPoints() : where.lat != null ? [{ lat: where.lat, lon: where.lon }] : [];
  const jobs = [
    getText(A.SOURCES.kp, force ? 0 : 30).then((r) => { if (r) { D.kp = A.parseKpForecast(JSON.parse(r.text)); D.times.kp = r; } }),
    getText(A.SOURCES.outlook, force ? 0 : 360).then((r) => { if (r) { D.outlook = A.parse27Day(r.text); D.times.outlook = r; } }),
    getText(A.SOURCES.ovation, force ? 0 : 5).then((r) => { if (r) { D.ovation = A.parseOvation(JSON.parse(r.text)); D.times.ovation = r; } }),
    getText(A.SOURCES.mag, force ? 0 : 5).then((r) => { if (r) { D.bz = A.parseBz(JSON.parse(r.text)); D.times.mag = r; } }),
    pts.length ? getText(A.cloudURL(pts), force ? 0 : 60).then((r) => { if (r) { D.clouds = A.parseClouds(JSON.parse(r.text)); D.times.clouds = r; } }) : Promise.resolve(),
  ].map((p) => p.catch((e) => console.warn("data:", e)));
  await Promise.all(jobs);
  loading = false; lastLoad = Date.now();
  render(); scheduleAlerts();
}

/* ---------- Where are we forecasting? ---------- */
function inVoyage(t) { return t >= A.VOYAGE.startT - 12 * HOUR && t <= A.VOYAGE.endT + 6 * HOUR; }
function forecastWhere() {
  const t = NOW();
  const mode = S.mode === "auto" ? (inVoyage(t) ? "voyage" : "here") : S.mode;
  if (mode === "voyage") {
    const ship = A.shipAt(Math.max(A.VOYAGE.startT, Math.min(t, A.VOYAGE.endT)));
    return { kind: "voyage", lat: ship.lat, lon: ship.lon, tz: ship.tz, place: inVoyage(t) ? ship.place : "Voyage preview · starts January 30, 2027 in Tromsø" };
  }
  if (S.here) return { kind: "here", lat: S.here.lat, lon: S.here.lon, tz: -new Date().getTimezoneOffset() / 60, place: "Your location" };
  return { kind: "here", lat: null, lon: null, tz: -new Date().getTimezoneOffset() / 60, place: "Your location (not shared yet)" };
}
async function locate() {
  try {
    const p = isNative ? await native("location") : await new Promise((res, rej) => navigator.geolocation.getCurrentPosition((g) => res({ lat: g.coords.latitude, lon: g.coords.longitude }), rej, { timeout: 15000, maximumAge: 600000 }));
    S.here = { lat: +p.lat, lon: +p.lon, t: Date.now() }; save(); return true;
  } catch { toast("Couldn't get your location. Check that location is allowed for this app."); return false; }
}

/* ---------- Render ---------- */
const lvClass = (l) => "lv-" + l.split(" ")[0];
function nightAt(where) {
  const t = NOW();
  if (where.kind === "voyage") {
    const nights = A.voyageNights(D);
    const local = new Date(t + where.tz * HOUR - 8 * HOUR).toISOString().slice(0, 10); // before 8 AM counts as last night
    return { nights, tonight: nights.find((n) => n.date === local) || nights[0] };
  }
  if (where.lat == null) return { nights: A.voyageNights(D), tonight: null };
  const local = new Date(t + where.tz * HOUR - 8 * HOUR).toISOString().slice(0, 10);
  const here = () => ({ lat: where.lat, lon: where.lon, tz: where.tz, place: "Your location" });
  return { nights: A.voyageNights(D), tonight: A.scoreNight(local, here, D) };
}
function barsHTML(n) {
  if (!n || !n.hours.length) return "";
  const hs = n.hours;
  const bars = hs.map((h) => { const s = h.score ?? 0, cls = s >= 0.45 ? "g" : s >= 0.2 ? "f" : "p"; return `<span class="${h.score == null ? "" : cls}" style="height:${Math.max(4, Math.round((h.score ?? 0.05) * 100))}%" title="${A.fmtTime(h.t, n.tz)}"></span>`; }).join("");
  return `<div class="bars" aria-hidden="true">${bars}</div><div class="barlab"><span>${A.fmtTime(hs[0].t, n.tz)}</span><span>dark hours, ship time</span><span>${A.fmtTime(hs[hs.length - 1].t, n.tz)}</span></div>`;
}
function render() {
  const where = forecastWhere();
  $("where").textContent = where.place + (where.kind === "voyage" && inVoyage(NOW()) ? ` · ${A.VOYAGE.ship}` : "");
  const { nights, tonight } = nightAt(where);

  // Tonight
  if (!tonight) {
    $("tonight").innerHTML = `<p class="kicker">Tonight</p><div class="level lv-Too">Where are you?</div>
      <p class="best">Share your location to see tonight's outlook where you are — or switch to <b>Voyage</b> below to preview the cruise.</p>
      <button class="btn primary" id="locBtn">Use my location</button>`;
    $("locBtn").onclick = async () => { if (await locate()) loadAll(true); };
  } else {
    const t = tonight;
    const best = t.best ? `Best around <b>${A.fmtTime(t.best, t.tz)}</b>${where.kind === "voyage" ? " ship time" : ""}` : t.darkHours ? "Watch the northern sky once it's fully dark" : "Not dark enough tonight";
    $("tonight").innerHTML = `<p class="kicker">Tonight · ${A.fmtDate(t.date)}${where.kind === "voyage" ? " · " + esc(t.place) : ""}</p>
      <div class="level ${lvClass(t.level)}">${t.level === "Too early" ? "Too early to tell" : t.level + " chance"}</div>
      <p class="best">${best}</p>${barsHTML(t)}
      <ul class="reasons">${t.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`;
  }

  // Now
  const L = where.lat != null ? A.liveCheck(NOW(), where.lat, where.lon, D) : null;
  const age = D.times.ovation ? Math.round((Date.now() - D.times.ovation.t) / 60000) : null;
  if (!L) $("now").innerHTML = `<p class="kicker">Right now</p><p class="best">Needs a location.</p>`;
  else {
    const cloudTxt = L.cloud == null ? "—" : Math.round(L.cloud * 100) + "%";
    $("now").innerHTML = `${L.look ? `<div class="lookbanner">Aurora likely now — go look north</div>` : ""}
      <p class="kicker">Right now</p>
      <div class="stats">
        <div class="stat"><b>${L.prob == null ? "—" : L.prob + "%"}</b><span>Chance nearby</span></div>
        <div class="stat"><b>${L.kp == null ? "—" : L.kp.toFixed(1)}</b><span>Kp</span></div>
        <div class="stat"><b>${cloudTxt}</b><span>Clouds</span></div>
        <div class="stat"><b>${L.dark ? "Dark" : L.sunAlt > 0 ? "Day" : "Twilight"}</b><span>Sky</span></div>
      </div>
      <p class="note">${L.bz == null ? "" : `Solar wind Bz ${L.bz.toFixed(1)} nT — ${L.bz < -3 ? "southward, which helps aurora" : L.bz > 3 ? "northward, which suppresses aurora" : "near neutral"}. `}${age == null ? "No live data yet." : `Live map updated ${age < 1 ? "just now" : age + " min ago"}${D.times.ovation.fresh ? "" : " (offline — showing the last saved data)"}.`}</p>
      <div class="row2"><span>${isNative ? "Alerts run on this phone." : "Web version: no alerts. The iPhone app can wake you."}</span><button class="btn" id="refresh">Refresh</button></div>`;
    $("refresh").onclick = () => { toast("Updating…"); loadAll(true); };
  }

  // Voyage
  const fc = nights.filter((n) => n.kpSource === "forecast").length, ol = nights.filter((n) => n.kpSource === "outlook").length;
  $("voyageSub").textContent = `${A.VOYAGE.ship} · Tromsø to London (Tilbury), January 30 – February 11, 2027. ` +
    (fc ? `${fc} night${fc > 1 ? "s" : ""} with NOAA's 3-day forecast. ` : "") + (ol ? `${ol} from the 27-day outlook (rough). ` : "") + (!fc && !ol ? "Aurora forecasts begin about 4 weeks before each night. " : "") + "Tap a night for details.";
  const todayDate = tonight && where.kind === "voyage" ? tonight.date : null;
  $("voyage").innerHTML = nights.map((n, i) => `<button class="night ${n.date === todayDate ? "today" : ""}" data-i="${i}" aria-expanded="false">
      <div class="l1"><span class="d">${A.fmtDate(n.date)}</span><span class="chip ${lvClass(n.level)}">${n.level}</span></div>
      <div class="p">${esc(n.place)}</div>
      <div class="m"><span>🌙 ${Math.round(n.moon * 100)}% lit</span><span>${n.darkHours} dark hours</span><span>${n.avgCloud == null ? "Clouds: not yet" : "Clouds " + Math.round(n.avgCloud * 100) + "%"}</span><span>${n.maxKp == null ? "Kp: not yet" : "Kp " + n.maxKp.toFixed(n.maxKp % 1 ? 1 : 0) + (n.kpSource === "outlook" ? " (outlook)" : "")}</span></div>
      <div class="more" hidden>${n.best ? `<p class="best">Best around <b>${A.fmtTime(n.best, n.tz)}</b> ship time</p>` : ""}${barsHTML(n)}<ul class="reasons">${n.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>
    </button>`).join("");
  $("voyage").querySelectorAll(".night").forEach((b) => b.onclick = () => { const m = b.querySelector(".more"); m.hidden = !m.hidden; b.setAttribute("aria-expanded", String(!m.hidden)); });

  // Settings
  document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === S.mode)));
  document.querySelectorAll("[data-red]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.red === S.red)));
  renderAlerts();
  applyRed(where);
  const src = (k, label) => D.times[k] ? `${label} ${Math.round((Date.now() - D.times[k].t) / 60000)} min ago` : `${label} —`;
  $("foot").innerHTML = `Data: <a href="https://www.swpc.noaa.gov/">NOAA Space Weather Prediction Center</a> (${src("kp", "Kp")}, ${src("ovation", "live map")}) · <a href="https://open-meteo.com/">Open-Meteo</a> clouds (${src("clouds", "updated")}). Moon and sun calculated on this phone.${offset ? " · Preview time: " + new Date(NOW()).toISOString().slice(0, 16) + "Z" : ""}`;
}
function renderAlerts() {
  const box = $("alertBody");
  if (!isNative) { box.innerHTML = `<p class="note">Alerts need the Arctic Night iPhone app: it schedules them on the phone so they go off even when the ship's Wi-Fi drops. This web version shows the same forecasts.</p>`; return; }
  box.innerHTML = `<label class="check"><input type="checkbox" id="alOn" ${S.alerts ? "checked" : ""}> Alert me before a promising night's best time</label>
    <label class="check">Level <select id="alLvl"><option ${S.minLevel === "Good" ? "selected" : ""}>Good</option><option value="Fair" ${S.minLevel === "Fair" ? "selected" : ""}>Fair or better</option></select></label>
    <label class="check"><input type="checkbox" id="lvOn" ${S.liveAlerts ? "checked" : ""}> "Look now" alerts when NOAA's live map lights up nearby</label>
    <label class="check"><input type="checkbox" id="qOn" ${S.quiet ? "checked" : ""}> Only Good nights between midnight and 6 AM</label>
    <p class="note">Planned alerts use NOAA's 3-day forecast and are set on this phone. "Look now" checks run in the background when iOS allows (it decides how often), so they're a bonus, not a guarantee.</p>
    <button class="btn" id="alTest">Send a test alert</button>`;
  $("alOn").onchange = (e) => { S.alerts = e.target.checked; save(); scheduleAlerts(); };
  $("alLvl").onchange = (e) => { S.minLevel = e.target.value; save(); scheduleAlerts(); };
  $("lvOn").onchange = (e) => { S.liveAlerts = e.target.checked; save(); scheduleAlerts(); };
  $("qOn").onchange = (e) => { S.quiet = e.target.checked; save(); scheduleAlerts(); };
  $("alTest").onclick = () => native("test").then(() => toast("Test alert in 5 seconds — lock the phone to see it.")).catch(() => toast("Alerts aren't allowed. Turn them on in Settings › Arctic Night › Notifications."));
}
function scheduleAlerts() {
  if (!isNative) return;
  const nights = A.voyageNights(D);
  const where = forecastWhere();
  let list = [];
  if (S.alerts) {
    list = A.plannedAlerts(nights, { minLevel: S.minLevel, quietStart: S.quiet ? 0 : null, quietEnd: S.quiet ? 6 : null }, NOW());
    if (where.kind === "here" && where.lat != null) {
      const { tonight } = nightAt(where);
      if (tonight) list = list.concat(A.plannedAlerts([{ ...tonight, place: "Your location" }], { minLevel: S.minLevel }, NOW()));
    }
  }
  const waypoints = A.VOYAGE.stops.flatMap((s) => [{ t: s.arriveT, lat: s.lat, lon: s.lon }, { t: s.departT, lat: s.lat, lon: s.lon }]);
  native("schedule", { alerts: list, live: { enabled: S.liveAlerts, minProb: S.liveMin, waypoints, here: S.here, ovationURL: A.SOURCES.ovation } }).catch(() => {});
}

/* ---------- Red night-vision mode ---------- */
function applyRed(where) {
  let on = S.red === "on";
  if (S.red === "auto") {
    // During the cruise use the ship's sky; otherwise your own (or your clock if location isn't shared).
    const p = inVoyage(NOW()) && where.kind === "voyage" ? where : S.here;
    if (p && p.lat != null) on = A.sunAltitude(NOW(), p.lat, p.lon) < -6;
    else { const h = new Date(NOW()).getHours(); on = h >= 19 || h < 6; }
  }
  document.documentElement.classList.toggle("red", on);
  $("redBtn").setAttribute("aria-pressed", String(on));
}
$("redBtn").onclick = () => { S.red = document.documentElement.classList.contains("red") ? "off" : "on"; save(); render(); };
document.querySelectorAll("[data-red]").forEach((b) => b.onclick = () => { S.red = b.dataset.red; save(); render(); });
document.querySelectorAll("[data-mode]").forEach((b) => b.onclick = async () => {
  S.mode = b.dataset.mode; save();
  if (S.mode === "here" && !S.here) await locate();
  render(); loadAll(false);
});

let toastT;
function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2800); }

/* ---------- Start ---------- */
render();
loadAll(false);
setInterval(() => { if (!document.hidden && Date.now() - lastLoad > 5 * 60e3) loadAll(false); else render(); }, 60e3);
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadAll(false); });
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
window.__arctic = { D, S, render, loadAll, isNative };
})();
