// Port Pocket Guide logic tests:  node tests/port.test.js
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const P = require("../port-guide/port.js");
const FACTS = JSON.parse(fs.readFileSync(path.join(__dirname, "../port-guide/data/ports.json"), "utf8"));
const placesFile = path.join(__dirname, "../port-guide/data/places.json");
const PLACES = fs.existsSync(placesFile) ? JSON.parse(fs.readFileSync(placesFile, "utf8")) : null;
const ALL = FACTS.voyages.flatMap(v => v.ports);
const NORWAY = FACTS.voyages.find(v => v.id === "norway").ports, RHINE = FACTS.voyages.find(v => v.id === "rhine").ports;
const port = id => ALL.find(p => p.id === id);
let n = 0;
function test(name, fn) { fn(); n++; console.log("ok -", name); }

test("port calls match Viking's itinerary times", () => {
  const t = P.portCall(port("tromso"));
  assert.strictEqual(t.arrive.toISOString(), "2027-01-30T11:00:00.000Z");
  assert.strictEqual(t.depart.toISOString(), "2027-01-31T22:00:00.000Z");
  assert.strictEqual(P.fmt12(t.allAboard, 1), "10:30 PM");
  assert.ok(t.overnight);
  const r = P.portCall(port("edinburgh"));
  assert.strictEqual(P.fmt12(r.arrive, 0), "7:00 AM");
  assert.strictEqual(P.fmt12(r.allAboard, 0), "3:30 PM");
  assert.ok(P.portCall(port("london")).disembark);
});

test("today's port: before the trip, in port, between ports, after", () => {
  assert.strictEqual(P.currentPort(NORWAY, new Date("2026-11-01")).port.id, "tromso");
  const nk = P.currentPort(NORWAY, new Date("2027-02-04T10:00+01:00"));
  assert.deepStrictEqual([nk.port.id, nk.state], ["narvik", "in"]);
  const sea = P.currentPort(NORWAY, new Date("2027-02-05T12:00+01:00"));
  assert.deepStrictEqual([sea.port.id, sea.state], ["bergen", "next"]);
  assert.strictEqual(P.currentPort(NORWAY, new Date("2027-03-01")).state, "past");
});

test("the two Sunday port days are flagged", () => {
  const sundays = NORWAY.flatMap(p => p.days.filter(d => P.dowOf(d.date) === 0).map(d => p.id + " " + d.date));
  assert.deepStrictEqual(sundays, ["tromso 2027-01-31", "bergen 2027-02-07"]);
});

test("sun times agree with published tables within a few minutes", () => {
  // WeatherSpark: Tromsø Jan 31 sunrise 9:32 AM, sunset 2:24 PM.
  const tr = P.sunEvents("2027-01-31", 69.6489, 18.9551, 1);
  const mins = (d, tz) => { const p = P.localParts(d, tz); return p.h * 60 + p.mi; };
  assert.ok(Math.abs(mins(tr.sun.rise, 1) - (9 * 60 + 32)) <= 4, "Tromsø sunrise " + P.fmtClock(tr.sun.rise, 1));
  assert.ok(Math.abs(mins(tr.sun.set, 1) - (14 * 60 + 24)) <= 4, "Tromsø sunset " + P.fmtClock(tr.sun.set, 1));
  // Bergen in early February: roughly 08:40 to 17:00.
  const bg = P.sunEvents("2027-02-06", 60.3946, 5.3252, 1);
  assert.ok(Math.abs(mins(bg.sun.rise, 1) - 520) <= 10 && Math.abs(mins(bg.sun.set, 1) - 1022) <= 10);
  // Daylight grows as we sail south.
  const dl = id => { const p = port(id); return P.daylightMinutes(P.sunEvents(p.days[0].date, p.center.lat, p.center.lon, p.tz)); };
  assert.ok(dl("tromso") < dl("narvik") && dl("narvik") < dl("bergen") && dl("bergen") < dl("london"));
  // Midwinter Tromsø: polar night.
  assert.ok(P.sunEvents("2026-12-21", 69.65, 18.96, 1).sun.never);
});

