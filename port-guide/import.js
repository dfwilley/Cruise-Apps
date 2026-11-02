/* Port Pocket Guide — adding your own cruises, and sorting map data for "Near me".
   Pure logic (no page access), shared by the web app, the iPhone app and the tests. Network calls take a `getJSON` function. */
(function (root) {
  const MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
  const MON_RE = "(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\\.?";
  const pad = n => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const validDate = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split("-").map(Number), t = new Date(Date.UTC(y, m - 1, d + n));
    return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }

  // ---- Dates and times inside a line of text ------------------------------------------------------------------
  // → { date: "YYYY-MM-DD" | null, md: [month, day] (when the year is missing), through: last day of a range, rest: the line without it }
  function findDate(line, year) {
    let m = line.match(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/);
    if (m && validDate(+m[1], +m[2], +m[3])) return { date: iso(+m[1], +m[2], +m[3]), rest: line.replace(m[0], " ") };
    m = line.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/);                      // US style: month/day[/year]
    if (m && +m[1] <= 12 && +m[2] <= 31) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null;
      return { y, md: [+m[1], +m[2]], rest: line.replace(m[0], " ") };
    }
    m = line.match(new RegExp("\\b" + MON_RE + "\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s*[-–—]\\s*(?:" + MON_RE + "\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b)?(?:,?\\s+(20\\d\\d))?", "i"));
    if (m && +m[2] >= 1 && +m[2] <= 31) {
      const mo = MONTHS[m[1].toLowerCase()], mo2 = m[3] ? MONTHS[m[3].toLowerCase()] : mo;
      return { y: m[5] ? +m[5] : null, md: [mo, +m[2]], md2: m[4] ? [mo2, +m[4]] : null, rest: line.replace(m[0], " ") };
    }
    m = line.match(new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+" + MON_RE + "(?:,?\\s+(20\\d\\d))?", "i"));
    if (m && +m[1] >= 1 && +m[1] <= 31) return { y: m[3] ? +m[3] : null, md: [MONTHS[m[2].toLowerCase()], +m[1]], rest: line.replace(m[0], " ") };
    return null;
  }
  // Clock times in order → ["08:00", "17:30"], plus the line with them taken out.
  function findTimes(line) {
    const out = [];
    const rest = line.replace(/\b(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?\s?m\.?(?![a-z])|\b([01]?\d|2[0-3])[:h]([0-5]\d)\b|\bnoon\b|\bmidnight\b/gi, (s, h12, m12, ap, h24, m24) => {
      if (/noon/i.test(s)) out.push("12:00");
      else if (/midnight/i.test(s)) out.push("23:59");
      else if (h12 != null) { let h = +h12 % 12; if (ap.toLowerCase() === "p") h += 12; if (+h12 <= 12) out.push(pad(h) + ":" + (m12 || "00")); }
      else out.push(pad(+h24) + ":" + m24);
      return " ";
    });
    return { times: out, rest };
  }

  const SEA = /\b(at sea|sea day|day at sea|days at sea|scenic|cruising|crossing|sailing (the|through|along)|transit)\b/i;
  const WEEKDAY = /\b(Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)(day|sday|nesday|rsday|urday)?\b\.?,?/gi;
  // The port's name from what's left of a line.
  function cleanPort(s) {
    return s.replace(/^\s*day\s*\d+\b/i, " ").replace(WEEKDAY, " ")
      .replace(/\b(arrives?|arrival|arriving|departs?|departure|departing|sails?|sailing|embark(ation)?|disembark(ation)?|all aboard|docked|docks|tender(ed)?|overnight|port of call|in port|ship|time|times|depart time|arrive time|local)\b:?/gi, " ")
      .replace(/[|•\t;]+/g, ",").replace(/\s*[-–—:]+\s*(?=,|$)/g, " ").replace(/^[\s,:\-–—]+|[\s,:\-–—.]+$/g, "")
      .replace(/\s*,\s*(,\s*)*/g, ", ").replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "").trim();
  }
  // "Arrive 12:00 PM  Depart —" → { from: "12:00", to: null }; works without the words too ("7:00 AM 5:00 PM").
  function labeledTimes(line) {
    const i = line.search(/\b(depart|departure|departs|sail|sails|all aboard)\b/i);
    if (i > 0 && /\barriv/i.test(line.slice(0, i))) return { from: findTimes(line.slice(0, i)).times[0] || null, to: findTimes(line.slice(i)).times[0] || null };
    if (i === 0 && !/\barriv/i.test(line)) return { from: null, to: findTimes(line).times[0] || null };
    const t = findTimes(line).times;
    return { from: t[0] || null, to: t[1] || null };
  }
  let COUNTRY_NAMES = null;
  function isCountry(s) {
    if (!COUNTRY_NAMES) {
      COUNTRY_NAMES = new Set(["england", "scotland", "wales", "northern ireland", "usa", "united states", "uk", "holland", "the netherlands", "czech republic"]);
      for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b); let n = null;
        try { n = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" }).of(code); } catch (e) {}
        if (n) COUNTRY_NAMES.add(n.toLowerCase());
      }
    }
    return COUNTRY_NAMES.has(String(s).toLowerCase().trim());
  }
  const looksLikePort = s => s && s.length <= 60 && s.split(/\s+/).length <= 8 && !/[.!?]$/.test(s) && /[A-Za-zÀ-ž]/.test(s) && !SEA.test(s);

  // ---- Pasted itineraries -----------------------------------------------------------------------------------
  /* Accepts most copy-and-paste itineraries, one port per line:
       "May 4, 2027  Basel, Switzerland"         "2027-05-04, Basel, 08:00, 18:00"
       "Sat, Jan 30   Tromsø, Norway   12:00 PM   11:00 PM"
       "Day 3  Strasbourg"  (dates counted from the start date)   and the Viking-site layout where "Day 3" is on its own line.
     opts: { start: "YYYY-MM-DD" for Day N lines, today: Date to guess a missing year }
     → { rows: [{ date, port, from, to, note }], skipped: [lines that looked like days but had no port] } */
  function parseItinerary(text, opts) {
    opts = opts || {};
    const today = opts.today || new Date();
    const lines = String(text || "").replace(/\r/g, "").split("\n").map(l => l.trim());
    const rows = [], skipped = [];
    let pending = null, lastDate = null, yearHint = null;
    for (const l of lines) { const m = l.match(/\b(20\d\d)\b/); if (m) { yearHint = +m[1]; break; } }
    if (opts.start) yearHint = +opts.start.slice(0, 4);
    function resolve(f) {      // a found date → "YYYY-MM-DD", guessing the year from the previous line or the trip
      if (f.date) return f.date;
      let y = f.y || (lastDate ? +lastDate.slice(0, 4) : yearHint);
      if (!y) { y = today.getFullYear(); if (iso(y, f.md[0], f.md[1]) < iso(y, today.getMonth() + 1, today.getDate())) y++; }
      let d = iso(y, f.md[0], f.md[1]);
      if (!f.y && lastDate && d < addDays(lastDate, -1)) d = iso(y + 1, f.md[0], f.md[1]);   // crossed New Year
      return validDate(+d.slice(0, 4), f.md[0], f.md[1]) ? d : null;
    }
    function note(s) { return /disembark/i.test(s) ? "Disembarkation day" : /\bembark/i.test(s) ? "Embarkation day" : null; }
    // Spreadsheet-style lines keep their columns: "2027-09-10,Barcelona,Spain,,17:00" has no arrival time, only a departure.
    function columns(raw) {
      const f = raw.split(/\t|,/).map(x => x.trim());
      if (f.length < 4) return null;
      const slots = [];
      for (let i = f.length - 1; i >= 0 && slots.length < 2; i--) {
        if (f[i] === "" || f[i] === "-" || f[i] === "—") slots.unshift(null);
        else { const t = findTimes(f[i]); if (t.times.length === 1 && !t.rest.trim()) slots.unshift(t.times[0]); else break; }
      }
      return slots.length === 2 && slots.some(Boolean) ? slots : null;
    }
    let lastLine = -9;   // index of the line that added the last row, to pick up a country or times on the next line
    function push(date, port, times, raw, through) {
      const n = note(raw), t = times.slice(0, 2), cols = columns(raw);
      let from = t[0] || null, to = t[1] || null;
      if (cols) [from, to] = cols;
      else if (/\barriv/i.test(raw) && /\b(depart|sail)/i.test(raw)) ({ from, to } = labeledTimes(raw));
      else if (t.length === 1 && /disembark|arriv/i.test(raw)) { /* an arrival */ }
      else if (t.length === 1 && /(depart|sail|leav|all aboard|embark)/i.test(raw)) { to = from; from = null; }
      rows.push({ date, port, from, to, note: n }); lastLine = li;
      if (through) for (let d = addDays(date, 1); d <= through; d = addDays(d, 1)) rows.push({ date: d, port, from: null, to: null, note: null });
      lastDate = through || date;
    }
    let li = -1;
    for (const raw of lines) {
      li++;
      if (!raw) continue;
      const prev = rows[rows.length - 1];
      if (prev && li - lastLine <= 2 && !/^days?\s*\d/i.test(raw) && !findDate(raw)) {
        if (isCountry(raw) && !prev.port.includes(",")) { prev.port += ", " + raw; lastLine = li; continue; }   // "Basel" / "Switzerland"
        const ft = findTimes(raw);
        if (ft.times.length && !cleanPort(ft.rest) && !prev.from && !prev.to) { const t = labeledTimes(raw); prev.from = t.from; prev.to = t.to; lastLine = li; continue; }
      }
      const day = raw.match(/^days?\s*(\d{1,2})(?:\s*(?:-|–|—|&|and|to)\s*(\d{1,2}))?\b/i);
      const f = findDate(raw, yearHint);
      let date = f ? resolve(f) : null;
      let dayThrough = null;
      if (!date && day && opts.start) { date = addDays(opts.start, +day[1] - 1); if (day[2] && +day[2] > +day[1]) dayThrough = addDays(opts.start, +day[2] - 1); }
      if (!date && day && pending && pending.date && !pending.port) continue;   // "Thursday - Jun 3, 2027" then "Day 1": keep the date
      if (date) {
        const through = f && f.md2 ? resolve({ y: f.y || +date.slice(0, 4), md: f.md2 }) : dayThrough;
        const { times, rest } = findTimes(f ? f.rest : raw.replace(/^days?\s*\d{1,2}(?:\s*(?:-|–|—|&|and|to)\s*\d{1,2})?\b:?/i, " "));
        const port = cleanPort(rest);
        if (SEA.test(raw) && !looksLikePort(port.replace(SEA, "").trim())) { pending = null; lastDate = date; continue; }
        if (looksLikePort(port)) { push(date, port, times, raw, through && through > date ? through : null); pending = null; }
        else pending = { date, times, raw, through };
        continue;
      }
      if (day) { pending = opts.start ? null : { date: null, times: [], raw, day: +day[1] }; if (!opts.start) skipped.push(raw); continue; }
      if (pending && pending.date) {              // a date or "Day N" line, then the port on the next line
        if (SEA.test(raw)) { pending = null; continue; }
        const { times, rest } = findTimes(raw), port = cleanPort(rest);
        if (looksLikePort(port)) { push(pending.date, port, pending.times.concat(times), pending.raw + " " + raw, pending.through); pending = null; }
      }
    }
    return { rows: rows.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0), skipped: opts.start ? [] : skipped };
  }

  // ---- Calendar files (.ics) — e.g. exported from a booking or a travel app ----------------------------------
  function parseICS(text) {
    const lines = String(text || "").replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
    const events = []; let ev = null;
    for (const l of lines) {
      if (l === "BEGIN:VEVENT") ev = {};
      else if (l === "END:VEVENT") { if (ev) events.push(ev); ev = null; }
      else if (ev) {
        const i = l.indexOf(":"); if (i < 0) continue;
        const key = l.slice(0, i), val = l.slice(i + 1).replace(/\\,/g, ",").replace(/\\n/gi, " ").replace(/\\;/g, ";");
        const name = key.split(";")[0];
        if (name === "DTSTART" || name === "DTEND") ev[name] = { val, allDay: /VALUE=DATE(?!-)/.test(key) || /^\d{8}$/.test(val) };
        else if (name === "SUMMARY" || name === "LOCATION") ev[name] = val;
      }
    }
    const rows = [];
    const dt = v => { const m = v.val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(?:\d{2})?)?(Z)?/); return m && { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? m[4] + ":" + m[5] : null, utc: !!m[6], iso: m[4] ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z` : null }; };
    for (const e of events) {
      if (!e.DTSTART) continue;
      const label = (e.LOCATION || e.SUMMARY || "").trim();
      if (!label || (SEA.test(e.SUMMARY || "") && !e.LOCATION)) continue;
      const port = cleanPort(label.replace(/^(port|arrive|arrival|visit)\s*(in|at)?:?\s*/i, ""));
      if (!looksLikePort(port)) continue;
      const s = dt(e.DTSTART), en = e.DTEND ? dt(e.DTEND) : null;
      if (!s) continue;
      if (e.DTSTART.allDay) {
        const last = en ? addDays(en.date, -1) : s.date;
        for (let d = s.date; d <= (last < s.date ? s.date : last); d = addDays(d, 1)) rows.push({ date: d, port, from: null, to: null, note: null });
      } else {
        const r = { date: s.date, port, from: s.utc ? null : s.time, to: null, note: null };
        if (s.utc) r.fromUTC = s.iso;
        if (en && en.date === s.date) { if (en.utc) r.toUTC = en.iso; else r.to = en.time; rows.push(r); }
        else if (en) {
          rows.push(r);
          for (let d = addDays(s.date, 1); d < en.date; d = addDays(d, 1)) rows.push({ date: d, port, from: null, to: null, note: null });
          rows.push(en.utc ? { date: en.date, port, from: null, to: null, toUTC: en.iso, note: null } : { date: en.date, port, from: null, to: en.time, note: null });
        } else rows.push(r);
      }
    }
    return { rows: rows.sort((a, b) => a.date < b.date ? -1 : 1), skipped: [] };
  }
  function parseAny(text, opts) { return /BEGIN:VCALENDAR/.test(text) ? parseICS(text) : parseItinerary(text, opts); }

  // ---- A whole web page (Viking's site, My Viking Journey, or a travel agent's copy) --------------------------------
  // Pages split headings over several lines ("Day" / "1" / "Basel") and mix in prices and departure lists.
  // → { rows, skipped, departures: [{ date, ship }], ship, title, hasDays }
  const NOT_SHIPS = /^Viking (River|Rivers|Ocean|Oceans|Expedition|Expeditions|Cruises?|Journey|Explorer|Way|Air|Longships?|Homeport|Today|Daily|Society|Savings|Card|Destinations|Culture|Resident|Art|Kitchen|Credit|Voyages?|Mississippi|Holdings)\b/;
  function parsePage(text, opts) {
    opts = opts || {};
    const raw = String(text || "").replace(/\r/g, "").split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    const lines = [];
    for (let i = 0; i < raw.length; i++) {      // join "Day" + "1" (+ "Basel") into one heading
      if (/^days?$/i.test(raw[i]) && /^\d{1,2}(\s*[-–]\s*\d{1,2})?$/.test(raw[i + 1] || "")) { lines.push(raw[i] + " " + raw[i + 1]); i++; }
      else lines.push(raw[i]);
    }
    const ships = {};
    for (const l of lines) for (const m of l.matchAll(/\bViking [A-Z][a-zæøåäöüé]{2,}\b/g)) if (!NOT_SHIPS.test(m[0])) ships[m[0]] = (ships[m[0]] || 0) + 1;
    const ship = Object.keys(ships).sort((a, b) => ships[b] - ships[a])[0] || null;
    // The day-by-day part: from the first "Day 1" (or the first dated port line) to where the page moves on.
    let a = lines.findIndex(l => /^day\s*0?1\b/i.test(l));
    const STOP = /^(dates (&|and) pric|pricing|dates$|choose your|select (a|your) (date|departure)|what'?s included|included features|ship details|deck plans?|pre[- ]?(&|and)? ?post|extensions?$|reviews?$|you may also like|similar (cruises|voyages)|footer|privacy)/i;
    let block = lines;
    if (a >= 0) {
      let b = lines.length;
      for (let i = a + 1; i < lines.length; i++) if (STOP.test(lines[i])) { b = i; break; }
      block = lines.slice(Math.max(0, a - 1), b).filter(l => !/[$€£]\s?\d|per person|\bfrom\s+us?\$/i.test(l));
    }
    const res = parseItinerary(block.join("\n"), opts);
    // Departure dates listed elsewhere on the page (for "Day 1, Day 2…" pages without dates).
    const deps = [], seen = new Set();
    const today = opts.today || new Date(), todayStr = iso(today.getFullYear(), today.getMonth() + 1, today.getDate());
    lines.forEach((l, i) => {
      if (a >= 0 && i >= a && block.includes(l)) return;
      const f = findDate(l);
      if (!f || (!f.date && !f.y)) return;      // a departure list always shows the year
      const d = f.date || iso(f.y, f.md[0], f.md[1]);
      if (!validDate(+d.slice(0, 4), +d.slice(5, 7), +d.slice(8)) || d < todayStr || seen.has(d)) return;
      seen.add(d);
      const near = (l + " " + (lines[i + 1] || "") + " " + (lines[i - 1] || "")).match(/\bViking [A-Z][a-zæøåäöüé]{2,}\b/g) || [];
      deps.push({ date: d, ship: near.find(x => !NOT_SHIPS.test(x)) || null });
    });
    const title = (opts.title || "").split(/\s[|–-]\s/)[0].replace(/^(NEW!?|New:)\s*/i, "").trim();
    return Object.assign(res, { departures: deps.sort((x, y) => x.date < y.date ? -1 : 1).slice(0, 80), ship, title, hasDays: a >= 0 });
  }

  // Consecutive days in the same port become one port call (an overnight).
  function groupRows(rows) {
    const ports = [];
    const key = s => s.toLowerCase().replace(/\(.*?\)/g, "").split(",")[0].trim();
    for (const r of rows.filter(r => r.date && r.port).sort((a, b) => a.date < b.date ? -1 : 1)) {
      const last = ports[ports.length - 1];
      if (last && key(last.name) === key(r.port) && r.date <= addDays(last.days[last.days.length - 1].date, 1)) {
        if (last.days.some(d => d.date === r.date)) { const d = last.days.find(d => d.date === r.date); d.to = r.to || d.to; d.toUTC = r.toUTC || d.toUTC; continue; }
        last.days.push({ date: r.date, from: r.from || null, to: r.to || null, fromUTC: r.fromUTC, toUTC: r.toUTC, note: r.note || undefined });
      } else ports.push({ name: r.port, days: [{ date: r.date, from: r.from || null, to: r.to || null, fromUTC: r.fromUTC, toUTC: r.toUTC, note: r.note || undefined }] });
    }
    return ports;
  }

  // ---- Time zones -------------------------------------------------------------------------------------------
  function tzOffset(zone, dateStr) {      // hours from UTC on that date, e.g. Europe/Zurich in May → 2
    try {
      const at = new Date(dateStr + "T12:00:00Z");
      const s = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(at).find(p => p.type === "timeZoneName").value;
      const m = s.match(/GMT([+-])(\d{2}):?(\d{2})?/);
      return m ? (m[1] === "-" ? -1 : 1) * (+m[2] + (+m[3] || 0) / 60) : 0;
    } catch (e) { return null; }
  }
  function utcToLocal(isoStr, tz) {       // "2027-05-04T06:00:00Z", 2 → "08:00"
    const d = new Date(new Date(isoStr).getTime() + tz * 3600e3);
    return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
  }

  // ---- Countries: name, money and a few phrases for places outside the built-in guide -------------------------
  const CURRENCY = { AD: "EUR", AE: "AED", AG: "XCD", AR: "ARS", AT: "EUR", AU: "AUD", AW: "AWG", BB: "BBD", BE: "EUR", BG: "BGN", BM: "BMD", BR: "BRL", BS: "BSD",
    BZ: "BZD", CA: "CAD", CH: "CHF", CL: "CLP", CN: "CNY", CO: "COP", CR: "CRC", CU: "CUP", CW: "ANG", CY: "EUR", CZ: "CZK", DE: "EUR", DK: "DKK", DM: "XCD",
    DO: "DOP", EC: "USD", EE: "EUR", EG: "EGP", ES: "EUR", FI: "EUR", FJ: "FJD", FO: "DKK", FR: "EUR", GB: "GBP", GD: "XCD", GI: "GIP", GL: "DKK", GR: "EUR",
    GT: "GTQ", HK: "HKD", HN: "HNL", HR: "EUR", HU: "HUF", ID: "IDR", IE: "EUR", IL: "ILS", IN: "INR", IS: "ISK", IT: "EUR", JM: "JMD", JP: "JPY", KN: "XCD",
    KR: "KRW", KY: "KYD", LC: "XCD", LT: "EUR", LU: "EUR", LV: "EUR", MA: "MAD", MC: "EUR", ME: "EUR", MT: "EUR", MX: "MXN", MY: "MYR", NL: "EUR", NO: "NOK",
    NZ: "NZD", PA: "USD", PE: "PEN", PF: "XPF", PH: "PHP", PL: "PLN", PR: "USD", PT: "EUR", RO: "RON", RS: "RSD", SE: "SEK", SG: "SGD", SI: "EUR", SK: "EUR",
    SX: "ANG", TC: "USD", TH: "THB", TR: "TRY", TT: "TTD", TW: "TWD", US: "USD", UY: "UYU", VC: "XCD", VG: "USD", VI: "USD", VN: "VND", ZA: "ZAR" };
  // Currencies the free exchange-rate service (ECB via Frankfurter) covers.
  const RATED = ["AUD", "BGN", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR",
    "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "ZAR"];
  const LANG = { ES: "es", MX: "es", AR: "es", CL: "es", CO: "es", PE: "es", UY: "es", CR: "es", PA: "es", DO: "es", GT: "es", HN: "es", EC: "es", CU: "es",
    IT: "it", MT: "it", PT: "pt", BR: "pt", NL: "nl", BE: "nl", CW: "nl", AW: "nl", SX: "nl", GR: "el", CY: "el", DK: "da", FO: "da", SE: "sv", IS: "is", HR: "hr", ME: "hr",
    EE: "et", AT: "de", LU: "fr", MC: "fr", CA: "fr", PF: "fr" };
  const PHRASES = {
    es: [["Hello", "Hola", "OH-lah"], ["Thank you", "Gracias", "GRAH-syahs"], ["Please", "Por favor", "por fah-VOR"], ["Excuse me", "Perdón", "pehr-DOHN"],
      ["Do you speak English?", "¿Habla inglés?", "AH-blah een-GLEHS"], ["The bill, please", "La cuenta, por favor", "lah KWEN-tah por fah-VOR"]],
    it: [["Good day / hello", "Buongiorno", "bwon-JOR-noh"], ["Thank you", "Grazie", "GRAHT-tsyeh"], ["Please", "Per favore", "pehr fah-VOH-reh"], ["Excuse me", "Mi scusi", "mee SKOO-zee"],
      ["Do you speak English?", "Parla inglese?", "PAR-lah een-GLEH-zeh"], ["The bill, please", "Il conto, per favore", "eel KOHN-toh pehr fah-VOH-reh"]],
    pt: [["Good day / hello", "Bom dia", "bohn DEE-ah"], ["Thank you", "Obrigado (a man) / Obrigada (a woman)", "oh-bree-GAH-doo / -dah"], ["Please", "Por favor", "poor fah-VOR"],
      ["Excuse me", "Com licença", "kohn lee-SEN-sah"], ["Do you speak English?", "Fala inglês?", "FAH-lah een-GLAYSH"], ["The bill, please", "A conta, por favor", "ah KOHN-tah poor fah-VOR"]],
    nl: [["Good day / hello", "Goedendag", "KHOO-den-dahkh"], ["Thank you", "Dank u wel", "dahnk ew vel"], ["Please", "Alstublieft", "AHL-stew-bleeft"], ["Excuse me", "Pardon", "par-DON"],
      ["Do you speak English?", "Spreekt u Engels?", "spraykt ew ENG-els"], ["The bill, please", "De rekening, alstublieft", "deh RAY-ke-ning AHL-stew-bleeft"]],
    el: [["Hello", "Γειά σας (Yiá sas)", "YAH-sahs"], ["Thank you", "Ευχαριστώ (Efcharistó)", "ef-kha-ree-STOH"], ["Please", "Παρακαλώ (Parakaló)", "pah-rah-kah-LOH"],
      ["Excuse me", "Συγγνώμη (Signómi)", "seegh-NOH-mee"], ["Do you speak English?", "Μιλάτε αγγλικά; (Miláte angliká?)", "mee-LAH-teh ahn-glee-KAH"], ["The bill, please", "Τον λογαριασμό, παρακαλώ", "tohn loh-ghahr-yahz-MOH pah-rah-kah-LOH"]],
    da: [["Good day / hello", "Goddag", "go-DAY"], ["Thank you", "Tak", "tahk"], ["Excuse me", "Undskyld", "OON-skewl"], ["Do you speak English?", "Taler du engelsk?", "TAY-ler doo ENG-elsk"],
      ["The bill, please", "Regningen, tak", "RYE-ning-en tahk"]],
    sv: [["Hello", "Hej", "hey"], ["Thank you", "Tack", "tahk"], ["Excuse me", "Ursäkta", "OOR-shek-tah"], ["Do you speak English?", "Talar du engelska?", "TAH-lar doo ENG-el-skah"],
      ["The bill, please", "Notan, tack", "NOO-tahn tahk"]],
    is: [["Good day / hello", "Góðan daginn", "GOH-than DIE-in"], ["Thank you", "Takk", "tahk"], ["Excuse me", "Afsakið", "AHF-sah-kith"], ["Do you speak English?", "Talar þú ensku?", "TAH-lar thoo EN-skoo"],
      ["The bill, please", "Reikninginn, takk", "RAYK-ning-in tahk"]],
    hr: [["Good day / hello", "Dobar dan", "DOH-bar dahn"], ["Thank you", "Hvala", "HVAH-lah"], ["Please", "Molim", "MOH-leem"], ["Excuse me", "Oprostite", "oh-PROH-stee-teh"],
      ["Do you speak English?", "Govorite li engleski?", "GOH-voh-ree-teh lee EN-gleh-skee"], ["The bill, please", "Račun, molim", "RAH-choon MOH-leem"]],
    et: [["Hello", "Tere", "TEH-reh"], ["Thank you", "Aitäh", "EYE-tah"], ["Please", "Palun", "PAH-loon"], ["Excuse me", "Vabandust", "VAH-bahn-doost"],
      ["The bill, please", "Arve, palun", "AR-veh PAH-loon"]]
  };
  const SPEECH = { es: "es-ES", it: "it-IT", pt: "pt-PT", nl: "nl-NL", el: "el-GR", da: "da-DK", sv: "sv-SE", is: "is-IS", hr: "hr-HR", et: "et-EE", de: "de-DE", fr: "fr-FR" };
  const LANG_NAME = { es: "Spanish", it: "Italian", pt: "Portuguese", nl: "Dutch", el: "Greek", da: "Danish", sv: "Swedish", is: "Icelandic", hr: "Croatian", et: "Estonian", de: "German", fr: "French" };
  function displayName(code, type) { try { return new Intl.DisplayNames(["en"], { type }).of(code); } catch (e) { return code; } }
  // A country entry with the same fields as the built-in ones. `known` = the built-in countries, to borrow German/French phrases.
  function makeCountry(code, known) {
    code = String(code || "").toUpperCase();
    const cur = CURRENCY[code] || "USD", lang = LANG[code];
    const borrowed = lang === "de" && known && known.DE ? known.DE.phrases : lang === "fr" && known && known.FR ? known.FR.phrases : null;
    const phrases = borrowed ? borrowed.slice() : (PHRASES[lang] || []).map(([en, local, say]) => ({ en, local, say, lang: SPEECH[lang] }));
    const curName = displayName(cur, "currency");
    return {
      name: displayName(code, "region"), currency: cur, currencyName: curName, currencyPlural: curName,
      symbol: "", language: LANG_NAME[lang] || null,
      money: cur === "USD" ? "US dollars are the local money here." : "Cards and Apple Pay are widely taken in most cruise ports; carry a little local cash for small shops, markets and restrooms.",
      tipping: "Customs vary by country — the ship's port talk and daily program cover local tipping.",
      sunday: "Some shops keep shorter hours or close on Sundays and public holidays — check the hours shown for each place.",
      hours: "Opening hours vary — each place under Sights and Near me shows its hours when the map has them.",
      winter: "Check the typical weather above and the forecast in the last two weeks before the port day.",
      holidays: {}, phrases, sources: [], imported: true
    };
  }

  // ---- Typical weather from Open-Meteo history: days within a week of the port date --------------------------------
  function climateFrom(daily, dateStr) {
    const mmdd = dateStr.slice(5), idx = [];
    daily.time.forEach((s, i) => {
      for (const y of [+s.slice(0, 4) - 1, +s.slice(0, 4), +s.slice(0, 4) + 1]) {
        const ref = y + "-" + mmdd;
        if (!validDate(y, +mmdd.slice(0, 2), +mmdd.slice(3))) continue;
        if (Math.abs((Date.parse(s) - Date.parse(ref)) / 864e5) <= 7) { idx.push(i); break; }
      }
    });
    const vals = k => idx.map(i => daily[k] && daily[k][i]).filter(v => v != null);
    const hi = vals("temperature_2m_max"), lo = vals("temperature_2m_min"), pr = vals("precipitation_sum"), sn = vals("snowfall_sum"), gu = vals("wind_gusts_10m_max");
    if (!hi.length || !lo.length) return null;
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length, r1 = v => Math.round(v * 10) / 10;
    const sorted = lo.slice().sort((a, b) => a - b), years = daily.time.map(s => s.slice(0, 4));
    return { days: idx.length, years: years[0] + "–" + years[years.length - 1], hi: r1(mean(hi)), lo: r1(mean(lo)), coldLo: r1(sorted[Math.floor(sorted.length / 10)]),
      wetPct: pr.length ? Math.round(100 * pr.filter(v => v >= 1).length / pr.length) : 0, snowPct: sn.length ? Math.round(100 * sn.filter(v => v >= 1).length / sn.length) : 0,
      gust: gu.length ? Math.round(mean(gu)) : 0 };
  }

  // ---- OpenStreetMap: what kind of place is this? ------------------------------------------------------------------
  const FOOD = { cafe: "café", restaurant: "restaurant", ice_cream: "ice cream", pub: "pub", biergarten: "beer garden", bar: "bar", fast_food: "snacks",
    bakery: "bakery", pastry: "pastry shop", wine: "wine shop", chocolate: "chocolate shop", confectionery: "sweet shop" };
  const SHOP = { mall: "shopping centre", department_store: "department store", gift: "gift shop", souvenir: "souvenirs", books: "bookshop", outdoor: "outdoor gear",
    supermarket: "groceries", convenience: "groceries", clothes: "clothing", jewelry: "jewelry", art: "art shop", antiques: "antiques", marketplace: "market" };
  const HANDY = { toilets: "toilets", atm: "cash", bank: "cash", bureau_de_change: "money exchange", pharmacy: "pharmacy", taxi: "taxi", information: "tourist info", station: "train station",
    ferry_terminal: "ferry", hospital: "hospital", post_office: "post office" };
  // → { g: "sight" | "food" | "shop" | "handy", kind, label } or null
  function classify(t) {
    if (!t || !t.name) return null;
    if (t.amenity && FOOD[t.amenity]) return { g: "food", kind: t.amenity, label: FOOD[t.amenity] };
    if (t.shop && FOOD[t.shop]) return { g: "food", kind: t.shop, label: FOOD[t.shop] };
    if (t.tourism === "museum") return { g: "sight", kind: t.museum === "aviation" || t.subject === "aviation" ? "air museum" : "museum", label: t.museum === "aviation" ? "aviation museum" : "museum" };
    if (t.tourism === "gallery") return { g: "sight", kind: "gallery", label: "gallery" };
    if (t.tourism === "viewpoint") return { g: "sight", kind: "viewpoint", label: "viewpoint" };
    if (t.tourism === "zoo" || t.tourism === "aquarium" || t.tourism === "theme_park") return { g: "sight", kind: "attraction", label: t.tourism.replace("_", " ") };
    if (t.historic === "aircraft" || t.historic === "ship" || t.historic === "locomotive") return { g: "sight", kind: "historic", label: "historic " + t.historic };
    if (t.amenity === "place_of_worship" || t.historic === "church" || t.building === "cathedral") return { g: "sight", kind: "church", label: t.building === "cathedral" ? "cathedral" : "church" };
    if (t.historic) return { g: "sight", kind: "historic", label: t.historic.replace(/_/g, " ") };
    if (t.tourism === "attraction") return { g: "sight", kind: "attraction", label: "attraction" };
    if (t.leisure === "park" || t.leisure === "garden" || t.leisure === "nature_reserve" || t.boundary === "national_park") return { g: "sight", kind: "park", label: (t.leisure || "national park").replace("_", " ") };
    if (t.shop && SHOP[t.shop]) return { g: "shop", kind: t.shop === "supermarket" || t.shop === "convenience" ? "groceries" : "shop", label: SHOP[t.shop] };
    if (t.amenity === "marketplace") return { g: "shop", kind: "shop", label: "market" };
    if (t.amenity && HANDY[t.amenity]) return { g: "handy", kind: HANDY[t.amenity], label: HANDY[t.amenity] };
    if (t.tourism === "information") return { g: "handy", kind: "tourist info", label: "tourist info" };
    if (t.railway === "station" || t.public_transport === "station" && t.train === "yes") return { g: "handy", kind: "train station", label: "train station" };
    return null;
  }
  // Overpass query for places within `r` metres (food, shops and handy places within walking range only).
  function aroundQuery(lat, lon, r) {
    const w = Math.min(r, 1500), at = (m) => `(around:${m},${lat},${lon})`;
    return `[out:json][timeout:25];(
      nwr${at(w)}[amenity~"^(cafe|restaurant|ice_cream|pub|biergarten|bar|fast_food)$"][name];
      nwr${at(w)}[shop~"^(bakery|pastry|wine|chocolate|confectionery|mall|department_store|gift|souvenir|books|outdoor|supermarket|marketplace|antiques|art)$"][name];
      nwr${at(r)}[tourism~"^(museum|attraction|viewpoint|gallery|zoo|aquarium|theme_park)$"][name];
      nwr${at(r)}[historic~"^(castle|monument|ruins|city_gate|church|fort|archaeological_site|ship|aircraft|locomotive|manor|palace|tower|lighthouse)$"][name];
      nwr${at(r)}[leisure~"^(park|garden|nature_reserve)$"][name][wikidata];
      nwr${at(r)}[amenity=place_of_worship][name][wikidata];
      nwr${at(w)}[amenity~"^(toilets|atm|bank|bureau_de_change|pharmacy|taxi|marketplace|post_office)$"];
      nwr${at(w)}[tourism=information][information=office];
      nwr${at(r)}[railway=station][name];
    );out center tags 400;`;
  }
  // Overpass elements → places, nearest first, without repeats.
  function placesFrom(elements, lat, lon, km) {
    const seen = new Set(), out = [];
    for (const e of elements || []) {
      const t = e.tags || {}, la = e.lat != null ? e.lat : e.center && e.center.lat, lo = e.lon != null ? e.lon : e.center && e.center.lon;
      if (la == null) continue;
      const name = t["name:en"] || t.name || (t.amenity && HANDY[t.amenity] ? HANDY[t.amenity][0].toUpperCase() + HANDY[t.amenity].slice(1) : null);
      const c = classify(Object.assign({}, t, { name }));
      if (!c) continue;
      const key = name + "|" + c.kind + (c.g === "handy" ? "|" + la.toFixed(3) + lo.toFixed(3) : "");
      if (seen.has(key)) continue; seen.add(key);
      const p = { name, local: t["name:en"] && t.name !== t["name:en"] ? t.name : undefined, g: c.g, group: c.g === "sight" ? "sight" : "practical", kind: c.kind, label: c.label,
        lat: +la.toFixed(5), lon: +lo.toFixed(5), d: km(lat, lon, la, lo) };
      if (t.opening_hours) p.hours = t.opening_hours;
      if (t.website) p.website = t.website;
      if (t.wikidata) p.wikidata = t.wikidata;
      out.push(p);
    }
    return out.sort((a, b) => a.d - b.d);
  }
  // Wikipedia's nearby articles → notable places, skipping streets, stations and the like.
  const DULL = /\b(street|road|avenue|highway|motorway|railway station|train station|metro station|bus station|tram stop|bus stop|school|college|company|district|neighbou?rhood|suburb|borough|ward|quarter of|electoral|constituency|parish in|municipality|village in|census|apartment|office building|hotel|hospital|airport)\b/i;
  function notableFrom(pages, lat, lon, km) {
    return Object.values(pages || {}).filter(p => p.coordinates && p.coordinates[0])
      .map(p => ({ title: p.title, what: p.description || "", lat: p.coordinates[0].lat, lon: p.coordinates[0].lon, thumb: p.thumbnail && p.thumbnail.source,
        url: "https://en.m.wikipedia.org/?curid=" + p.pageid, d: km(lat, lon, p.coordinates[0].lat, p.coordinates[0].lon) }))
      .filter(p => p.what && !DULL.test(p.what) && !DULL.test(p.title) && !/^List of/i.test(p.title))
      .sort((a, b) => a.d - b.d);
  }

  // ---- Building a cruise from the checked itinerary ------------------------------------------------------------
  const slug = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "port";
  // Find a port: Open-Meteo's place search first (it also gives the time zone), then OpenStreetMap's.
  async function geocode(name, getJSON) {
    const parts = name.split(",").map(s => s.trim()).filter(Boolean);
    const hint = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : null;
    const base = parts[0], paren = (base.match(/\(([^)]+)\)/) || [])[1];
    const tries = [base.replace(/\s*\(.*?\)\s*/g, " ").trim(), paren].filter(Boolean);
    for (const q of tries) {
      try {
        const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=en&format=json`);
        const res = (j && j.results) || [];
        const ok = res.filter(r => !hint || (r.country || "").toLowerCase().includes(hint) || (r.country_code || "").toLowerCase() === hint
          || (r.admin1 || "").toLowerCase().includes(hint) || hint.includes((r.country || "~").toLowerCase()));
        const r = ok[0] || (!hint ? res[0] : null);
        if (r) return { lat: r.latitude, lon: r.longitude, country: (r.country_code || "").toUpperCase(), zone: r.timezone, label: [r.name, r.admin1, r.country].filter(Boolean).join(", ") };
      } catch (e) {}
    }
    try {
      const j = await getJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name.replace(/[()]/g, " "))}&format=jsonv2&limit=1&addressdetails=1&accept-language=en`);
      const r = j && j[0];
      if (r) {
        let zone = null;
        try { zone = (await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${r.lat}&longitude=${r.lon}&timezone=auto&forecast_days=1&daily=sunrise`)).timezone; } catch (e) {}
        return { lat: +r.lat, lon: +r.lon, country: ((r.address && r.address.country_code) || "").toUpperCase(), zone, label: r.display_name.split(",").slice(0, 3).join(",") };
      }
    } catch (e) {}
    return null;
  }
  // A port in the same shape as the built-in ones. `g` = geocode result.
  function makePort(voyageId, grouped, g, index) {
    const tz = tzOffset(g.zone || "UTC", grouped.days[0].date) || 0;
    const days = grouped.days.map(d => {
      const out = { date: d.date, from: d.from || (d.fromUTC ? utcToLocal(d.fromUTC, tz) : null), to: d.to || (d.toUTC ? utcToLocal(d.toUTC, tz) : null) };
      if (d.note) out.note = d.note;
      return out;
    });
    const name = grouped.name.split(",")[0].trim();
    return {
      id: voyageId + "-" + index + "-" + slug(name), name, country: g.country || "US", tz, zone: g.zone,
      days, center: { name: name + " centre", lat: g.lat, lon: g.lon }, area: { lat: g.lat, lon: g.lon, r: 5 },
      piers: [{ id: "centre", name: "Town centre (berth not known yet)", lat: g.lat, lon: g.lon, primary: true, walkFromPier: false,
        note: "Your itinerary doesn't say where the ship docks. When you're ashore, tap \"The ship is here\" on the dock to measure the walk back from the real berth." }],
      transport: "Check the daily program for the berth and any shuttle into town.",
      sources: [{ title: "Found on the map as: " + g.label, url: `https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lon}#map=14/${g.lat}/${g.lon}` }],
      ideas: [], imported: true
    };
  }
  function voyageDates(ports) {
    const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const a = ports[0].days[0].date, b = ports[ports.length - 1].days[ports[ports.length - 1].days.length - 1].date;
    const f = s => M[+s.slice(5, 7) - 1] + " " + +s.slice(8);
    return a.slice(0, 7) === b.slice(0, 7) ? f(a) + " – " + +b.slice(8) + ", " + b.slice(0, 4)
      : a.slice(0, 4) === b.slice(0, 4) ? f(a) + " – " + f(b) + ", " + b.slice(0, 4) : f(a) + ", " + a.slice(0, 4) + " – " + f(b) + ", " + b.slice(0, 4);
  }

  const api = { parseItinerary, parseICS, parseAny, parsePage, groupRows, findDate, findTimes, cleanPort, tzOffset, utcToLocal, makeCountry, climateFrom, classify,
    aroundQuery, placesFrom, notableFrom, geocode, makePort, voyageDates, slug, addDays, CURRENCY, RATED };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PortImport = api;
})(this);
