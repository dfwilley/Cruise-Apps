// Pocket Sextant: checks the navigation math in pocket-sextant/sextant-core.js.
// Run from the repository root with: node tests/sextant.test.js
const assert = require('assert'), S = require('../pocket-sextant/sextant-core.js');
const near = (a, b, tol, what) => assert(Math.abs(a - b) <= tol, `${what}: got ${a}, expected ${b} ± ${tol}`);
const utc = (...a) => Date.UTC(...a);

// Sun position against published almanac values (tolerance about 1 arcminute).
let s = S.sun(utc(2000, 0, 1, 12));                 // J2000.0
near(s.dec, -23.033, 0.02, 'declination 1 Jan 2000');
near(s.eotMin, -3.3, 0.3, 'equation of time 1 Jan 2000');
near(S.sun(utc(2024, 2, 20, 3, 6)).dec, 0, 0.02, 'declination at March 2024 equinox');
near(S.sun(utc(2024, 5, 20, 20, 51)).dec, 23.44, 0.02, 'declination at June 2024 solstice');
near(S.sun(utc(2024, 10, 3, 12)).eotMin, 16.4, 0.3, 'equation of time early November');
near(S.sun(utc(2027, 1, 11, 12)).eotMin, -14.2, 0.3, 'equation of time mid-February');
// At 12:00 UT the sun is over Greenwich, offset by the equation of time (4 minutes per degree).
s = S.sun(utc(2027, 1, 1, 12)); near(S.norm180(s.gha - s.eotMin / 4), 0, 0.001, 'GHA matches equation of time');
near(s.sd * 60, 16.2, 0.2, 'sun semi-diameter in February');

// Sight corrections.
// The app always passes temperature and pressure (default 59 F, 29.92 inHg), so test that way.
near(S.refraction(0, 50, 29.83) * 60, 34.5, 0.2, 'refraction at the horizon');
near(S.refraction(10, 50, 29.83) * 60, 5.3, 0.1, 'refraction at 10 degrees');
near(S.refraction(45, 50, 29.83) * 60, 1.0, 0.05, 'refraction at 45 degrees');
assert(S.refraction(10, 10, 30.5) > S.refraction(10, 90, 29.5), 'cold, dense air bends light more');
near(S.dip(9) * 60, 2.91, 0.01, 'dip for 9 ft eye height'); assert.equal(S.dip(0), 0);
const t0 = utc(2027, 1, 3, 11);
const base = { t: t0, hs: 20, method: 'phone', limb: 'center', heFt: 30 };
const ctr = S.observedAltitude(base), low = S.observedAltitude({ ...base, limb: 'lower' });
near((low.ho - ctr.ho) * 60, ctr.sun.sd * 60, 0.01, 'lower limb adds semi-diameter');
assert.equal(ctr.dip, 0, 'phone sights use the phone tilt, so no horizon dip');
near((ctr.ho - S.observedAltitude({ ...base, method: 'marine' }).ho) * 60, S.dip(30) * 60, 0.05, 'marine sights subtract dip');
near(S.observedAltitude({ ...base, ic: 0.1 }).ha - ctr.ha, 0.1, 1e-9, 'index correction is applied');

// Sight reduction: sun overhead gives 90 degrees; meridian altitude is 90 - lat + dec.
near(S.hcZn(10, -30, 30, 10).hc, 90, 1e-6, 'sun overhead');
let r = S.hcZn(60, 0, 0, -15); near(r.hc, 15, 1e-6, 'noon altitude'); near(r.zn, 180, 1e-6, 'noon sun bears south');
near(S.hcZn(60, 0, 300, -15).zn, 90, 45, 'morning sun is in the east');

// Distances and dead reckoning.
near(S.distanceNm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 60, 0.01, 'one degree of latitude is 60 nm');
near(S.bearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 90, 1e-6, 'due east');
let b = S.backtrack(60, 5, 0, 12, 2); near(b.lat, 59.6, 1e-9, 'backtrack 24 nm north'); near(b.lon, 5, 1e-9, 'backtrack keeps longitude');

// Fixes: make perfect sights from a known position, then solve and expect that position back.
function sights(pos, times, course, speed) {
  const tf = Math.max(...times);
  return times.map(t => { const q = S.backtrack(pos.lat, pos.lon, course, speed, (tf - t) / 3600000), g = S.sun(t);
    return { t, ho: S.hcZn(q.lat, q.lon, g.gha, g.dec).hc }; });
}
const tromso = { lat: 69.65, lon: 18.96 };  // February sun is low here; a good hard case
const feb = [utc(2027, 1, 3, 9, 30), utc(2027, 1, 3, 11), utc(2027, 1, 3, 12, 30)];
let f = S.solveFix(sights(tromso, feb, 0, 0), { dr: { lat: 69, lon: 18 } });
assert(!f.error, f.error);
assert(S.distanceNm(f, tromso) < 0.5, `fix off by ${S.distanceNm(f, tromso)} nm`);
assert(f.rmsMin < 0.1 && f.azSpread > 30, 'perfect sights fit, with lines crossing at a good angle');
const ship = { lat: 62.5, lon: 4.2 };       // running fix: ship steaming 200 degrees at 14 knots
f = S.solveFix(sights(ship, feb, 200, 14), { course: 200, speed: 14, dr: { lat: 62, lon: 5 } });
assert(S.distanceNm(f, ship) < 0.5, `running fix off by ${S.distanceNm(f, ship)} nm`);
const noisy = sights(tromso, feb, 0, 0).map((x, i) => ({ ...x, ho: x.ho + [2, -2, 1][i] / 60 }));
f = S.solveFix(noisy, { dr: { lat: 69, lon: 18 } });
assert(S.distanceNm(f, tromso) < 10 && f.radius95 > 0, 'a few arcminutes of error gives a nearby fix with an error circle');
assert(S.solveFix(noisy.slice(0, 1)).error, 'one sight is not enough');

// Local apparent noon: the sun is on the meridian at the returned time.
const n = S.localNoon(-110.9, utc(2027, 1, 3));
near(S.norm180(S.sun(n).gha - 110.9) * 4, 0, 0.05, 'local noon (minutes)');
near((n - utc(2027, 1, 3)) / 3600000, 12 + 110.9 / 15 + 14 / 60 / 1, 0.1, 'local noon near 19:37 UT at Tucson');

// Formatting and typing coordinates.
assert.equal(S.fmtDM(32.2233, 'N', 'S'), 'N 32° 13.4′');
assert.equal(S.fmtDM(-110.92, 'E', 'W', 3), 'W 110° 55.2′');
assert.equal(S.fmtAlt(-0.5), '−0° 30.0′'); assert.equal(S.fmtAlt(29.99999), '30° 00.0′');
near(S.parseCoord('32 13.4 N', true), 32.22333, 1e-4, 'parse N'); near(S.parseCoord("N32°13.4'", true), 32.22333, 1e-4, 'parse symbols');
near(S.parseCoord('110 55.2 W', false), -110.92, 1e-9, 'parse W'); near(S.parseCoord('-110.9', false), -110.9, 1e-9, 'parse minus');
assert.equal(S.parseCoord('95', true), null); assert.equal(S.parseCoord('abc', false), null); assert.equal(S.parseCoord('', true), null);

console.log('Pocket Sextant: sun almanac, corrections, sight reduction, fixes (still and running), local noon and coordinates passed.');
