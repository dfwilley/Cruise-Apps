// Arctic Night — forecast logic shared by the web app and the native iPhone app.
// Sun and moon positions are calculated on the phone; aurora data comes from NOAA SWPC; clouds from Open-Meteo.
(function (root) {
"use strict";
const HOUR = 3600e3, DAY = 864e5;

/* ================= Voyage: Viking Libra, In Search of Northern Lights, Tromsø → London (Tilbury) =================
   Times are local ship time from a published itinerary (approximate; check Viking's daily program on board).
   tz = hours ahead of UTC (Norway +1, UK 0 in winter). Departure from Tromsø is an assumption (23:00). */
const VOYAGE = {
  ship: "Viking Libra", title: "In Search of Northern Lights", start: "2027-01-30", end: "2027-02-11",
  stops: [
    { name: "Tromsø", lat: 69.648, lon: 18.955, tz: 1, arrive: "2027-01-30T12:00", depart: "2027-01-31T23:00" },
    { name: "Alta", lat: 69.968, lon: 23.272, tz: 1, arrive: "2027-02-01T12:00", depart: "2027-02-02T23:00" },
    { name: "Harstad", lat: 68.799, lon: 16.542, tz: 1, arrive: "2027-02-03T13:00", depart: "2027-02-03T23:00" },
    { name: "Narvik", lat: 68.437, lon: 17.427, tz: 1, arrive: "2027-02-04T08:00", depart: "2027-02-04T23:00" },
    { name: "Norwegian Inside Passage", lat: 65.47, lon: 12.0, tz: 1, arrive: "2027-02-05T12:00", depart: "2027-02-05T12:00", sea: true },
    { name: "Bergen", lat: 60.397, lon: 5.316, tz: 1, arrive: "2027-02-06T18:00", depart: "2027-02-07T18:00" },
    { name: "North Sea", lat: 58.3, lon: 0.6, tz: 0, arrive: "2027-02-08T12:00", depart: "2027-02-08T12:00", sea: true },
    { name: "Edinburgh (Rosyth)", lat: 56.018, lon: -3.437, tz: 0, arrive: "2027-02-09T07:00", depart: "2027-02-09T16:00" },
    { name: "North Sea", lat: 54.3, lon: 1.9, tz: 0, arrive: "2027-02-10T12:00", depart: "2027-02-10T12:00", sea: true },
    { name: "London (Tilbury)", lat: 51.456, lon: 0.358, tz: 0, arrive: "2027-02-11T05:00", depart: "2027-02-11T09:00" },
  ],
};
const localToUTC = (s, tz) => Date.parse(s + ":00Z") - tz * HOUR;
VOYAGE.stops.forEach((s) => { s.arriveT = localToUTC(s.arrive, s.tz); s.departT = localToUTC(s.depart, s.tz); });
VOYAGE.startT = VOYAGE.stops[0].arriveT;
VOYAGE.endT = VOYAGE.stops[VOYAGE.stops.length - 1].arriveT;

/** Where the ship is at time t (UTC ms): docked at a port, or between ports (straight-line estimate). */
function shipAt(t) {
  const st = VOYAGE.stops;
  if (t < st[0].arriveT || t > st[st.length - 1].departT) return null;
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    if (t >= s.arriveT && t <= s.departT) return { lat: s.lat, lon: s.lon, tz: s.tz, docked: !s.sea, place: s.sea ? `At sea · ${s.name}` : `In port · ${s.name}`, port: s.sea ? null : s.name };
    const n = st[i + 1];
    if (n && t > s.departT && t < n.arriveT) {
      const f = (t - s.departT) / (n.arriveT - s.departT);
      const to = n.sea ? (st[i + 2] ? st[i + 2].name : n.name) : n.name;
      return { lat: s.lat + (n.lat - s.lat) * f, lon: s.lon + (n.lon - s.lon) * f, tz: f < 0.5 ? s.tz : n.tz, docked: false, place: `At sea · bound for ${to}`, port: null };
    }
  }
  return null;
}

/* ================= Sun and moon (standard low-precision formulas) ================= */
const rad = Math.PI / 180, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397;
const toDays = (t) => t / DAY - 0.5 + J1970 - J2000;
const ra = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
const dec = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
const sidereal = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
const altitude = (H, phi, dc) => Math.asin(Math.sin(phi) * Math.sin(dc) + Math.cos(phi) * Math.cos(dc) * Math.cos(H));
function sunCoords(d) {
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  return { dec: dec(L, 0), ra: ra(L, 0) };
}
function moonCoords(d) {
  const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.22935 * d);
  const l = L + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F), dist = 385001 - 20905 * Math.cos(M);
  return { ra: ra(l, b), dec: dec(l, b), dist };
}
/** Sun altitude in degrees. Below −12° is nautical-dark: dark enough for aurora. */
function sunAltitude(t, lat, lon) {
  const d = toDays(t), c = sunCoords(d), H = sidereal(d, -lon * rad) - c.ra;
  return altitude(H, lat * rad, c.dec) / rad;
}
function moonAltitude(t, lat, lon) {
  const d = toDays(t), c = moonCoords(d), H = sidereal(d, -lon * rad) - c.ra;
  return altitude(H, lat * rad, c.dec) / rad;
}
/** Fraction of the moon lit (0 new … 1 full) and whether it's waxing. */
function moonIllumination(t) {
  const d = toDays(t), s = sunCoords(d), m = moonCoords(d), sd = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sd * Math.sin(phi), m.dist - sd * Math.cos(phi));
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  return { fraction: (1 + Math.cos(inc)) / 2, waxing: angle < 0 };
}

