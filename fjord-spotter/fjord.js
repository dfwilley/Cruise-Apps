// Fjord Spotter — logic shared by the web app and the native iPhone app.
// Positions in degrees, distances in km internally; shown in nautical miles, miles and feet.
(function (root) {
"use strict";
const R = 6371, rad = Math.PI / 180, NM = 1.852, FT = 3.28084, HOUR = 3600e3;

/* ---------- Geometry ---------- */
function distanceKm(a, b) {
  const dLa = (b.lat - a.lat) * rad, dLo = (b.lon - a.lon) * rad;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearing(a, b) {
  const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
const norm = (d) => ((d % 360) + 360) % 360;
const angleDiff = (a, b) => { const d = norm(a - b); return d > 180 ? d - 360 : d; }; // −180…180

/* ---------- The ship's plan (used when there's no GPS fix, and for previews) ---------- */
function makeVoyage(route) {
  const pts = route.track.map((p) => ({ lat: p[0], lon: p[1], name: p[2] || null }));
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distanceKm(pts[i - 1], pts[i]));
  const stops = route.stops.map((s) => {
    const idx = pts.findIndex((p, i) => p.name === s.name);
    const t = (x) => Date.parse(x + ":00Z") - s.tz * HOUR;
    return { ...s, idx, arriveT: t(s.arrive), departT: t(s.depart) };
  });
  function pointAt(d) { // position and course at distance d (km) along the track
    let i = cum.findIndex((c) => c >= d); if (i <= 0) i = 1; if (i === -1) i = pts.length - 1;
    const a = pts[i - 1], b = pts[i], f = (d - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
    return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, course: bearing(a, b) };
  }
  function at(t) {
    for (let k = 0; k < stops.length; k++) {
      const s = stops[k], n = stops[k + 1];
      if (t >= s.arriveT && t <= s.departT) {
        const p = pts[s.idx], next = pts[Math.min(s.idx + 1, pts.length - 1)];
        return { lat: p.lat, lon: p.lon, course: bearing(p, next), speedKn: 0, docked: true, place: `In port · ${s.name}`, tz: s.tz };
      }
      if (n && t > s.departT && t < n.arriveT) {
        const f = (t - s.departT) / (n.arriveT - s.departT);
        const d = cum[s.idx] + f * (cum[n.idx] - cum[s.idx]);
        const p = pointAt(d);
        const kn = (cum[n.idx] - cum[s.idx]) / NM / ((n.arriveT - s.departT) / HOUR);
        return { ...p, speedKn: kn, docked: false, place: `At sea · bound for ${n.name}`, tz: f < 0.5 ? s.tz : n.tz };
      }
    }
    return null;
  }
  return { pts, stops, at, start: stops[0].arriveT, end: stops[stops.length - 1].departT, lengthKm: cum[cum.length - 1] };
}

/* ---------- What can be seen from the deck ---------- */
const EYE_M = 20; // eye height on an upper deck
const horizonKm = (hM) => 3.57 * Math.sqrt(Math.max(0, hM));
/** Furthest distance (km) at which this landmark is worth showing. */
function rangeKm(it) {
  switch (it.k) {
    case "peak": case "glacier": return Math.min(60, horizonKm(EYE_M) + horizonKm(it.e || 800));
    case "lighthouse": case "light": {
      const nominal = it.l && it.l.rng ? it.l.rng * NM : it.k === "lighthouse" ? 18 : 9;
      const geo = horizonKm(EYE_M) + horizonKm((it.l && it.l.h) || it.e || 15);
      return Math.min(nominal, geo);
    }
    case "city": return 25; case "town": return 20; case "village": return 10;
    case "fjord": case "bay": case "strait": return 20;
    case "island": case "cape": return 15;
    case "wreck": return 8;
    default: return 10;
  }
}
/** How notable something is (for sorting and for choosing which labels to show). */
function prominence(it, dKm) {
  const near = Math.max(0, 1 - dKm / rangeKm(it));
  const base = { peak: 3 + Math.min(4, (it.e || 300) / 400), glacier: 5, city: 8, town: 6, village: 3, lighthouse: 6, light: 2.5, fjord: 5, strait: 4, bay: 3, island: 3, cape: 3.5, wreck: 4 }[it.k] || 2;
  return base * (0.4 + 0.6 * near);
}
const KIND = { peak: "Mountain", glacier: "Glacier", city: "City", town: "Town", village: "Village", lighthouse: "Lighthouse", light: "Navigation light", fjord: "Fjord / sound", strait: "Sound", bay: "Bay", island: "Island", cape: "Cape", wreck: "Wreck" };

/** Every landmark in sight range, with distance, bearing, side and clock position relative to the ship's course. */
function visible(pos, course, items) {
  const out = [];
  for (const it of items) {
    const p = { lat: it.la, lon: it.lo };
    const d = distanceKm(pos, p); if (d > rangeKm(it)) continue;
    const b = bearing(pos, p), rel = course == null ? null : norm(b - course);
    const side = rel == null ? null : rel <= 15 || rel >= 345 ? "Ahead" : rel >= 165 && rel <= 195 ? "Astern" : rel < 180 ? "Starboard" : "Port";
    const clock = rel == null ? null : (Math.round(rel / 30) % 12) || 12;
    out.push({ it, d, b, rel, side, clock, score: prominence(it, d) });
  }
  return out;
}
/** Port and starboard lists, most notable first. */
const named = (x) => x.it.n !== "Unnamed light"; // unnamed lights only matter to the lighthouse identifier
function sides(pos, course, items, limit = 25) {
  const v = visible(pos, course, items).filter(named).sort((a, b) => b.score - a.score);
  const pick = (s) => v.filter((x) => s.includes(x.side)).slice(0, limit);
  return { port: pick(["Port"]), starboard: pick(["Starboard"]), ahead: pick(["Ahead"]), astern: pick(["Astern"]) };
}
/** What's in the direction the phone points (within ±half the cone), best first. */
function pointing(pos, heading, items, cone = 24) {
  return visible(pos, null, items).filter(named).map((x) => ({ ...x, off: angleDiff(x.b, heading) }))
    .filter((x) => Math.abs(x.off) <= cone / 2)
    .map((x) => ({ ...x, match: x.score * (1 - Math.abs(x.off) / cone) }))
    .sort((a, b) => b.match - a.match);
}
/** Labels for the camera view: horizontal position 0–1 across the screen, rows so they don't overlap. */
function cameraLabels(pos, heading, items, hfov = 50, max = 14) {
  const inView = visible(pos, null, items).filter(named).map((x) => ({ ...x, off: angleDiff(x.b, heading) }))
    .filter((x) => Math.abs(x.off) <= hfov / 2).sort((a, b) => b.score - a.score).slice(0, max);
  const rows = [];
  for (const x of inView) {
    x.x = 0.5 + x.off / hfov;
    let r = 0; while (rows[r] && rows[r].some((y) => Math.abs(y - x.x) < 0.24)) r++;
    (rows[r] ||= []).push(x.x); x.row = r;
  }
  return inView;
}

/* ---------- Lighthouses: flash patterns ----------
   Chart abbreviations: F fixed (steady), Fl flashing, LFl long flash, Q quick (~1/s), VQ very quick (~2/s),
   Iso equal light and dark, Oc occulting (mostly on, short dark), Mo Morse code. Fl(2) = groups of 2 flashes. */
function parseLight(l) {
  if (!l) return null;
  const ch = String(l.ch || "").replace(/\s+/g, "");
  const m = ch.match(/^(Al\.)?(LFl|VQ|UQ|Q|Fl|Iso|Oc|Mo|F)(?:\(([^)]*)\))?/i);
  const type = m ? m[2].replace(/^lfl$/i, "LFl").replace(/^vq$/i, "VQ").replace(/^uq$/i, "UQ").replace(/^iso$/i, "Iso").replace(/^oc$/i, "Oc").replace(/^mo$/i, "Mo").replace(/^fl$/i, "Fl").replace(/^q$/i, "Q").replace(/^f$/i, "F") : null;
  const g = (m && m[3]) || l.grp || "";
  const group = /^\d+$/.test(String(g)) ? Number(g) : /^\d+\+\d+$/.test(String(g)) ? String(g).split("+").map(Number).reduce((a, b) => a + b, 0) : 1;
  const cols = (l.col || []).map((c) => String(c).toLowerCase());
  return { type, group, period: l.per || null, cols, alternating: !!(m && m[1]), text: describeLight(type, group, l.per, cols) };
}
const TYPE_WORDS = { F: "Steady", Fl: "Flashing", LFl: "Long flash", Q: "Quick flashing", VQ: "Very quick flashing", UQ: "Ultra quick", Iso: "Equal on and off", Oc: "Mostly on, short dark gaps", Mo: "Morse code" };
function describeLight(type, group, per, cols) {
  const c = cols && cols.length ? cols.join("/") + " " : "";
  const what = type ? TYPE_WORDS[type] || type : "Light";
  return `${c}${what.toLowerCase()}${group > 1 ? `, groups of ${group}` : ""}${per ? `, every ${per} s` : ""}`.replace(/^./, (s) => s.toUpperCase());
}
/** Your observation: colour, kind of pattern, flashes per group, and the measured period (seconds). */
function matchLights(pos, obs, items, heading = null) {
  const want = { steady: ["F"], flash: ["Fl", "LFl"], long: ["LFl"], quick: ["Q", "VQ", "UQ"], eclipse: ["Oc", "Iso"] }[obs.pattern] || null;
  return visible(pos, null, items).filter((x) => x.it.l && (x.it.k === "lighthouse" || x.it.k === "light")).map((x) => {
    const L = parseLight(x.it.l); let s = 1; const why = [];
    if (obs.color && obs.color !== "any") { if (L.cols.includes(obs.color)) { s += 2; why.push(`shows ${obs.color}`); } else if (L.cols.length) s -= 3; }
    if (want) { if (want.includes(L.type)) { s += 2; why.push(TYPE_WORDS[L.type].toLowerCase()); } else s -= 2; }
    if (obs.group) { if (L.group === obs.group) { s += 1.5; if (obs.group > 1) why.push(`groups of ${obs.group}`); } else s -= 1.5; }
    if (obs.period && L.period) {
      const err = Math.abs(obs.period - L.period) / L.period;
      if (err < 0.15) { s += 3; why.push(`every ${L.period} s`); } else if (err < 0.35) s += 1; else s -= 2;
    }
    if (heading != null) { const off = Math.abs(angleDiff(x.b, heading)); if (off < 25) { s += 1.5; why.push("in the direction you're pointing"); } else if (off > 60) s -= 2; }
    s -= x.d / 40;
    return { ...x, light: L, matchScore: s, why };
  }).sort((a, b) => b.matchScore - a.matchScore);
}
/** Average time between taps (seconds), ignoring the first tap. */
function periodFromTaps(taps) {
  if (taps.length < 2) return null;
  const gaps = taps.slice(1).map((t, i) => (t - taps[i]) / 1000).filter((g) => g > 0.3 && g < 60);
  return gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
}

/* ---------- Formatting ---------- */
const fmtNm = (km) => { const nm = km / NM; return nm < 1 ? `${Math.round(km * 1000 * FT).toLocaleString("en-US")} ft` : `${nm < 10 ? nm.toFixed(1) : Math.round(nm)} nm`; };
const fmtFt = (m) => `${Math.round(m * FT).toLocaleString("en-US")} ft`;
const compass16 = (b) => ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(norm(b) / 22.5) % 16];
const title = (it) => it.en ? `${it.n} (${it.en})` : it.n;
function detail(x) {
  const it = x.it, bits = [KIND[it.k] || it.k];
  if (it.e && (it.k === "peak" || it.k === "glacier")) bits.push(fmtFt(it.e));
  if (it.l) bits.push(parseLight(it.l).text);
  bits.push(`${fmtNm(x.d)} ${compass16(x.b)}`);
  return bits.join(" · ");
}

const api = { distanceKm, bearing, angleDiff, norm, makeVoyage, rangeKm, prominence, visible, sides, pointing, cameraLabels, parseLight, describeLight, matchLights, periodFromTaps, fmtNm, fmtFt, compass16, title, detail, KIND, NM, HOUR };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Fjord = api;
})(typeof window !== "undefined" ? window : globalThis);
