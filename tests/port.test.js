// Port Pocket Guide logic tests:  node tests/port.test.js
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const P = require("../port-guide/port.js");
const FACTS = JSON.parse(fs.readFileSync(path.join(__dirname, "../port-guide/data/ports.json"), "utf8"));
const placesFile = path.join(__dirname, "../port-guide/data/places.json");
const PLACES = fs.existsSync(placesFile) ? JSON.parse(fs.readFileSync(placesFile, "utf8")) : null;
const port = id => FACTS.ports.find(p => p.id === id);
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
  assert.strictEqual(P.currentPort(FACTS.ports, new Date("2026-11-01")).port.id, "tromso");
  const nk = P.currentPort(FACTS.ports, new Date("2027-02-04T10:00+01:00"));
  assert.deepStrictEqual([nk.port.id, nk.state], ["narvik", "in"]);
  const sea = P.currentPort(FACTS.ports, new Date("2027-02-05T12:00+01:00"));
  assert.deepStrictEqual([sea.port.id, sea.state], ["bergen", "next"]);
  assert.strictEqual(P.currentPort(FACTS.ports, new Date("2027-03-01")).state, "past");
});

test("the two Sunday port days are flagged", () => {
  const sundays = FACTS.ports.flatMap(p => p.days.filter(d => P.dowOf(d.date) === 0).map(d => p.id + " " + d.date));
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
  for (const p of FACTS.ports) {
    assert.ok(p.sources.length && p.piers.length && p.piers.some(x => x.primary), p.id);
    assert.ok(FACTS.countries[p.country].phrases.length >= 6);
    for (const s of p.sources) assert.ok(/^https:\/\//.test(s.url));
  }
});

if (PLACES) test("port data file: sights, hours, weather and rates for every port", () => {
  for (const p of FACTS.ports) {
    const d = PLACES.ports[p.id];
    assert.ok(d && d.sights.length >= 5, p.id + " has sights: " + (d && d.sights.length));
    assert.ok(d.practical.length >= 3, p.id + " has practical places");
    const c = PLACES.climate[p.id];
    assert.ok(c && c.hi > -15 && c.hi < 15 && c.lo < c.hi, p.id + " has typical weather");
  }
  assert.ok(PLACES.climate.tromso.hi < PLACES.climate.london.hi, "London is milder than Tromsø");
  const names = PLACES.ports.bergen.sights.map(s => s.name + " " + (s.local || "")).join("|");
  assert.ok(/Bryggen|Bergenhus|Fløyen|Fløibanen|Rosenkrantz|Håkon/i.test(names), "Bergen landmarks present");
  assert.ok(PLACES.rates && PLACES.rates.NOK > 5 && PLACES.rates.GBP < 1.5, "saved rates");
});

console.log(`\n${n} test groups passed`);