/* ================= Geomagnetic latitude and Kp needed =================
   Dipole north geomagnetic pole ≈ 80.8°N, 72.8°W (IGRF, mid-2020s). */
function geomagLat(lat, lon) {
  const p = 80.8 * rad, pl = -72.8 * rad, f = lat * rad, l = lon * rad;
  return Math.asin(Math.sin(f) * Math.sin(p) + Math.cos(f) * Math.cos(p) * Math.cos(l - pl)) / rad;
}
/** Approximate Kp at which aurora shows low on the northern horizon, and overhead. Calibrated so Tromsø ≈ 0, Edinburgh ≈ 5, London ≈ 7.5 (common viewing experience). */
function kpNeeded(lat, lon) {
  const m = geomagLat(lat, lon);
  const horizon = Math.max(0, Math.min(9, (68.2 - m) / 2));
  return { geomag: m, horizon, overhead: Math.max(0, Math.min(9, horizon + 2.5)) };
}

/* ================= NOAA and Open-Meteo data (both the older and the 2026 NOAA formats) ================= */
const parseTime = (s) => Date.parse(String(s).trim().replace(" ", "T").replace(/(\.\d+)?Z?$/, "Z"));
function rows(json) { // header-row arrays → objects
  if (!Array.isArray(json) || !json.length) return [];
  if (Array.isArray(json[0])) { const h = json[0]; return json.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]]))); }
  return json;
}
/** 3-hour Kp blocks: observed, estimated and predicted (about 3 days ahead). */
function parseKpForecast(json) {
  return rows(json).map((r) => ({ t: parseTime(r.time_tag), kp: Number(r.kp ?? r.Kp), kind: String(r.observed || r.kind || "predicted") }))
    .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.kp)).sort((a, b) => a.t - b.t);
}
/** NOAA 27-day outlook text → { "2027-01-30": largestKp, … } */
function parse27Day(text) {
  const out = {}, mon = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*(\d{4})\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d+)\s+(\d+)\s+(\d+)/);
    if (m && mon[m[2]]) out[`${m[1]}-${String(mon[m[2]]).padStart(2, "0")}-${m[3].padStart(2, "0")}`] = Number(m[6]);
  }
  return out;
}
/** OVATION aurora nowcast grid → highest chance (0–100%) within about 3° of a place, plus the time it's for. */
function parseOvation(json) {
  const grid = new Map();
  for (const c of json.coordinates || []) grid.set(`${Math.round(c[0])},${Math.round(c[1])}`, c[2]);
  const at = (lat, lon) => {
    let best = 0;
    const L = Math.round(lat), G = Math.round(((lon % 360) + 360) % 360);
    for (let dl = -3; dl <= 3; dl++) for (let dg = -4; dg <= 4; dg++) {
      const v = grid.get(`${(G + dg + 360) % 360},${L + dl}`); if (v > best) best = v;
    }
    return best;
  };
  return { at, forecastTime: parseTime(json["Forecast Time"] || json.forecast_time || ""), size: grid.size };
}
/** Solar wind magnetic field: average north–south (Bz) over the last 30 minutes. Negative (southward) helps aurora. */
function parseBz(json) {
  const r = rows(json).map((x) => ({ t: parseTime(x.time_tag), bz: Number(x.bz_gsm) })).filter((x) => Number.isFinite(x.t) && Number.isFinite(x.bz));
  if (!r.length) return null;
  const last = r[r.length - 1].t, recent = r.filter((x) => x.t > last - 30 * 60e3);
  return { bz: recent.reduce((s, x) => s + x.bz, 0) / recent.length, t: last };
}
/** Open-Meteo hourly (one place or several) → array of { lat, lon, hours: Map(utcHour → {cloud, low, mid, high, tempF, windMph}) } */
function parseClouds(json) {
  const list = Array.isArray(json) ? json : [json];
  return list.map((p) => {
    const h = p.hourly || {}, hours = new Map();
    (h.time || []).forEach((tm, i) => hours.set(parseTime(tm), { cloud: h.cloud_cover?.[i], low: h.cloud_cover_low?.[i], mid: h.cloud_cover_mid?.[i], high: h.cloud_cover_high?.[i], tempF: h.temperature_2m?.[i], windMph: h.wind_speed_10m?.[i] }));
    return { lat: p.latitude, lon: p.longitude, hours };
  });
}
function cloudURL(points) {
  const f = (k) => points.map((p) => p[k].toFixed(2)).join(",");
  return `https://api.open-meteo.com/v1/forecast?latitude=${f("lat")}&longitude=${f("lon")}&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,temperature_2m,wind_speed_10m&timezone=GMT&forecast_days=16&temperature_unit=fahrenheit&wind_speed_unit=mph`;
}
const SOURCES = {
  kp: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json",
  outlook: "https://services.swpc.noaa.gov/text/27-day-outlook.txt",
  ovation: "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
  mag: "https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json",
};

