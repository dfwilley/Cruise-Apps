/* Port Pocket Guide — pure logic (no page access), shared by the web app, the iPhone app and the tests. */
(function (root) {
  const R = Math.PI / 180;

  // ---- Distances -------------------------------------------------------------------------------------------
  function km(aLat, aLon, bLat, bLon) {
    const p1 = aLat * R, p2 = bLat * R;
    const d = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((bLon - aLon) * R / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(d));
  }
  // Streets are rarely straight: about 1.3× the straight line. Winter pavements: about 4 km/h (2.5 mph).
  const ROUTE_FACTOR = 1.3, WALK_KMH = 4;
  function walk(straightKm) {
    const k = straightKm * ROUTE_FACTOR;
    return { km: k, mi: k / 1.609344, min: Math.max(1, Math.round(k / WALK_KMH * 60)) };
  }
  function fmtMi(mi) {
    if (mi < 0.19) return Math.round(mi * 5280 / 50) * 50 + " ft";
    return (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + " mi";
  }
  function fmtMin(m) {
    if (m < 60) return m + " min";
    const h = Math.floor(m / 60), r = m % 60;
    return h + " h" + (r ? " " + r + " min" : "");
  }
  // Apple Maps walking directions (works offline when the area has been downloaded in Maps).
  function mapsLink(to, from, mode) {
    const d = `${to.lat},${to.lon}`;
    let u = "https://maps.apple.com/?daddr=" + d + "&dirflg=" + (mode || "w");
    if (from) u += "&saddr=" + `${from.lat},${from.lon}`;
    if (to.name) u += "&q=" + encodeURIComponent(to.name);
    return u;
  }

  // ---- Port times (each port keeps its own fixed offset from UTC for these dates) -----------------------------
  function portDate(dateStr, hhmm, tz) {   // → Date (absolute instant)
    const [h, m] = (hhmm || "00:00").split(":").map(Number);
    const [Y, M, D] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(Y, M - 1, D, h - tz, m));
  }
  function localParts(date, tz) {          // the port's wall clock for an instant
    const d = new Date(date.getTime() + tz * 3600e3);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
  }
  const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtClock(date, tz) {
    const p = localParts(date, tz);
    return String(p.h).padStart(2, "0") + ":" + String(p.mi).padStart(2, "0");
  }
  function fmt12(date, tz) {
    const p = localParts(date, tz); const h = p.h % 12 || 12;
    return h + ":" + String(p.mi).padStart(2, "0") + (p.h < 12 ? " AM" : " PM");
  }
  function dayLabel(dateStr) {
    const [Y, M, D] = dateStr.split("-").map(Number);
    const dow = new Date(Date.UTC(Y, M - 1, D)).getUTCDay();
    return DOW[dow] + ", " + MON[M - 1] + " " + D;
  }
  function dowOf(dateStr) { const [Y, M, D] = dateStr.split("-").map(Number); return new Date(Date.UTC(Y, M - 1, D)).getUTCDay(); }

  // The ship's time in port: arrive, depart, and all aboard (30 minutes before sailing unless the program says otherwise).
  // River voyages list days without times; then arrive/depart are null and only the dates are known.
  function portCall(port) {
    const first = port.days[0], last = port.days[port.days.length - 1];
    const timed = !!(first.from || last.to);
    const arrive = first.from ? portDate(first.date, first.from, port.tz) : null;
    const depart = last.to ? portDate(last.date, last.to, port.tz) : null;
    return { arrive, depart, timed,
      start: arrive || portDate(first.date, "00:00", port.tz),
      end: depart || portDate(last.date, "23:59", port.tz),
      allAboard: depart ? new Date(depart.getTime() - 30 * 60e3) : null,
      overnight: port.days.length > 1, disembark: !!port.disembark || (timed && !depart) };
  }
  // Which port to show: the one we're in, else the next one, else the last.
  function currentPort(ports, now) {
    for (const p of ports) {
      const c = portCall(p);
      if (now < c.end) return { port: p, state: now >= c.start ? "in" : "next" };
    }
    return { port: ports[ports.length - 1], state: "past" };
  }
  // Which voyage to open: the first one that hasn't finished yet.
  function currentVoyage(voyages, now) {
    for (const v of voyages) if (now < portCall(v.ports[v.ports.length - 1]).end) return v;
    return voyages[voyages.length - 1];
  }
  // Shops closed that day? → { sunday, holiday } (holiday = its name or null)
  function closedDay(country, dateStr) {
    return { sunday: dowOf(dateStr) === 0, holiday: (country.holidays || {})[dateStr] || null };
  }

  // ---- Sun --------------------------------------------------------------------------------------------------
  // NOAA solar position; returns the instants the sun crosses `alt` degrees on the port's calendar date.
  function sunEvents(dateStr, lat, lon, tz) {
    const [Y, M, D] = dateStr.split("-").map(Number);
    const noonUTC = Date.UTC(Y, M - 1, D, 12) - lon / 15 * 3600e3;
    function decEq(t) {
      const n = (t - Date.UTC(2000, 0, 1, 12)) / 864e5;
      const L = (280.460 + 0.9856474 * n) % 360, g = (357.528 + 0.9856003 * n) % 360 * R;
      const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * R, eps = (23.439 - 4e-7 * n) * R;
      const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
      let ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) / R;
      let eq = (L - ra); eq = ((eq + 540) % 360) - 180;   // degrees
      return { dec, eqMin: eq * 4 };
    }
    const s = decEq(noonUTC);
    const solarNoon = new Date(noonUTC - s.eqMin * 60e3);
    // Hour angle at the sun's declination for an instant; refined a few times because the declination
    // moves noticeably between noon and sunrise this far north.
    function cross(alt, sign) {
      let t = solarNoon.getTime();
      for (let i = 0; i < 4; i++) {
        const s2 = decEq(t);
        const c = (Math.sin(alt * R) - Math.sin(lat * R) * Math.sin(s2.dec)) / (Math.cos(lat * R) * Math.cos(s2.dec));
        if (c >= 1) return "never";
        if (c <= -1) return "always";
        const noonT = noonUTC - s2.eqMin * 60e3;
        t = noonT + sign * Math.acos(c) / R / 15 * 3600e3;
      }
      return new Date(t);
    }
    function at(alt) {
      const r = cross(alt, -1), st = cross(alt, 1);
      if (r === "never" || st === "never") return { never: true };
      if (r === "always" || st === "always") return { always: true };
      return { rise: r, set: st };
    }
    const noonAlt = 90 - Math.abs(lat - s.dec / R);
    return { noon: solarNoon, noonAlt, sun: at(-0.833), civil: at(-6) };
  }
  function daylightMinutes(ev) {
    if (ev.sun.never) return 0; if (ev.sun.always) return 1440;
    return Math.round((ev.sun.set - ev.sun.rise) / 60e3);
  }

  // ---- Opening hours (the common OpenStreetMap forms) ---------------------------------------------------------
  const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function daySet(s) {
    const out = new Set();
    for (const part of s.split(",")) {
      const m = part.trim().match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/);
      if (!m) return null;
      const a = DAYS.indexOf(m[1]), b = m[2] ? DAYS.indexOf(m[2]) : a;
      for (let i = a; ; i = (i + 1) % 7) { out.add(i); if (i === b) break; }
    }
    return out;
  }
  function monthSet(s) {
    const out = new Set();
    for (const part of s.split(",")) {
      const m = part.trim().match(/^([A-Z][a-z]{2})(?:-([A-Z][a-z]{2}))?$/);
      if (!m || MONTHS.indexOf(m[1]) < 0) return null;
      const a = MONTHS.indexOf(m[1]), b = m[2] ? MONTHS.indexOf(m[2]) : a;
      if (b < 0) return null;
      for (let i = a; ; i = (i + 1) % 12) { out.add(i + 1); if (i === b) break; }
    }
    return out;
  }
  function timeRanges(s) {
    const out = [];
    for (const part of s.split(",")) {
      const m = part.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\+?$/);
      if (!m) return null;
      out.push([+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]]);
    }
    return out;
  }
  // → { ranges: [[fromMin,toMin],...] } for that weekday/month, { closed: true }, or null when the text isn't understood.
  function hoursOn(text, dow, month) {
    if (!text) return null;
    const t = text.trim();
    if (t === "24/7") return { ranges: [[0, 1440]] };
    let result = null, understood = false;
    for (let rule of t.split(";")) {
      rule = rule.trim().replace(/"[^"]*"/g, "").trim();
      if (!rule) continue;
      if (/^(PH|SH)\b/.test(rule)) { understood = true; continue; }     // public/school holidays: not on our dates
      let months = null, days = null;
      let m = rule.match(/^((?:[A-Z][a-z]{2}(?:-[A-Z][a-z]{2})?)(?:,[A-Z][a-z]{2}(?:-[A-Z][a-z]{2})?)*)\s+(.*)$/);
      if (m && monthSet(m[1])) { months = monthSet(m[1]); rule = m[2]; }
      m = rule.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)(?:,PH)?\s*(.*)$/);
      if (m) { days = daySet(m[1]); rule = m[2].trim(); if (!days) return null; }
      if (/^(off|closed)$/i.test(rule)) {
        understood = true;
        if ((!days || days.has(dow)) && (!months || months.has(month))) result = { closed: true };
        continue;
      }
      const tr = timeRanges(rule);
      if (!tr) return null;
      understood = true;
      if ((!days || days.has(dow)) && (!months || months.has(month))) result = { ranges: tr };
    }
    if (!understood) return null;
    return result || { closed: true };
  }
  function fmtRanges(h) {
    if (!h) return "";
    if (h.closed) return "Closed";
    if (h.ranges.length === 1 && h.ranges[0][0] === 0 && h.ranges[0][1] >= 1440) return "Open 24 hours";
    const f = m => String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
    return h.ranges.map(r => f(r[0]) + "–" + f(r[1])).join(", ");
  }
  // Is it open during the time we're ashore that day? → "open" | "closed" | "outside" (opens but not while the ship is in) | null
  function openWhileAshore(h, fromMin, toMin) {
    if (!h) return null;
    if (h.closed) return "closed";
    for (const [a, b0] of h.ranges) { const b = b0 <= a ? b0 + 1440 : b0; if (a < toMin && b > fromMin) return "open"; }
    return "outside";
  }

  // ---- Temperatures, money ----------------------------------------------------------------------------------
  const fOf = c => Math.round(c * 9 / 5 + 32);
  function fmtTemp(c) { return fOf(c) + "°F (" + Math.round(c) + "°C)"; }
  function convert(amount, from, to, rates) {   // rates: per 1 USD
    const usd = from === "USD" ? amount : amount / rates[from];
    return to === "USD" ? usd : usd * rates[to];
  }
  function fmtMoney(v, cur) {
    const n = x => (x < 100 ? x.toFixed(2) : Math.round(x).toLocaleString("en-US"));
    if (cur === "EUR") return "€" + n(v);
    if (cur === "CHF") return "CHF " + n(v);
    if (cur === "USD") return "$" + (v < 100 ? v.toFixed(2) : Math.round(v).toLocaleString("en-US"));
    if (cur === "GBP") return "£" + (v < 100 ? v.toFixed(2) : Math.round(v).toLocaleString("en-US"));
    return (v < 100 ? v.toFixed(0 + (v < 10 ? 1 : 0)) : Math.round(v).toLocaleString("en-US")) + " kr";
  }

  const api = { km, walk, fmtMi, fmtMin, mapsLink, portDate, localParts, fmtClock, fmt12, dayLabel, dowOf, portCall, currentPort,
    currentVoyage, closedDay, sunEvents, daylightMinutes, hoursOn, fmtRanges, openWhileAshore, fOf, fmtTemp, convert, fmtMoney, DOW };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Port = api;
})(this);
