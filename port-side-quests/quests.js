/* Port Side Quests — quest logic (no screen code, so it can be tested on its own).
   Uses: PORT_FACTS (ports, piers, itinerary times), QUEST_PLACES (quest places from OpenStreetMap),
   PORT_PLACES (Port Pocket Guide places, used as fall-backs) and HourPlanner (walking-time maths). */
(function (root) {
  'use strict';

  const THEMES = {
    waterfront: { title: 'Find the Working Waterfront', short: 'Working waterfront', icon: '⚓', badge: 'Harbor Hand', visit: 25,
      lead: 'Locate a traditional boatyard or working harbor. Discover how local boats are built or maintained.' },
    taste: { title: 'Taste Something Unexpected', short: 'Unexpected taste', icon: '🥨', badge: 'Taste Scout', visit: 20,
      lead: "Find a regional snack you've never tried and learn its local history." },
    mechanism: { title: 'Discover an Ingenious Mechanism', short: 'Ingenious mechanism', icon: '⚙️', badge: 'Gear Head', visit: 20,
      lead: 'Find a historic waterwheel, lock mechanism, clock, or unusual engineering solution.' },
    story: { title: 'Uncover a Hidden Story', short: 'Hidden story', icon: '📜', badge: 'Story Keeper', visit: 20,
      lead: 'Find an overlooked building or landmark and discover what happened there centuries ago.' }
  };
  const ORDER = ['waterfront', 'taste', 'mechanism', 'story'];

  // What to do at each kind of place, and what to bring back for the journal.
  const TASKS = {
    'boatyard': ['Look for a hull out of the water, tools on the ground or work in progress. What kind of boat is it, and what is being done to it?', ['Type of boat', 'The job underway', 'One tool or material you spotted']],
    'slipway': ['Find where boats are hauled out. How do they get a boat up the ramp — rails, a winch, a trailer?', ['How boats come out of the water', 'Any boat waiting there']],
    'harbour': ['Find a boat that works for a living — fishing, ferry, tug or barge. What does it do, and what gives it away?', ['The working boat', 'The clue that told you its job']],
    'marina': ['Walk the pontoons and find the oldest or most unusual boat. What makes it different?', ['The boat and its name', 'What makes it stand out']],
    'quay': ['Find signs of how this quay was used: bollards, rings, rails, crane tracks or worn steps. What came and went here?', ['The clue you found', 'What it tells you']],
    'lighthouse': ['Find the light. How would a captain at sea recognise this one — its colour, shape or pattern?', ['What makes it recognisable', 'When it was built, if marked']],
    'historic ship': ['Find the ship. What was her job, and what is one detail of how she was built?', ['Her name and job', 'A construction detail']],
    'maritime museum': ['Inside or outside, find one object that shows how local boats were built or worked. Ask a staff member about it if you can.', ['The object', 'What it was used for']],
    'bakery': ["Find a bread or pastry you've never seen before. Ask what it's called and when locals eat it.", ['Its name', 'When locals eat it', 'Your verdict']],
    'sweets': ['Find a local sweet or chocolate you have never tried. Is there a story or a festival behind it?', ['Its name', 'The story behind it', 'Your verdict']],
    'deli': ['Ask for a taste of something made in this region — a cheese, sausage or spread. Where exactly does it come from?', ['What you tasted', 'Where it comes from', 'Your verdict']],
    'fish shop': ['Find a fish or seafood speciality of this coast. How is it caught, cured or cooked here?', ['The speciality', 'How it is prepared', 'Your verdict']],
    'butcher': ['Find the local sausage or cured meat. What makes this town’s version different?', ['Its name', 'What makes it local', 'Your verdict']],
    'farm shop': ['Find something grown or made nearby that you cannot buy at home.', ['What you found', 'Where it was made']],
    'market': ['Walk the stalls and find the one regional snack locals are queuing for. Try it if you like.', ['The snack', 'What the seller told you', 'Your verdict']],
    'ice cream': ['Find a flavour you would never see at home. Ask what it is made from.', ['The flavour', 'What is in it', 'Your verdict']],
    'café': ['Order the cake or pastry this café is known for. Ask what makes it local.', ['What you ordered', 'Its local story', 'Your verdict']],
    'groceries': ["Supermarket snack hunt: find a packaged snack with a label you can't read and a flavour you can't guess.", ['The snack', 'What you think the label says', 'Your verdict']],
    'lock': ['Find the lock gates. If a boat comes through, time it. Which way does the water move, and how do the gates open?', ['How the gates work', 'How long a boat takes, if you saw one']],
    'watermill': ['Find the mill. Where does the water come in, and what did the wheel drive — grain, saws, hammers?', ['Where the water comes in', 'What the mill made']],
    'water wheel': ['Find the wheel. Is the water hitting it from above, the middle or below? Count the paddles if you can.', ['Where the water hits', 'Number of paddles']],
    'windmill': ['Find the windmill. How did the miller turn the sails into the wind?', ['How it faces the wind', 'What it ground']],
    'mill': ['Find the mill building. Look for the clue that shows what powered it.', ['What powered it', 'What it made']],
    'historic crane': ['Find the old crane. What powered it — people, horses, steam? Look for the drum or treadwheel.', ['What powered it', 'What it lifted']],
    'public clock': ['Find the clock. Is it driven by weights, a spring or electricity? Is there anything unusual about its face or hands?', ['How it is driven', 'The unusual detail']],
    'clock tower': ['Find the clock tower. Does it strike the hours, and is there a mechanism or figure you can see?', ['What you saw or heard', 'When it was built, if marked']],
    'funicular / cable car': ['Watch the cars pass. How are they balanced against each other, and where is the motor?', ['How it is balanced', 'Where the machinery is']],
    'movable bridge': ['Find how the bridge moves — does it swing, lift or tilt? Look for the counterweight or gears.', ['How it moves', 'The machinery you spotted']],
    'technical monument': ['Find the machine and work out what each main part did. Which part would you most like to see running?', ['What the machine did', 'Your favourite part']],
    'technical museum': ['Find one machine and figure out how it worked before reading the sign. Were you right?', ['The machine', 'Your guess vs the sign']],
    'historic well': ['Find the well. How was water raised — bucket, pump, wheel?', ['How water was raised', 'Any date or inscription']],
    'plaque': ['Find the plaque and read it. What happened here, and when? Look for a clue on the building that matches the story.', ['What happened here', 'When', 'The matching clue']],
    'memorial': ['Find the memorial. Who or what does it remember, and why here?', ['Who or what', 'Why here']],
    'city gate': ['Find the gate. Look for grooves, hinges or murder-holes. How was it closed against attack?', ['How it was closed', 'The date or crest on it']],
    'city wall': ['Find a piece of the old wall. Can you trace where it ran by the street shapes?', ['Where it ran', 'How thick it is']],
    'castle': ['Find one detail most visitors walk past — a mason’s mark, an arrow slit, a blocked doorway. What story does it suggest?', ['The detail', 'The story it suggests']],
    'ruins': ['Find the ruin. What was it, and what happened to it?', ['What it was', 'What happened']],
    'church': ['Look for an oddity — a carved face, a date stone, a repair in a different stone. What does it tell you about the building’s life?', ['The oddity', 'What it tells you']],
    'monument': ['Find the monument. Who put it up, and why then?', ['Who and why', 'The date']],
    '_default_story': ['Find the oldest-looking detail on this building — a date, a sign, a carving. What happened here centuries ago?', ['The detail', 'What happened here']]
  };

  const pad = n => String(n).padStart(2, '0');
  const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? (+m[1]) * 60 + (+m[2]) : NaN; };
  const toTime = n => { n = ((Math.round(n) % 1440) + 1440) % 1440; return pad(Math.floor(n / 60)) + ':' + pad(n % 60); };

  /** Suggested time ashore for an itinerary day: ready 30 min after arrival, back 30 min before departure.
      When the itinerary lacks a time, a placeholder is filled in (flagged by guessReady/guessBack) so the
      window always makes sense; travelers must confirm with the ship. */
  function suggestedWindow(day) {
    const a = toMin(day && day.from), d = toMin(day && day.to);
    let ready = Number.isFinite(a) ? a + 30 : NaN, back = Number.isFinite(d) ? d - 30 : NaN;
    const guessReady = !Number.isFinite(ready), guessBack = !Number.isFinite(back);
    if (guessReady && guessBack) { ready = 9 * 60; back = 17 * 60; }
    else if (guessBack) back = Math.min(ready + 180, 23 * 60 + 30);           // arrival only: about 3 hours
    else if (guessReady) ready = back - 9 * 60 >= 60 ? 9 * 60 : Math.max(0, back - 180);   // departure only
    const overnight = back <= ready;
    return { ready: toTime(ready), back: toTime(back), overnight, guessReady, guessBack };
  }

  function taskFor(theme, kind) {
    return TASKS[kind] || (theme === 'story' ? TASKS._default_story : null) || [THEMES[theme].lead, ['What you found', 'What surprised you']];
  }

  /** Places for one port, grouped by theme; adds fall-backs from Port Pocket Guide so every theme has something. */
  function placesFor(portId, questPlaces, guidePlaces) {
    const q = (questPlaces && questPlaces.ports && questPlaces.ports[portId]) || {};
    const g = (guidePlaces && guidePlaces.ports && guidePlaces.ports[portId]) || {};
    const out = {};
    for (const t of ORDER) out[t] = (q[t] || []).filter(p => p && p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon)).map(p => Object.assign({ theme: t }, p));
    const sights = (g.sights || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    const practical = (g.practical || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    const names = new Set(ORDER.flatMap(t => out[t].map(p => p.name.toLowerCase())));
    const add = (t, p, kind) => { if (names.has(p.name.toLowerCase())) return; names.add(p.name.toLowerCase()); out[t].push({ name: p.name, theme: t, kind, lat: p.lat, lon: p.lon, hours: p.hours, wikidata: p.wikidata, local: p.local, fallback: true }); };
    if (out.taste.length < 3) practical.filter(p => p.kind === 'groceries').slice(0, 3).forEach(p => add('taste', p, 'groceries'));
    if (out.story.length < 4) sights.filter(p => p.kind === 'historic' || p.kind === 'church').slice(0, 6).forEach(p => add('story', p, p.kind === 'church' ? 'church' : 'historic building'));
    if (out.waterfront.length < 2) sights.filter(p => /maritim|ship|boat|harbou?r|polar|fisher|hafen|schiff/i.test(p.name)).slice(0, 3).forEach(p => add('waterfront', p, /museum/i.test(p.kind) ? 'maritime museum' : 'quay'));
    if (out.mechanism.length < 2) sights.filter(p => p.kind === 'cable car' || /mill|mühle|bridge|brücke|lock|schleuse|clock|uhr|kran/i.test(p.name)).slice(0, 3).forEach(p => add('mechanism', p, p.kind === 'cable car' ? 'funicular / cable car' : 'technical monument'));
    return out;
  }

  /** All quests for a port that a traveler could do, each with walking times from HourPlanner.
      opts: { total, start, end, buffer, extra, speed, factor } (same meaning as The Hour Between). */
  function buildQuests(portId, opts, data, planner) {
    const groups = placesFor(portId, data.questPlaces, data.guidePlaces);
    const all = [];
    for (const theme of ORDER) {
      for (const place of groups[theme]) {
        const [task, record] = taskFor(theme, place.kind);
        const visit = THEMES[theme].visit;
        const plan = planner.plan(place, Object.assign({}, opts, { visit, outOverride: null, backOverride: null }));
        const clues = [];
        if (place.local && place.local !== place.name) clues.push('Local name: ' + place.local);
        if (place.built) clues.push('Dates from ' + place.built);
        if (place.inscription) clues.push('Inscription: “' + place.inscription + '”');
        if (place.description) clues.push(place.description);
        all.push({ id: portId + ':' + theme + ':' + place.name + ':' + place.lat + ':' + place.lon, theme, place, kind: place.kind,
          task, record, clues, visit, plan, headBackBy: toTime(toMin(opts.endTime) - opts.buffer - plan.back) });
      }
    }
    all.sort((a, b) => Number(b.plan.fits) - Number(a.plan.fits) || (a.plan.out + a.plan.back) - (b.plan.out + b.plan.back));
    return all;
  }

  /** One suggested quest per chosen theme, picked among those that fit; `seed` changes the pick ("Surprise me"). */
  function pickFour(quests, themes, seed) {
    const out = [];
    for (const t of ORDER) {
      if (!themes.includes(t)) continue;
      const fit = quests.filter(q => q.theme === t && q.plan.fits);
      if (!fit.length) continue;
      const top = fit.slice(0, Math.min(fit.length, 5));   // nearest few, so a surprise is never a long walk
      out.push(top[Math.abs(seed | 0) % top.length]);
    }
    return out;
  }

  function badges(entries) {
    const counts = Object.fromEntries(ORDER.map(t => [t, 0]));
    for (const e of entries) if (counts[e.theme] !== undefined) counts[e.theme]++;
    return ORDER.map(t => ({ theme: t, icon: THEMES[t].icon, badge: THEMES[t].badge, count: counts[t], earned: counts[t] >= 3 }));
  }

  const api = { THEMES, ORDER, TASKS, suggestedWindow, placesFor, buildQuests, pickFour, badges, toMin, toTime };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Quests = api;
})(typeof window !== 'undefined' ? window : this);