/* ================= Scoring a night ================= */
/** Kp expected at time t: 3-hour forecast if it covers t, else the 27-day outlook's largest Kp for that UTC day. */
function kpAt(t, data) {
  const blocks = data.kp || [];
  const b = blocks.find((x) => t >= x.t && t < x.t + 3 * HOUR);
  if (b) return { kp: b.kp, source: b.kind === "observed" ? "observed" : "forecast" };
  const day = new Date(t).toISOString().slice(0, 10);
  if (data.outlook && data.outlook[day] != null) return { kp: data.outlook[day], source: "outlook" };
  return { kp: null, source: "none" };
}
function cloudAt(t, lat, lon, data) {
  if (!data.clouds) return null;
  let best = null, bestD = 1e9;
  for (const p of data.clouds) { const d = Math.hypot(p.lat - lat, (p.lon - lon) * Math.cos(lat * rad)); if (d < bestD) { bestD = d; best = p; } }
  if (!best || bestD > 3) return null;
  const hr = Math.floor(t / HOUR) * HOUR;
  return best.hours.get(hr) || null;
}
/** How much of the sky is blocked, 0–1. Thin high cloud counts for less than low and middle cloud. */
function cloudBlock(c) {
  if (!c) return null;
  if (c.low == null && c.mid == null) return (c.cloud ?? 0) / 100;
  return 1 - (1 - (c.low || 0) / 100) * (1 - (c.mid || 0) / 100) * (1 - 0.4 * (c.high || 0) / 100);
}
function activityScore(kp, need) {
  if (kp == null) return null;
  if (kp >= need.overhead) return 1;
  if (kp >= need.horizon) return 0.55 + 0.45 * (kp - need.horizon) / Math.max(0.5, need.overhead - need.horizon);
  if (kp >= need.horizon - 1) return 0.25;
  return 0.05;
}
/**
 * Scores one hour at a place. Returns null if it's not dark.
 * { t, score 0–1, kp, kpSource, cloud 0–1|null, moon 0–1, moonUp, sunAlt }
 */
