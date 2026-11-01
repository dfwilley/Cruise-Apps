/* Fjord Spotter — screens. Runs as a web page and inside the native iPhone app
   (which supplies GPS, a true-north compass and the camera natively). */
(() => {
"use strict";
const F = window.Fjord, $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ITEMS = (window.FJORD_LANDMARKS && window.FJORD_LANDMARKS.items) || [];
const V = F.makeVoyage(window.FJORD_ROUTE);
const ICON = { peak: "⛰", glacier: "🧊", city: "🏙", town: "🏘", village: "🏠", lighthouse: "💡", light: "✦", fjord: "🌊", strait: "🌊", bay: "🌊", island: "🏝", cape: "▸", wreck: "⚓" };

/* ---------- Native bridge ---------- */
const nativeH = window.webkit?.messageHandlers?.fjord;
const isNative = !!nativeH;
const toNative = (m) => { try { nativeH && nativeH.postMessage(m); } catch {} };

/* ---------- Settings ---------- */
const SKEY = "fjord-settings-v1";
const defaultPreview = Math.round((Date.parse("2027-02-05T09:30:00Z") - V.start) / (V.end - V.start) * 1000);
const S = Object.assign({ source: "auto", red: "auto", align: 0, preview: defaultPreview }, JSON.parse(localStorage.getItem(SKEY) || "{}"));
const save = () => { try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch {} };
const nowParam = new URLSearchParams(location.search).get("now");
const tOffset = nowParam && Number.isFinite(Date.parse(nowParam)) ? Date.parse(nowParam) - Date.now() : 0;
const NOW = () => Date.now() + tOffset;

/* ---------- Position: GPS, or the ship's plan ---------- */
let gps = null, lastFix = null;
function onFix(lat, lon, courseDeg, speedMs, acc) {
  const p = { lat, lon, t: Date.now(), acc };
  let course = courseDeg != null && courseDeg >= 0 && speedMs > 1 ? courseDeg : null;
  if (course == null && lastFix && F.distanceKm(lastFix, p) > 0.1) course = F.bearing(lastFix, p);
  if (!lastFix || F.distanceKm(lastFix, p) > 0.1) lastFix = p;
  gps = { lat, lon, course: course ?? gps?.course ?? null, speedKn: speedMs != null && speedMs >= 0 ? speedMs * 1.944 : null, t: Date.now(), acc };
  schedule();
}
function startGPS() {
  if (isNative) return toNative({ cmd: "start" });
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition((g) => onFix(g.coords.latitude, g.coords.longitude, g.coords.heading, g.coords.speed, g.coords.accuracy), () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}
function planTime() {
  const t = NOW();
  if (t >= V.start && t <= V.end && S.source !== "plan") return t;
  if (S.source === "plan" || t < V.start || t > V.end) return V.start + (S.preview / 1000) * (V.end - V.start);
  return t;
}
function position() {
  const fresh = gps && Date.now() - gps.t < 120e3;
  if (S.source === "gps" || (S.source === "auto" && fresh)) {
    if (fresh) return { lat: gps.lat, lon: gps.lon, course: gps.course, speedKn: gps.speedKn, label: "GPS", place: "From your GPS" };
    if (S.source === "gps") return null;
  }
  const t = planTime(), p = V.at(t);
  if (!p) return null;
  const preview = !(NOW() >= V.start && NOW() <= V.end);
  return { ...p, label: preview ? "Preview" : "Ship's plan", place: p.place, t, preview };
}

/* ---------- Compass ---------- */
let rawHeading = null, headingSrc = null;
function onHeading(h, src) { if (h == null || isNaN(h)) return; rawHeading = h; headingSrc = src; schedule(); }
const heading = () => rawHeading == null ? null : F.norm(rawHeading + (headingSrc === "native" ? 0 : 0) + S.align);
async function startCompass() {
  if (isNative) { toNative({ cmd: "start" }); return true; }
  try {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      const r = await DeviceOrientationEvent.requestPermission(); if (r !== "granted") throw new Error("denied");
    }
  } catch { toast("Compass permission wasn't given."); return false; }
  window.addEventListener("deviceorientation", (e) => { if (e.webkitCompassHeading != null) onHeading(e.webkitCompassHeading, "web"); });
  window.addEventListener("deviceorientationabsolute", (e) => { if (e.alpha != null) onHeading(F.norm(360 - e.alpha), "web"); });
  setTimeout(() => { if (rawHeading == null) { $("manual").hidden = false; toast("No compass on this device — use the slider."); } }, 2500);
  return true;
}
$("compassBtn").onclick = async () => { if (await startCompass()) { $("compassBtn").textContent = "Compass on"; $("compassBtn").classList.add("on"); } };
$("hdgSlider").oninput = (e) => onHeading(+e.target.value, "manual");

/* ---------- Camera ---------- */
let camOn = false, camStream = null;
async function setCamera(on) {
  if (on && !isNative) {
    try { camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }); $("cam").srcObject = camStream; $("cam").hidden = false; }
    catch { toast("Couldn't open the camera."); return; }
  }
  if (!on && camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; $("cam").hidden = true; }
  if (isNative) toNative({ cmd: "camera", on });
  camOn = on;
  document.body.classList.toggle("camera", on); document.documentElement.classList.toggle("cameraon", on);
  $("camBtn").classList.toggle("on", on); $("camBtn").textContent = on ? "Camera off" : "Camera view";
  $("overlay").hidden = !on;
  let ch = document.querySelector(".crosshair"); if (on && !ch) { ch = document.createElement("div"); ch.className = "crosshair"; document.body.appendChild(ch); } else if (!on && ch) ch.remove();
  if (on && rawHeading == null) startCompass();
  render();
}
$("camBtn").onclick = () => setCamera(!camOn);

