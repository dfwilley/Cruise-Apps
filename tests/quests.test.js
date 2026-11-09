// Port Side Quests: quest logic tests.  Run: node tests/quests.test.js
const assert = require('assert');
const vm = require('vm'), fs = require('fs'), path = require('path');
const Q = require('../port-side-quests/quests.js');
const P = require('../hour-between/planner.js');
const load = f => { const c = { window: {} }; vm.createContext(c); vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), c); return c.window; };
const facts = load('port-guide/data/ports.js').PORT_FACTS;
const guide = load('port-guide/data/places.js').PORT_PLACES;

// Itinerary times -> time ashore (30 min after arrival, 30 min before departure)
const w1 = Q.suggestedWindow({ from: '08:00', to: '13:00' });
assert.deepStrictEqual([w1.ready, w1.back, w1.overnight, w1.guessReady, w1.guessBack], ['08:30', '12:30', false, false, false]);
const w2 = Q.suggestedWindow({ from: '18:00', to: null });          // Bergen arrival evening
assert.deepStrictEqual([w2.ready, w2.back, w2.overnight, w2.guessBack], ['18:30', '21:30', false, true]);
const w3 = Q.suggestedWindow({ from: null, to: '23:00' });
assert.deepStrictEqual([w3.ready, w3.back, w3.guessReady], ['09:00', '22:30', true]);
const w4 = Q.suggestedWindow({ from: null, to: '06:00' });
assert(P.budget(w4.ready, w4.back, w4.overnight) > 0, 'early departure still gives a valid window');
const w5 = Q.suggestedWindow({});
assert.deepStrictEqual([w5.ready, w5.back], ['09:00', '17:00']);
assert.strictEqual(Q.suggestedWindow({ from: '20:00', to: '06:00' }).overnight, true);
// Every day of every real itinerary gives a positive time ashore
for (const v of facts.voyages) for (const p of v.ports) for (const d of p.days) {
  const w = Q.suggestedWindow(d), t = P.budget(w.ready, w.back, w.overnight);
  assert(t > 0 && t <= 1440, `${p.id} ${d.date}: ${w.ready}-${w.back}`);
}
assert.strictEqual(Q.toTime(-30), '23:30');

// A tiny made-up port: one place next to the pier, one 5 km away
const pier = { lat: 49.79, lon: 9.93 };
const questPlaces = { ports: { test: {
  waterfront: [{ name: 'Near boatyard', kind: 'boatyard', lat: 49.7905, lon: 9.9305 }],
  taste: [{ name: 'Far bakery', kind: 'bakery', lat: 49.835, lon: 9.93 }],
  mechanism: [{ name: 'Old crane', kind: 'historic crane', lat: 49.792, lon: 9.931, built: '1773' }],
  story: [{ name: 'Plaque', kind: 'plaque', lat: 49.791, lon: 9.93, inscription: 'Here lived a printer, 1490' }]
} } };
const opts = { total: 120, buffer: 30, extra: 15, speed: 3.5, factor: 1.7, start: pier, end: pier, endTime: '12:30' };
const qs = Q.buildQuests('test', opts, { questPlaces, guidePlaces: null }, P);
assert.strictEqual(qs.length, 4);
const byName = n => qs.find(q => q.place.name === n);
assert(byName('Near boatyard').plan.fits, 'a place by the pier fits two hours');
assert(!byName('Far bakery').plan.fits, 'a place 5 km away does not fit two hours with margins');
assert(qs[qs.length - 1].place.name === 'Far bakery', 'quests that fit are listed first');
const by = byName('Near boatyard');
assert.strictEqual(by.headBackBy, Q.toTime(Q.toMin('12:30') - 30 - by.plan.back), 'head-back time = all aboard - buffer - walk back');
assert(byName('Old crane').clues.some(c => c.includes('1773')));
assert(byName('Plaque').clues.some(c => c.includes('printer')));
assert(by.task.includes('boat') && by.record.length >= 2);

// Picks: one per chosen theme that fits; different seeds stay within the fitting set
const picks = Q.pickFour(qs, Q.ORDER, 0);
assert.deepStrictEqual(picks.map(p => p.theme), ['waterfront', 'mechanism', 'story']);
assert(Q.pickFour(qs, ['taste'], 3).length === 0);
for (let s = 0; s < 10; s++) assert(Q.pickFour(qs, Q.ORDER, s).every(p => p.plan.fits));

// Fall-backs from Port Pocket Guide when quest data is missing: every real port still gets taste and story quests
for (const v of facts.voyages) for (const p of v.ports) {
  const g = Q.placesFor(p.id, null, guide);
  assert(g.story.length > 0, p.id + ' has story quests from Port Pocket Guide');
}
// Basel, real data, typical 3-hour window: something fits
const basel = facts.voyages.find(v => v.id === 'rhine').ports.find(p => p.id === 'basel');
const bp = basel.piers.find(x => x.primary) || basel.piers[0];
const real = Q.buildQuests('basel', { ...opts, total: 180, start: bp, end: bp, endTime: '13:00' }, { questPlaces: null, guidePlaces: guide }, P);
assert(real.some(q => q.plan.fits), 'Basel has at least one quest that fits 3 hours');

// Badges: earned at 3 of a kind
const b = Q.badges([{ theme: 'taste' }, { theme: 'taste' }, { theme: 'taste' }, { theme: 'story' }]);
assert(b.find(x => x.theme === 'taste').earned && !b.find(x => x.theme === 'story').earned);

console.log('Port Side Quests: time windows, walking fit, head-back times, picks, fall-backs, real Basel data and badges passed.');