function scoreHour(t, lat, lon, data) {
  const sunAlt = sunAltitude(t, lat, lon);
  if (sunAlt > -10) return null;
  const need = kpNeeded(lat, lon);
  const k = kpAt(t, data), a = activityScore(k.kp, need);
  const c = cloudBlock(cloudAt(t, lat, lon, data));
  const ill = moonIllumination(t).fraction, mAlt = moonAltitude(t, lat, lon), moonUp = mAlt > 0;
  const moonF = 1 - (moonUp ? 0.4 * ill * Math.min(1, mAlt / 20 + 0.3) : 0);
  const darkF = sunAlt < -12 ? 1 : 0.6;
  const score = a == null ? null : a * (c == null ? 0.6 : 1 - c) * moonF * darkF;
  return { t, score, kp: k.kp, kpSource: k.source, cloud: c, moon: ill, moonUp, sunAlt, need };
}
const LEVELS = [{ min: 0.45, name: "Good" }, { min: 0.2, name: "Fair" }, { min: 0, name: "Poor" }];
const levelOf = (s) => s == null ? "Too early" : LEVELS.find((l) => s >= l.min).name;

/**
 * One night (local evening 16:00 to 08:00 next morning) at a fixed place or following the ship.
 * where(t) → {lat, lon, tz, place}. dateLocal = "YYYY-MM-DD" (the evening's date).
 */
function scoreNight(dateLocal, where, data) {
  const probe = where(Date.parse(dateLocal + "T20:00:00Z")) || {};
  const tz = probe.tz ?? 0;
  const start = Date.parse(dateLocal + "T16:00:00Z") - tz * HOUR;
  const hours = [];
  for (let t = start; t <= start + 16 * HOUR; t += HOUR) {
    const w = where(t); if (!w) continue;
    const h = scoreHour(t, w.lat, w.lon, data); if (h) hours.push({ ...h, place: w.place, lat: w.lat, lon: w.lon });
  }
  const mid = where(start + 5 * HOUR) || probe; // where you are in the evening (9 PM ship time)
  const dark = hours.filter((h) => h.sunAlt < -12);
  const scored = hours.filter((h) => h.score != null);
  const best = scored.reduce((b, h) => (!b || h.score > b.score ? h : b), null);
  const clouds = hours.map((h) => h.cloud).filter((c) => c != null);
  const avgCloud = clouds.length ? clouds.reduce((s, c) => s + c, 0) / clouds.length : null;
  const ill = moonIllumination(start + 8 * HOUR);
  const moonUpHours = hours.filter((h) => h.moonUp).length;
  const kps = hours.map((h) => h.kp).filter((k) => k != null);
  const maxKp = kps.length ? Math.max(...kps) : null;
  const sources = new Set(hours.map((h) => h.kpSource));
  const kpSource = sources.has("forecast") || sources.has("observed") ? "forecast" : sources.has("outlook") ? "outlook" : "none";
  const need = kpNeeded(mid.lat, mid.lon);
  let level = levelOf(best ? best.score : null);
  if (kpSource === "outlook" && level === "Good") level = "Fair"; // the 27-day outlook is too rough to promise a Good night
  const reasons = [];
  const needTxt = need.horizon < 1 ? "even quiet nights can show aurora here" : `about ${need.horizon.toFixed(0)} needed to see it here`;
  if (maxKp != null) reasons.push(`Kp up to ${maxKp.toFixed(maxKp % 1 ? 1 : 0)}${kpSource === "outlook" ? " (27-day outlook)" : ""}; ${needTxt}`);
  else reasons.push("Aurora forecast not out yet (NOAA forecasts 3 days ahead; the 27-day outlook covers about 4 weeks)");
  reasons.push(avgCloud == null ? "Cloud forecast not available yet (16 days ahead)" : `Clouds about ${Math.round(avgCloud * 100)}% of the sky`);
  reasons.push(`Moon ${Math.round(ill.fraction * 100)}% lit${moonUpHours ? `, up ${moonUpHours} of the dark hours` : ", below the horizon"}`);
  reasons.push(`${dark.length} hours of full darkness`);
  return { date: dateLocal, tz, place: mid.place, lat: mid.lat, lon: mid.lon, level, score: best ? best.score : null, best: best ? best.t : null, bestKp: best ? best.kp : null, maxKp, kpSource, avgCloud, moon: ill.fraction, moonUpHours, darkHours: dark.length, need, hours, reasons };
}
function voyageNights(data) {
  const out = [];
  for (let d = Date.parse(VOYAGE.start + "T00:00:00Z"); d < Date.parse(VOYAGE.end + "T00:00:00Z"); d += DAY) out.push(scoreNight(new Date(d).toISOString().slice(0, 10), shipAt, data));
  return out;
}
/** Positions to fetch cloud forecasts for: the ship at local midnight each night (one Open-Meteo request). */
function voyageCloudPoints() {
  const pts = [];
  for (let d = Date.parse(VOYAGE.start + "T00:00:00Z"); d < Date.parse(VOYAGE.end + "T00:00:00Z"); d += DAY) {
    for (const h of [20, 24, 28]) { const w = shipAt(d + h * HOUR - HOUR); if (w) pts.push({ lat: w.lat, lon: w.lon }); }
  }
  const uniq = []; for (const p of pts) if (!uniq.some((q) => Math.hypot(q.lat - p.lat, q.lon - p.lon) < 0.5)) uniq.push(p);
  return uniq;
}