/* ---------- Views ---------- */
let view = "look";
document.querySelectorAll(".tabs button").forEach((b) => b.onclick = () => {
  view = b.dataset.v; if (view !== "look" && camOn) setCamera(false);
  document.querySelectorAll(".view").forEach((s) => s.hidden = s.id !== "v-" + view);
  document.querySelectorAll(".tabs button").forEach((x) => x.toggleAttribute("aria-current", x === b) || x.removeAttribute("aria-current"));
  document.querySelectorAll(".tabs button").forEach((x) => x === b ? x.setAttribute("aria-current", "page") : x.removeAttribute("aria-current"));
  window.scrollTo(0, 0); render();
});
let pendingR = false;
function schedule() { if (pendingR) return; pendingR = true; requestAnimationFrame(() => { pendingR = false; render(); }); }

function itemHTML(x, extra = "") {
  return `<div class="item"><div class="ic" aria-hidden="true">${ICON[x.it.k] || "•"}</div><div class="t"><div class="n">${esc(F.title(x.it))}</div><div class="d">${esc(F.detail(x))}</div>${extra}</div>${x.clock ? `<div class="clock">${x.clock}:00</div>` : ""}</div>`;
}
function render() {
  const pos = position(), h = heading();
  $("where").textContent = !ITEMS.length ? "Landmark data missing" : pos ? `${pos.label} · ${pos.place}${pos.preview ? " · " + fmtWhen(pos.t, pos.tz) : ""}` : "Waiting for GPS…";
  applyRed(pos);
  if (view === "look") renderLook(pos, h);
  if (view === "sides") renderSides(pos);
  if (view === "lights") renderLights(pos, h);
  if (view === "more") renderMore(pos);
}
function fmtWhen(t, tz) { const d = new Date(t + (tz || 0) * 3600e3); return d.toLocaleString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ship time"; }

function renderLook(pos, h) {
  $("hdg").innerHTML = h == null ? `Turn on the compass, then hold the phone up and point it at the coast.` : `<b>${Math.round(h)}°</b>${F.compass16(h)} · pointing ${headingSrc === "manual" ? "(set by hand)" : ""}`;
  if (!pos) { $("lookList").innerHTML = `<p class="empty">Waiting for a position…</p>`; $("overlay").innerHTML = ""; return; }
  if (h == null) {
    const all = F.visible(pos, pos.course, ITEMS).sort((a, b) => b.score - a.score).slice(0, 8);
    $("lookList").innerHTML = `<p class="sub" style="margin:4px 0 8px">Most notable landmarks in sight now:</p>` + (all.map((x) => itemHTML(x)).join("") || `<p class="empty">Nothing named in sight here.</p>`);
    return;
  }
  if (camOn) {
    const labels = F.cameraLabels(pos, h, ITEMS, 50);
    $("overlay").innerHTML = labels.map((x) => `<div class="lbl" style="left:${(x.x * 100).toFixed(1)}%;top:${x.row * 54}px"><div class="tag">${esc(x.it.n)}<small>${esc((F.KIND[x.it.k] || "") + (x.it.e && x.it.k === "peak" ? " · " + F.fmtFt(x.it.e) : "") + " · " + F.fmtNm(x.d))}</small></div><div class="stem" style="height:${Math.max(10, 120 - x.row * 54)}px"></div></div>`).join("");
    $("lookList").innerHTML = labels.length ? "" : `<p class="empty">Nothing named in that direction. Turn slowly.</p>`;
    return;
  }
  const p = F.pointing(pos, h, ITEMS, 24);
  if (!p.length) { $("lookList").innerHTML = `<p class="empty">Nothing named in that direction within sight. Turn slowly toward the land.</p>`; return; }
  const b = p[0];
  $("lookList").innerHTML = `<div class="best"><div class="k">You're pointing at</div><div class="n">${esc(F.title(b.it))}</div><div class="d">${esc(F.detail(b))}</div>${b.it.d ? `<p class="sub">${esc(b.it.d)}</p>` : ""}</div>` +
    (p.length > 1 ? `<p class="sub" style="margin:8px 0">Also in that direction:</p>` + p.slice(1, 8).map((x) => itemHTML(x)).join("") : "");
}
function renderSides(pos) {
  if (!pos) { $("shipline").textContent = "Waiting for a position…"; ["portList", "stbdList", "aheadList"].forEach((i) => $(i).innerHTML = ""); return; }
  if (pos.course == null) { $("shipline").innerHTML = "The ship's heading isn't known yet. Once the ship is moving, GPS works it out."; }
  else $("shipline").innerHTML = `Ship heading <b>${Math.round(pos.course)}° ${F.compass16(pos.course)}</b>${pos.speedKn != null ? ` · <b>${pos.speedKn.toFixed(0)} kn</b>` : ""}${pos.docked ? " · alongside" : ""}. Clock positions: 12 is dead ahead, 3 is straight off starboard, 9 straight off port.`;
  const s = F.sides(pos, pos.course ?? 0, ITEMS, 20);
  const list = (a) => a.length ? a.map((x) => itemHTML(x)).join("") : `<p class="empty">Nothing named in sight.</p>`;
  $("portList").innerHTML = list(s.port); $("stbdList").innerHTML = list(s.starboard); $("aheadList").innerHTML = list(s.ahead);
}

/* ---------- Lights ---------- */
const OBS = { color: "white", pattern: "flash", group: 1 }; let taps = [];
document.querySelectorAll(".chips").forEach((g) => g.querySelectorAll("button").forEach((b) => b.onclick = () => { OBS[g.dataset.group] = b.dataset.v === "any" ? (g.dataset.group === "pattern" ? null : "any") : b.dataset.v; render(); }));
$("gMinus").onclick = () => { OBS.group = Math.max(1, OBS.group - 1); render(); };
$("gPlus").onclick = () => { OBS.group = Math.min(9, OBS.group + 1); render(); };
$("tapBtn").onclick = () => { taps.push(Date.now()); if (taps.length > 8) taps.shift(); render(); };
$("clearLight").onclick = () => { taps = []; Object.assign(OBS, { color: "white", pattern: "flash", group: 1 }); render(); };
function renderLights(pos, h) {
  document.querySelectorAll(".chips").forEach((g) => g.querySelectorAll("button").forEach((b) => {
    const v = OBS[g.dataset.group]; b.setAttribute("aria-pressed", String(b.dataset.v === v || (b.dataset.v === "any" && (v == null || v === "any"))));
  }));
  $("gOut").textContent = OBS.group;
  const per = F.periodFromTaps(taps);
  $("tapInfo").textContent = per ? `About ${per.toFixed(1)} seconds between flashes (${taps.length} taps).` : taps.length ? "Keep tapping…" : "Tap 3 or more times for a good measurement.";
  if (!pos) { $("lightList").innerHTML = `<p class="empty">Waiting for a position…</p>`; return; }
  const m = F.matchLights(pos, { ...OBS, period: per }, ITEMS, $("useDir").checked ? h : null).filter((x) => x.matchScore > 0).slice(0, 6);
  $("lightList").innerHTML = m.length ? `<h2 class="side">Best matches</h2>` + m.map((x, i) => itemHTML(x, x.why.length ? `<div class="why">Matches: ${esc(x.why.join(", "))}</div>` : "")).join("")
    : `<p class="empty">No charted light in range matches that. Try "Not sure" for the colour or pattern.</p>`;
}
$("useDir").onchange = render;

/* ---------- Settings ---------- */
document.querySelectorAll("[data-set]").forEach((g) => g.querySelectorAll("button").forEach((b) => b.onclick = () => { S[g.dataset.set] = b.dataset.v; save(); render(); }));
$("tSlider").oninput = (e) => { S.preview = +e.target.value; save(); render(); };
function renderMore(pos) {
  document.querySelectorAll("[data-set]").forEach((g) => g.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(S[g.dataset.set] === b.dataset.v))));
  $("tSlider").value = S.preview;
  const t = V.start + S.preview / 1000 * (V.end - V.start), p = V.at(t);
  $("tLabel").textContent = p ? `${fmtWhen(t, p.tz)} — ${p.place}` : "";
  const opts = pos ? F.visible(pos, null, ITEMS).sort((a, b) => b.score - a.score).slice(0, 30) : [];
  const cur = $("alignPick").value;
  $("alignPick").innerHTML = opts.map((x) => `<option value="${x.it.la},${x.it.lo}">${esc(x.it.n)} — ${esc(F.KIND[x.it.k] || "")}, ${F.fmtNm(x.d)} ${F.compass16(x.b)}</option>`).join("") || `<option>No landmarks in sight</option>`;
  if (cur) $("alignPick").value = cur;
  $("alignInfo").textContent = S.align ? `Compass corrected by ${S.align > 0 ? "+" : ""}${S.align.toFixed(0)}°.` : isNative ? "The app uses true north from iOS; alignment is only needed if it looks off." : "No correction applied.";
  const d = window.FJORD_LANDMARKS || {}, c = d.counts || {};
  $("dataInfo").innerHTML = `${ITEMS.length.toLocaleString("en-US")} landmarks along the route: ${Object.entries(c).map(([k, v]) => `${v} ${esc((F.KIND[k] || k).toLowerCase())}`).join(", ")}. Map data © <a href="https://www.openstreetmap.org/copyright" style="color:inherit">OpenStreetMap contributors</a>, downloaded ${esc(d.generated || "")}. Distances in nautical miles; heights in feet. Light details come from OpenStreetMap's sea-mark data and are not for navigation. Port times are approximate; Viking's daily program governs.`;
}
$("alignBtn").onclick = () => {
  const pos = position(); const [la, lo] = $("alignPick").value.split(",").map(Number);
  if (!pos || rawHeading == null || !Number.isFinite(la)) return toast("Turn on the compass and choose a landmark first.");
  S.align = F.angleDiff(F.bearing(pos, { lat: la, lon: lo }), rawHeading); save(); render(); toast("Compass aligned.");
};
$("alignReset").onclick = () => { S.align = 0; save(); render(); };