test("opening hours: common OpenStreetMap forms", () => {
  assert.deepStrictEqual(P.hoursOn("Mo-Fr 10:00-18:00; Sa 10:00-16:00; Su off", 0, 1), { closed: true });
  assert.deepStrictEqual(P.hoursOn("Mo-Fr 10:00-18:00; Sa 10:00-16:00; Su off", 6, 2), { ranges: [[600, 960]] });
  assert.deepStrictEqual(P.hoursOn("Jun-Aug Mo-Su 09:00-20:00; Sep-May Mo-Sa 11:00-15:00", 3, 2), { ranges: [[660, 900]] });
  assert.deepStrictEqual(P.hoursOn("Jun-Aug Mo-Su 09:00-20:00; Sep-May Mo-Sa 11:00-15:00", 0, 2), { closed: true });
  assert.deepStrictEqual(P.hoursOn("Mo-Su 09:00-17:00; PH off", 4, 2), { ranges: [[540, 1020]] });
  assert.deepStrictEqual(P.hoursOn("Tu-Su 11:00-16:00", 1, 2), { closed: true });
  assert.deepStrictEqual(P.hoursOn("24/7", 2, 2), { ranges: [[0, 1440]] });
  assert.deepStrictEqual(P.hoursOn("Mo,We,Fr 10:00-12:00,13:00-15:00", 3, 2), { ranges: [[600, 720], [780, 900]] });
  assert.strictEqual(P.hoursOn("sunrise-sunset", 1, 2), null);
  assert.strictEqual(P.hoursOn("by appointment", 1, 2), null);
  assert.strictEqual(P.openWhileAshore({ ranges: [[600, 960]] }, 780, 1380), "open");
  assert.strictEqual(P.openWhileAshore({ ranges: [[600, 720]] }, 780, 1380), "outside");
  assert.strictEqual(P.fmtRanges({ ranges: [[600, 1020]] }), "10:00–17:00");
});

test("walking estimates and distances", () => {
  // Bergen: Skolten to the Fish Market is about 900 m along Bryggen (Port of Bergen).
  const b = port("bergen"), sk = b.piers[0];
  const d = P.km(sk.lat, sk.lon, b.center.lat, b.center.lon);
  assert.ok(d > 0.5 && d < 1.0, "Skolten–Fish Market straight line " + d.toFixed(2));
  const w = P.walk(d);
  assert.ok(w.min >= 8 && w.min <= 16, "walk " + w.min + " min");
  // Harstad: Larsneset is 100–150 m from the centre.
  const h = port("harstad"); assert.ok(P.km(h.piers[0].lat, h.piers[0].lon, h.center.lat, h.center.lon) < 0.5);
  // Alta: Terminalkaia is about 4 km from town.
  const a = port("alta"); const ak = P.km(a.piers[0].lat, a.piers[0].lon, a.center.lat, a.center.lon);
  assert.ok(ak > 2 && ak < 5, "Alta quay " + ak.toFixed(1));   // straight line; 4 km by road
  assert.strictEqual(P.fmtMi(0.1), "550 ft");
  assert.strictEqual(P.fmtMi(1.24), "1.2 mi");
  assert.strictEqual(P.fmtMin(75), "1 h 15 min");
  assert.ok(P.mapsLink({ lat: 60.39, lon: 5.32, name: "Fløibanen" }, { lat: 60.4, lon: 5.31 }).startsWith("https://maps.apple.com/?daddr=60.39,5.32&dirflg=w&saddr=60.4,5.31"));
});

test("money", () => {
  const r = { NOK: 10.5, GBP: 0.75 };
  assert.strictEqual(Math.round(P.convert(105, "NOK", "USD", r)), 10);
  assert.strictEqual(P.convert(10, "USD", "GBP", r), 7.5);
  assert.strictEqual(P.fmtMoney(1234, "NOK"), "1,234 kr");
  assert.strictEqual(P.fmtMoney(7.5, "GBP"), "£7.50");
  assert.strictEqual(P.fmtTemp(-5), "23°F (-5°C)");
});