/* ================= Live “look now” check ================= */
function liveCheck(t, lat, lon, data) {
  const sunAlt = sunAltitude(t, lat, lon);
  const prob = data.ovation ? data.ovation.at(lat, lon) : null;
  const c = cloudBlock(cloudAt(t, lat, lon, data));
  const k = kpAt(t, data);
  const bz = data.bz ? data.bz.bz : null;
  const dark = sunAlt < -10;
  const look = dark && prob != null && prob >= 20 && (c == null || c < 0.7);
  return { sunAlt, dark, prob, cloud: c, kp: k.kp, bz, look };
}

/* ================= Alerts the native app schedules on the phone ================= */
/** For nights with a real forecast at or above the chosen level, alert 15 minutes before the best hour. */
function plannedAlerts(nights, opts, now) {
  const min = opts.minLevel === "Fair" ? ["Good", "Fair"] : ["Good"];
  return nights.filter((n) => n.best && n.kpSource === "forecast" && min.includes(n.level))
    .map((n) => {
      let at = n.best - 15 * 60e3;
      const localHour = new Date(at + n.tz * HOUR).getUTCHours();
      if (opts.quietStart != null && opts.quietEnd != null) {
        const inQuiet = opts.quietStart > opts.quietEnd ? (localHour >= opts.quietStart || localHour < opts.quietEnd) : (localHour >= opts.quietStart && localHour < opts.quietEnd);
        if (inQuiet && n.level !== "Good") return null;
      }
      const when = fmtTime(n.best, n.tz);
      return { id: `night-${n.date}`, at, title: `${n.level} aurora chance tonight`, body: `${n.place.replace(/^In port · /, "")}: best around ${when} ship time. ${n.reasons[0]}. ${n.reasons[1]}.` };
    }).filter((a) => a && a.at > now);
}

/* ================= Formatting ================= */
function fmtTime(t, tz) {
  const d = new Date(t + tz * HOUR); let h = d.getUTCHours(); const m = d.getUTCMinutes();
  const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return `${h}${m ? ":" + String(m).padStart(2, "0") : ""} ${ap}`;
}
function fmtDate(dateLocal) {
  const d = new Date(dateLocal + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

const api = { VOYAGE, shipAt, sunAltitude, moonAltitude, moonIllumination, geomagLat, kpNeeded, parseKpForecast, parse27Day, parseOvation, parseBz, parseClouds, cloudURL, SOURCES, kpAt, cloudBlock, scoreHour, scoreNight, voyageNights, voyageCloudPoints, liveCheck, plannedAlerts, levelOf, fmtTime, fmtDate, HOUR, DAY };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Arctic = api;
})(typeof window !== "undefined" ? window : globalThis);
