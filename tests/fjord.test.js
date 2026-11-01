// node tests/fjord.test.js — checks Fjord Spotter's logic.
const F = require("../fjord-spotter/fjord.js"), assert = require("assert"), fs = require("fs"), path = require("path");
const route = JSON.parse(fs.readFileSync(path.join(__dirname, "../fjord-spotter/data/route.json"), "utf8"));
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("✓", name); };
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ""} expected ${b} ±${tol}, got ${a}`);

ok("distances and bearings", () => {
  near(F.distanceKm({ lat: 69.648, lon: 18.955 }, { lat: 69.968, lon: 23.272 }), 172, 5, "Tromsø–Alta");
  near(F.bearing({ lat: 60, lon: 5 }, { lat: 61, lon: 5 }), 0, 0.01); near(F.bearing({ lat: 60, lon: 5 }, { lat: 60, lon: 6 }), 89.6, 0.5);
  assert.equal(F.angleDiff(350, 10), -20); assert.equal(F.angleDiff(10, 350), 20);
});
const V = F.makeVoyage(route);
ok("the ship's plan: docked, sailing, and outside the cruise", () => {
  const t = (s) => Date.parse(s);
  assert(V.at(t("2027-01-30T20:00Z")).docked); assert.match(V.at(t("2027-01-30T20:00Z")).place, /Tromsø/);
  const inside = V.at(t("2027-02-05T10:00Z")); assert(!inside.docked); assert.match(inside.place, /Bergen/);
  assert(inside.lat > 62 && inside.lat < 68, "Inside Passage latitude " + inside.lat);
  assert(inside.course > 180 && inside.course < 260, "heading roughly south-west: " + inside.course);
  assert(inside.speedKn > 10 && inside.speedKn < 20, "plausible speed " + inside.speedKn);
  assert.equal(V.at(t("2027-01-20T00:00Z")), null);
  assert(V.lengthKm > 2500 && V.lengthKm < 4000, "route length " + V.lengthKm);
});
const items = [
  { k: "peak", n: "Stetind", la: 68.1655, lo: 16.5918, e: 1392 },
  { k: "peak", n: "Small hill", la: 68.30, lo: 16.30, e: 320 },
  { k: "island", n: "Hamarøya", la: 68.08, lo: 15.62 },
  { k: "lighthouse", n: "Tranøy fyr", la: 68.183, lo: 15.666, l: { ch: "Fl", grp: "3", per: 30, col: ["green", "red", "white"], rng: 14.3, h: 21 } },
  { k: "lighthouse", n: "Lødingen", la: 68.32, lo: 16.0, l: { ch: "Oc(2)", per: 8, col: ["white"], rng: 10 } },
  { k: "light", n: "Small light", la: 68.20, lo: 15.80, l: { ch: "Q", col: ["red"], rng: 3 } },
  { k: "town", n: "Far away town", la: 60.0, lo: 5.0 },
];
const pos = { lat: 68.2, lon: 15.9 };
ok("only what's in sight range, with side and clock position", () => {
  const v = F.visible(pos, 225, items);
  assert(!v.some((x) => x.it.n === "Far away town"));
  const st = v.find((x) => x.it.n === "Stetind"); assert(st, "Stetind in view"); assert(st.d > 25 && st.d < 35, st.d);
  // ship heading SW (225): Stetind lies east-ish → off the port side
  assert.equal(st.side, "Port"); assert([7, 8, 9].includes(st.clock), "clock " + st.clock);
});
ok("port and starboard lists, most notable first", () => {
  const s = F.sides(pos, 225, items);
  assert.equal(s.port[0].it.n, "Stetind");
  assert(s.starboard.length + s.ahead.length + s.astern.length + s.port.length >= 4);
});
ok("pointing the phone picks what's in that direction", () => {
  const b = F.bearing(pos, { lat: 68.1655, lon: 16.5918 });
  const p = F.pointing(pos, b + 3, items);
  assert.equal(p[0].it.n, "Stetind");
  assert.equal(F.pointing(pos, b + 90, items).some((x) => x.it.n === "Stetind"), false);
});
ok("camera labels are placed across the screen without overlapping", () => {
  const b = F.bearing(pos, { lat: 68.1655, lon: 16.5918 });
  const L = F.cameraLabels(pos, b, items, 50);
  const st = L.find((x) => x.it.n === "Stetind"); near(st.x, 0.5, 0.01);
  for (const a of L) for (const c of L) if (a !== c && a.row === c.row) assert(Math.abs(a.x - c.x) >= 0.24);
});
ok("reads chart light descriptions", () => {
  const a = F.parseLight({ ch: "Fl", grp: "3", per: 30, col: ["white", "red"] }); assert.deepEqual([a.type, a.group, a.period], ["Fl", 3, 30]);
  const b = F.parseLight({ ch: "Oc(2)", per: 8 }); assert.deepEqual([b.type, b.group], ["Oc", 2]);
  const c = F.parseLight({ ch: "LFl", per: 10 }); assert.equal(c.type, "LFl");
  const d = F.parseLight({ ch: "VQ(6)+LFl", per: 10 }); assert.deepEqual([d.type, d.group], ["VQ", 6]);
  const e = F.parseLight({ ch: "Fl(2+1)", per: 15 }); assert.equal(e.group, 3);
  assert.equal(a.text, "White/red flashing, groups of 3, every 30 s");
});
ok("identifies a lighthouse from what you saw", () => {
  const m = F.matchLights(pos, { color: "white", pattern: "flash", group: 3, period: 29 }, items);
  assert.equal(m[0].it.n, "Tranøy fyr"); assert(m[0].why.includes("every 30 s"), m[0].why.join());
  const m2 = F.matchLights(pos, { color: "white", pattern: "eclipse", group: 2, period: 8.2 }, items);
  assert.equal(m2[0].it.n, "Lødingen");
  const m3 = F.matchLights(pos, { color: "red", pattern: "quick" }, items);
  assert.equal(m3[0].it.n, "Small light");
});
ok("measures the period from taps", () => {
  near(F.periodFromTaps([0, 6000, 12100, 17900]), 5.97, 0.01);
  assert.equal(F.periodFromTaps([0]), null);
});
ok("formatting in nautical miles and feet", () => {
  assert.equal(F.fmtNm(18.52), "10 nm"); assert.equal(F.fmtNm(5), "2.7 nm"); assert.equal(F.fmtNm(0.5), "1,640 ft");
  assert.equal(F.fmtFt(1392), "4,567 ft"); assert.equal(F.compass16(225), "SW");
});
console.log(`\nAll ${n} test groups passed.`);
