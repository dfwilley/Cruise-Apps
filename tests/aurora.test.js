// node tests/arctic.test.js — checks the Arctic Night forecast logic with sample NOAA and Open-Meteo files.
const A = require("../aurora-watch/arctic.js"), fs = require("fs"), path = require("path"), assert = require("assert");
const F = (n) => fs.readFileSync(path.join(__dirname, "aurora-fixtures", n), "utf8");
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("✓", name); };

ok("reads NOAA Kp forecast in the old (header row) and new (objects) formats the same way", () => {
  const a = A.parseKpForecast(JSON.parse(F("kp-old.json"))), b = A.parseKpForecast(JSON.parse(F("kp-new.json")));
  assert.equal(a.length, 32); assert.deepEqual(a, b);
  assert.equal(a[3].kp, 4.67); assert.equal(a[0].kind, "observed"); assert.equal(a[5].kind, "predicted");
  assert.equal(new Date(a[1].t).toISOString(), "2027-01-30T03:00:00.000Z");
});
ok("reads the 27-day outlook text", () => {
  const o = A.parse27Day(F("outlook.txt"));
  assert.equal(o["2027-01-28"], 2); assert.equal(o["2027-02-01"], 5); assert.equal(Object.keys(o).length, 20);
});
ok("reads the live aurora map and solar wind", () => {
  const ov = A.parseOvation(JSON.parse(F("ovation.json")));
  assert.equal(ov.size, 360 * 181);
  assert(ov.at(69.65, 18.96) >= 55, "strong over Tromsø"); assert.equal(ov.at(32.2, -110.9), 0, "none over Tucson");
  const bz = A.parseBz(JSON.parse(F("mag.json"))); assert(Math.abs(bz.bz - -3.775) < 0.01, "last-30-minute average Bz -3.775, got " + bz.bz);
});
ok("knows where the ship is", () => {
  const t = (s) => Date.parse(s);
  assert.equal(A.shipAt(t("2027-01-30T21:00Z")).port, "Tromsø");
  assert.equal(A.shipAt(t("2027-02-01T20:00Z")).port, "Alta");
  const sea = A.shipAt(t("2027-02-05T02:00Z")); assert(!sea.docked && /Bergen/.test(sea.place), sea.place);
  assert.equal(A.shipAt(t("2027-02-09T10:00Z")).port, "Edinburgh (Rosyth)");
  assert.equal(A.shipAt(t("2027-01-29T12:00Z")), null); assert.equal(A.shipAt(t("2027-02-12T12:00Z")), null);
});
ok("the voyage has 12 nights, with a dark, nearly new moon", () => {
  const nights = A.voyageNights({});
  assert.equal(nights.length, 12); assert.equal(nights[0].date, "2027-01-30"); assert.equal(nights[11].date, "2027-02-10");
  assert(nights.every((x) => x.level === "Too early"), "no aurora data → too early");
  assert(nights[0].darkHours >= 12, "long Arctic night in Tromsø: " + nights[0].darkHours);
  assert(nights[7].moon < 0.02, "near new moon Feb 6");
});
const data = () => ({ kp: A.parseKpForecast(JSON.parse(F("kp-new.json"))), outlook: A.parse27Day(F("outlook.txt")), clouds: A.parseClouds(JSON.parse(F("clouds.json"))) });
ok("a clear night in Tromsø with Kp 4–5 scores Good, best during darkness", () => {
  const n0 = A.scoreNight("2027-01-30", A.shipAt, data());
  assert.equal(n0.level, "Good"); assert.equal(n0.kpSource, "forecast"); assert(n0.avgCloud < 0.3);
  const h = new Date(n0.best).getUTCHours(); assert(h >= 15 || h <= 4, "best hour in the dark: " + h);
  assert.equal(n0.reasons[0], "Kp up to 4; even quiet nights can show aurora here"); // the Kp 5 block is in the afternoon, before dark
});
ok("the 27-day outlook fills in beyond the 3-day forecast, and is labeled as such", () => {
  const n5 = A.scoreNight("2027-02-04", A.shipAt, data());
  assert.equal(n5.kpSource, "outlook"); assert(/27-day outlook/.test(n5.reasons[0]));
});
ok("thick cloud over Bergen ruins it even with decent Kp", () => {
  const d = data(); d.kp = [{ t: Date.parse("2027-02-06T12:00Z"), kp: 5, kind: "predicted" }, { t: Date.parse("2027-02-06T15:00Z"), kp: 5, kind: "predicted" }, { t: Date.parse("2027-02-06T18:00Z"), kp: 5, kind: "predicted" }, { t: Date.parse("2027-02-06T21:00Z"), kp: 5, kind: "predicted" }, { t: Date.parse("2027-02-07T00:00Z"), kp: 5, kind: "predicted" }, { t: Date.parse("2027-02-07T03:00Z"), kp: 5, kind: "predicted" }];
  const b = A.scoreNight("2027-02-06", A.shipAt, d);
  assert.equal(b.level, "Poor"); assert(b.avgCloud > 0.8);
});
ok("same Kp, clear sky: Tromsø beats London", () => {
  const d = { kp: [], outlook: {} }; for (let t = Date.parse("2027-01-30T00:00Z"); t < Date.parse("2027-02-12T00:00Z"); t += 3 * 3600e3) d.kp.push({ t, kp: 3, kind: "predicted" });
  const at = (lat, lon, tz) => () => ({ lat, lon, tz, place: "x" });
  assert.notEqual(A.scoreNight("2027-01-31", at(69.65, 18.96, 1), d).level, "Poor");
  assert.equal(A.scoreNight("2027-01-31", at(51.46, 0.36, 0), d).level, "Poor");
});
ok("live check says look now when dark, active and clear", () => {
  const d = { ...data(), ovation: A.parseOvation(JSON.parse(F("ovation.json"))), bz: A.parseBz(JSON.parse(F("mag.json"))) };
  const L = A.liveCheck(Date.parse("2027-01-30T21:30Z"), 69.65, 18.96, d);
  assert(L.dark && L.prob >= 55 && L.look, JSON.stringify(L));
  assert.equal(A.liveCheck(Date.parse("2027-01-30T11:00Z"), 69.65, 18.96, d).look, false, "not at midday twilight");
});
ok("alerts: only real forecasts at the chosen level, 15 minutes before the best time, never in the past", () => {
  const nights = A.voyageNights(data());
  const now = Date.parse("2027-01-30T12:00Z");
  const al = A.plannedAlerts(nights, { minLevel: "Good" }, now);
  assert(al.length >= 1); assert(al.every((a) => a.at > now));
  const first = nights.find((x) => x.date === "2027-01-30");
  assert.equal(al[0].id, "night-2027-01-30"); assert.equal(al[0].at, first.best - 15 * 60e3);
  assert(/Tromsø: best around \d+(:\d\d)? (AM|PM) ship time/.test(al[0].body), al[0].body);
  assert.equal(A.plannedAlerts(nights, { minLevel: "Good" }, Date.parse("2027-03-01T00:00Z")).length, 0);
});
ok("cloud request covers the voyage in one call", () => {
  const pts = A.voyageCloudPoints(); assert(pts.length >= 8 && pts.length <= 40, pts.length);
  const u = A.cloudURL(pts); assert(u.startsWith("https://api.open-meteo.com/v1/forecast?latitude=69.65"));
  assert(u.length < 2000);
});
ok("times show in ship time", () => {
  assert.equal(A.fmtTime(Date.parse("2027-01-30T21:00Z"), 1), "10 PM");
  assert.equal(A.fmtTime(Date.parse("2027-02-09T21:30Z"), 0), "9:30 PM");
  assert.equal(A.fmtDate("2027-01-30"), "Sat, Jan 30");
});
console.log(`\nAll ${n} test groups passed.`);