test("every port has sources, a pier and phrases for its country", () => {
  for (const p of ALL) {
    assert.ok(p.ideas && p.ideas.length >= 3, p.id + " has ideas");
    assert.ok(p.sources.length && p.piers.length && p.piers.some(x => x.primary), p.id);
    assert.ok(FACTS.countries[p.country].phrases.length >= 3);
    for (const s of p.sources) assert.ok(/^https:\/\//.test(s.url));
  }
});

if (PLACES) test("port data file: sights, hours, weather and rates for every port", () => {
  for (const p of ALL) {
    const d = PLACES.ports[p.id];
    assert.ok(d && d.sights.length >= 5, p.id + " has sights: " + (d && d.sights.length));
    assert.ok(d.practical.length >= 3, p.id + " has practical places");
    const c = PLACES.climate[p.id];
    assert.ok(c && c.hi > -15 && c.hi < 30 && c.lo < c.hi, p.id + " has typical weather");
  }
  assert.ok(PLACES.climate.tromso.hi < PLACES.climate.london.hi, "London is milder than Tromsø");
  const names = PLACES.ports.bergen.sights.map(s => s.name + " " + (s.local || "")).join("|");
  assert.ok(/Bryggen|Bergenhus|Fløyen|Fløibanen|Rosenkrantz|Håkon/i.test(names), "Bergen landmarks present");
  assert.ok(PLACES.rates && PLACES.rates.NOK > 5 && PLACES.rates.GBP < 1.5 && PLACES.rates.EUR < 1.5 && PLACES.rates.CHF < 1.5, "saved rates");
  assert.ok(PLACES.climate.basel.hi > 12 && PLACES.climate.basel.hi < 25, "Basel in May is mild");
  const nb = PLACES.ports.nuremberg.sights.map(s => s.name + " " + (s.local || "")).join("|");
  assert.ok(/Kaiserburg|Imperial Castle|Nuremberg Castle|Dürer/i.test(nb), "Nuremberg landmarks present");
});

test("river voyage: dates, untimed days, holidays and which voyage to open", () => {
  assert.deepStrictEqual(RHINE.map(p => p.id), ["basel", "breisach", "strasbourg", "karlsruhe", "frankfurt", "marktheidenfeld", "wurzburg", "bamberg", "nuremberg"]);
  assert.strictEqual(RHINE[0].days[0].date, "2027-05-04");
  assert.strictEqual(RHINE[RHINE.length - 1].days.slice(-1)[0].date, "2027-05-14");
  const b = P.portCall(port("basel"));
  assert.ok(!b.timed && b.allAboard === null && !b.disembark);
  assert.ok(P.portCall(port("nuremberg")).disembark);
  assert.strictEqual(P.currentPort(RHINE, new Date("2027-05-09T12:00+02:00")).port.id, "frankfurt");
  assert.strictEqual(P.currentPort(RHINE, new Date("2027-05-05T23:00+02:00")).port.id, "basel");
  assert.strictEqual(P.currentPort(RHINE, new Date("2027-05-06T00:30+02:00")).port.id, "breisach");
  assert.strictEqual(P.currentVoyage(FACTS.voyages, new Date("2026-11-01")).id, "norway");
  assert.strictEqual(P.currentVoyage(FACTS.voyages, new Date("2027-02-12")).id, "rhine");
  const C = FACTS.countries;
  assert.strictEqual(P.closedDay(C.DE, "2027-05-06").holiday.startsWith("Ascension"), true, "Breisach day is Ascension");
  assert.ok(P.closedDay(C.DE, "2027-05-09").sunday, "Frankfurt day is a Sunday");
  assert.strictEqual(P.closedDay(C.DE, "2027-05-11").holiday, null);
  // Walkable vs coach ports
  const walk = id => { const p = port(id), pr = p.piers[0]; return P.km(pr.lat, pr.lon, p.center.lat, p.center.lon); };
  assert.ok(walk("frankfurt") < 0.5 && walk("breisach") < 1 && walk("basel") < 1.5);
  assert.ok(walk("nuremberg") > 4 && walk("karlsruhe") > 5 && walk("strasbourg") > 2);
  for (const k of ["CH", "DE", "FR"]) assert.ok(C[k].phrases.length >= 3 && C[k].currencyPlural);
  assert.strictEqual(P.fmtMoney(12.5, "EUR"), "€12.50");
});

// ---- Adding your own cruises, and Near me ------------------------------------------------------------------
const I = require("../port-guide/import.js");
const rowsOf = (t, o) => I.parseAny(t, o).rows.map(r => [r.date, r.port, r.from, r.to]);

test("itinerary pasted from a cruise line: dates, times, sea days skipped, embark/disembark", () => {
  const r = rowsOf(`Sat, Jan 30, 2027   Tromsø, Norway   12:00 PM   11:00 PM
Feb 3 At Sea
Thu, Feb 4 Narvik, Norway 7:00am - 5:00pm
Feb 11 London (Tilbury), England 6:00 AM Disembark`);
  assert.deepStrictEqual(r, [["2027-01-30", "Tromsø, Norway", "12:00", "23:00"], ["2027-02-04", "Narvik, Norway", "07:00", "17:00"],
    ["2027-02-11", "London (Tilbury), England", "06:00", null]]);
});

test("spreadsheet lines keep their columns (an empty arrival stays empty)", () => {
  const r = rowsOf("Date,Port,Arrive,Depart\n2027-09-10,Barcelona,Spain,,17:00\n2027-09-11,At sea,,\n2027-09-12,Ajaccio,France,08:00,18:00");
  assert.deepStrictEqual(r, [["2027-09-10", "Barcelona, Spain", null, "17:00"], ["2027-09-12", "Ajaccio, France", "08:00", "18:00"]]);
});

test("Day 1 / Day 2 layout counts from the first day; descriptions and scenic cruising are ignored", () => {
  const t = "Day 1\nBasel\nEmbark your ship this afternoon. Enjoy a welcome dinner.\nDay 2\nBasel\nDay 3\nBreisach\nDay 5\nScenic Cruising: Middle Rhine\nDay 10\nNuremberg";
  const r = I.parseAny(t, { start: "2027-05-04" }).rows;
  assert.deepStrictEqual(r.map(x => x.date + " " + x.port), ["2027-05-04 Basel", "2027-05-05 Basel", "2027-05-06 Breisach", "2027-05-13 Nuremberg"]);
  assert.deepStrictEqual(I.groupRows(r).map(p => p.name + " " + p.days.length), ["Basel 2", "Breisach 1", "Nuremberg 1"]);
  assert.ok(I.parseAny(t, {}).skipped.length > 0, "without a first day it asks for one");
});

test("US dates without a year roll over New Year", () => {
  const r = rowsOf("12/28/2027 Miami, Florida 4:00 PM\n12/30 Cozumel, Mexico 7am 5pm\n1/1 Roatán, Honduras 8 AM 4 PM");
  assert.deepStrictEqual(r.map(x => x[0]), ["2027-12-28", "2027-12-30", "2028-01-01"]);
  assert.deepStrictEqual(r[1].slice(2), ["07:00", "17:00"]);
});

test("calendar files: local and UTC times, all-day sea days skipped", () => {
  const ics = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;TZID=Europe/Lisbon:20271005T080000\nDTEND;TZID=Europe/Lisbon:20271005T170000\nSUMMARY:Port: Lisbon\nLOCATION:Lisbon\\, Portugal\nEND:VEVENT\n"
    + "BEGIN:VEVENT\nDTSTART;VALUE=DATE:20271006\nDTEND;VALUE=DATE:20271007\nSUMMARY:Day at sea\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART:20271007T060000Z\nDTEND:20271007T160000Z\nSUMMARY:Cádiz\nEND:VEVENT\nEND:VCALENDAR";
  const r = I.parseAny(ics).rows;
  assert.deepStrictEqual(r.map(x => [x.date, x.port, x.from, x.to]), [["2027-10-05", "Lisbon, Portugal", "08:00", "17:00"], ["2027-10-07", "Cádiz", null, null]]);
  const p = I.makePort("t", I.groupRows(r)[1], { lat: 36.53, lon: -6.29, country: "ES", zone: "Europe/Madrid", label: "Cádiz" }, 2);
  assert.deepStrictEqual([p.tz, p.days[0].from, p.days[0].to], [2, "08:00", "18:00"]);
});

test("time zones and countries for added ports", () => {
  assert.strictEqual(I.tzOffset("Europe/Zurich", "2027-05-04"), 2);
  assert.strictEqual(I.tzOffset("Europe/Zurich", "2027-01-04"), 1);
  assert.strictEqual(I.tzOffset("America/Phoenix", "2027-07-04"), -7);
  const es = I.makeCountry("ES", FACTS.countries);
  assert.deepStrictEqual([es.name, es.currency, es.language], ["Spain", "EUR", "Spanish"]);
  assert.ok(es.phrases.length >= 5 && es.phrases.every(x => x.local && x.say && x.lang));
  assert.strictEqual(I.makeCountry("AT", FACTS.countries).phrases.length, FACTS.countries.DE.phrases.length, "Austria borrows the German phrases");
  assert.strictEqual(P.fmtMoney(1500, "JPY"), "¥1,500");
  assert.strictEqual(P.fmtMoney(12.5, "SEK"), "13 kr");
});

test("typical weather from a week either side of the date", () => {
  const time = [], mx = [], mn = [], pr = [];
  for (let y = 2021; y <= 2025; y++) for (let d = 1; d <= 30; d++) { time.push(`${y}-06-${String(d).padStart(2, "0")}`); mx.push(d <= 22 ? 25 : 40); mn.push(15); pr.push(d % 2 ? 2 : 0); }
  const c = I.climateFrom({ time, temperature_2m_max: mx, temperature_2m_min: mn, precipitation_sum: pr, snowfall_sum: pr.map(() => 0), wind_gusts_10m_max: pr.map(() => 20) }, "2027-06-10");
  assert.deepStrictEqual([c.days, c.hi, c.lo, c.years], [75, 25, 15, "2021–2025"]);
  assert.ok(c.wetPct > 40 && c.wetPct < 60);
});

test("Near me: map places sorted by distance and sorted into kinds; dull Wikipedia articles left out", () => {
  const els = [{ lat: 32.23, lon: -110.97, tags: { name: "Café", amenity: "cafe" } }, { lat: 32.2227, lon: -110.9748, tags: { amenity: "toilets" } },
    { lat: 32.24, lon: -110.96, tags: { name: "Air Museum", tourism: "museum", museum: "aviation" } }, { lat: 32.24, lon: -110.96, tags: { name: "Bench" } }];
  const ps = I.placesFrom(els, 32.2226, -110.9747, P.km);
  assert.deepStrictEqual(ps.map(p => p.g + ":" + p.kind), ["handy:toilets", "food:cafe", "sight:air museum"]);
  const nb = I.notableFrom({ 1: { pageid: 1, title: "Old Mission", description: "18th-century church", coordinates: [{ lat: 32.1, lon: -111 }] },
    2: { pageid: 2, title: "Main Street", description: "street in Tucson", coordinates: [{ lat: 32.2, lon: -111 }] } }, 32.2226, -110.9747, P.km);
  assert.deepStrictEqual(nb.map(n => n.title), ["Old Mission"]);
  assert.ok(/around:1500,/.test(I.aroundQuery(32, -110, 8000)) && /around:8000,/.test(I.aroundQuery(32, -110, 8000)), "food stays within walking range");
});

test("Viking's website: split Day headings, country lines, scenic sailing, departure list with ships", () => {
  const page = "Itinerary\nDay\n1\nBasel\nSwitzerland\nEmbark your ship and settle into your stateroom. Basel reflects a fascinating blend of traditions.\nDay\n2\nBasel\nSwitzerland\n"
    + "Day\n3\nBreisach\nGermany\nDay\n7\nScenic Sailing: Main River, Spessart\nDay\n10\nNuremberg\nGermany\nDisembark after breakfast.\nDates & Pricing\nMay 4, 2027\nViking Skirnir\nFrom $4,999\nMay 14, 2027\nViking Modi\nFrom $5,199";
  const today = new Date("2026-11-02");
  const a = I.parsePage(page, { today, title: "NEW! Rhine & Main Explorer | Viking River Cruises" });
  assert.deepStrictEqual([a.rows.length, a.hasDays, a.title], [0, true, "Rhine & Main Explorer"]);
  assert.deepStrictEqual(a.departures, [{ date: "2027-05-04", ship: "Viking Skirnir" }, { date: "2027-05-14", ship: "Viking Modi" }]);
  const b = I.parsePage(page, { today, start: "2027-05-04" });
  assert.deepStrictEqual(b.rows.map(r => r.date.slice(5) + " " + r.port), ["05-04 Basel, Switzerland", "05-05 Basel, Switzerland", "05-06 Breisach, Germany", "05-13 Nuremberg, Germany"]);
});

test("My Viking Journey style: dated days with arrive/depart on the next line; Days 2-3 ranges", () => {
  const r = I.parsePage("Day 1 Sat, Jan 30, 2027\nTromsø, Norway\nArrive 12:00 PM  Depart —\nDay 2 Sun, Jan 31, 2027\nTromsø, Norway\nArrive — Depart 11:00 PM\nDay 4 Feb 2, 2027\nAt Sea\nDay 5 Thu, Feb 4, 2027\nNarvik, Norway\n7:00 AM 5:00 PM",
    { today: new Date("2026-11-02") }).rows;
  assert.deepStrictEqual(r.map(x => [x.date, x.from, x.to]), [["2027-01-30", "12:00", null], ["2027-01-31", null, "23:00"], ["2027-02-04", "07:00", "17:00"]]);
  const g = I.parsePage("Day 1 Bergen, Norway\nDays 2-3 Flåm, Norway\nDay 4 At Sea\nDay 5 Stavanger", { start: "2027-06-01" }).rows;
  assert.deepStrictEqual(g.map(x => x.date.slice(5) + " " + x.port), ["06-01 Bergen, Norway", "06-02 Flåm, Norway", "06-03 Flåm, Norway", "06-05 Stavanger"]);
});

test("Near me searches: typed words → map tags; barbers listed before other hair salons; unknown words still search", () => {
  const b = I.findSearch("Barber shop");
  assert.deepStrictEqual([b.label, b.icon], ["Barber shop", "💈"]);
  assert.ok(I.searchQuery(b, 32.2, -110.9, 1600).includes("nwr(around:1600,32.2,-110.9)[shop=hairdresser];"));
  const r = I.searchResults([{ lat: 32.2236, lon: -110.9747, tags: { shop: "hairdresser", name: "Glamour Salon" } },
    { lat: 32.24, lon: -110.9747, tags: { shop: "hairdresser", name: "Joe's Barber Shop" } }], b, 32.2226, -110.9747, P.km);
  assert.deepStrictEqual(r.map(x => x.name + (x.pref ? " (barber)" : "")), ["Joe's Barber Shop (barber)", "Glamour Salon"]);
  for (const [t, label] of [["laundromat", "Laundry"], ["gas station", "Gas station"], ["restroom", "Restrooms"], ["RV parks", "RV parks & camping"]]) assert.strictEqual(I.findSearch(t).label, label);
  for (const t of I.SEARCH_SUGGESTIONS) assert.ok(!I.findSearch(t).generic, t);
  const g = I.findSearch("sushi");
  assert.ok(g.generic && g.filters.some(f => f.includes('name~"sushi"')));
});

console.log(`\n${n} test groups passed`);