/* ---------- Red night-vision mode ---------- */
function sunAlt(t, lat, lon) {
  const r = Math.PI / 180, d = t / 864e5 - 0.5 + 2440588 - 2451545, e = r * 23.4397, M = r * (357.5291 + 0.98560028 * d);
  const L = M + r * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + r * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)), ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const H = r * (280.16 + 360.9856235 * d) + lon * r - ra;
  return Math.asin(Math.sin(lat * r) * Math.sin(dec) + Math.cos(lat * r) * Math.cos(dec) * Math.cos(H)) / r;
}
function applyRed(pos) {
  let on = S.red === "on";
  if (S.red === "auto") on = pos ? sunAlt(pos.t || NOW(), pos.lat, pos.lon) < -6 : false;
  document.documentElement.classList.toggle("red", on);
  $("redBtn").setAttribute("aria-pressed", String(on));
}
$("redBtn").onclick = () => { S.red = document.documentElement.classList.contains("red") ? "off" : "on"; save(); render(); };

let toastT;
function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2800); }

/* ---------- Native app feeds GPS, true heading and camera state ---------- */
window.__fjordNative = (m) => {
  if (m.type === "location") onFix(m.lat, m.lon, m.course, m.speed, m.acc);
  else if (m.type === "heading") onHeading(m.heading, "native");
  else if (m.type === "error") toast(m.message);
};

/* ---------- Start ---------- */
if (isNative) { $("compassBtn").textContent = "Compass on"; $("compassBtn").classList.add("on"); }
startGPS(); if (isNative) startCompass();
render();
setInterval(render, 5000);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
window.__fjord = { S, position, heading: () => heading(), onHeading, onFix, setCamera, items: ITEMS };
})();
