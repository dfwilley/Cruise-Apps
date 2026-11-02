# Cruise Apps

Apps for our cruises. Web versions: https://dfwilley.github.io/Cruise-Apps/

## Fjord Spotter

Point your phone at the coast during Viking's **In Search of Northern Lights** voyage (Tromsø to London, January 30 – February 11, 2027) and see the names of mountains, islands, fjords, towns, wrecks and lighthouses.

- **Web app:** https://dfwilley.github.io/Cruise-Apps/fjord-spotter/
- **iPhone app:** https://github.com/dfwilley/Cruise-Apps/releases/download/fjord-spotter-latest/Fjord-Spotter.ipa (install with Sideloadly)

Views: **Look** (point and identify, or camera view with labels), **Port & Stbd** (what's passing on each side, by clock position), **Lights** (describe a flashing light — colour, pattern, flashes per group, tap to time it — and it finds the lighthouse), **Settings** (GPS or ship's plan, a voyage preview slider, compass alignment, red night mode).

Everything works offline: about 10,800 landmarks along the route are built into the app. GPS works at sea without Wi-Fi; when there's no fix it uses the ship's planned route.

**Data:** © OpenStreetMap contributors (ODbL), from Geofabrik extracts filtered with osmium by the "Landmark data" workflow (`tools/build_landmarks.py`). Light characteristics come from OpenStreetMap sea-mark tags — interesting, but **not for navigation**. The route and port times (`fjord-spotter/data/route.json`) are approximate.

## Port Pocket Guide

A pocket guide to the seven ports of the same voyage: Tromsø, Alta, Harstad, Narvik, Bergen, Edinburgh (Rosyth) and London (Tilbury).

- **Web app:** https://dfwilley.github.io/Cruise-Apps/port-guide/
- **iPhone app:** https://github.com/dfwilley/Cruise-Apps/releases/download/port-guide-latest/Port-Pocket-Guide.ipa (install with Sideloadly)

The app starts with no cruises (move added cruises between computer and phone with **Save to a file** / **Load from a file** under Add cruise): add each one under **＋ Add cruise** (the first launch also asks what you're interested in and turns those into Near me buttons; change them under Near me › My interests). The original hand-made Norway and Rhine & Main data stays in `port-guide/data/` for the country facts and the tests.

Top bar: **📍 Near me** (works anywhere; **＋ Add** your own searches such as *barber shop*, *laundry* or *gas station* — they stay as buttons and list those places nearest first with directions; uses the iPhone's location to find sights, museums, food and drink, views and parks, shops and handy places — toilets, cash, pharmacy — within a 10- or 20-minute walk or a short drive, plus notable places from Wikipedia; in a cruise port it adds the all-aboard countdown and the walk back to the ship), one tab per cruise, and **＋ Add cruise**.

**Add cruise:** type the name of a Viking cruise and pick your date from Viking's own departure list — the app fills in the ports day by day and builds the tab (sights, ideas, daylight, typical weather, money). The list of every Viking river, ocean and expedition cruise, with departures and itineraries, is downloaded from Viking's websites every Monday by the "Viking catalog" workflow (`tools/build_viking_catalog.mjs` → `viking-catalog/`). Viking doesn't publish port times on its public pages, so times can be typed in on the check list. For other cruise lines: paste an itinerary or pick a .txt/.csv/.ics file (and in the iPhone app, My Viking Journey can be read directly).

Cruise tabs: **Pier & walking** (berth options with sources, walking time to the centre and to sights, opening hours on our port day, "back to the ship" from your location; for added cruises, "The ship is here" saves the real berth), **Ideas** (things to do in each port), **Hours & weather** (sunrise, sunset and twilight against the ship's time in port, typical weather for these dates, a live forecast in the last two weeks, Sunday closing rules), **Money & phrases** (kroner/pounds converter with a saved rate, tipping, Norwegian and Sámi phrases spoken aloud). The iPhone app can also set all-aboard reminders.

**Data:** port facts in `port-guide/data/ports.json` (with sources). Sights, coordinates and opening hours © OpenStreetMap contributors (ODbL), typical weather from Open-Meteo (ERA5, CC BY 4.0), exchange rates from the ECB via Frankfurter — gathered by the "Port data" workflow (`tools/build_ports.py`).

## Layout

- `fjord-spotter/` — the app (web version, also bundled into the iPhone app). `fjord.js` holds the logic.
- `native/fjord-spotter/` — the iPhone shell: GPS, true-north compass and camera.
- `tests/fjord.test.js` — `node tests/fjord.test.js`
- `port-guide/`, `native/port-guide/`, `tests/port.test.js` — Port Pocket Guide (logic in `port.js`; itinerary import and Near me sorting in `import.js`).

## The Hour Between

Web app: https://dfwilley.github.io/Cruise-Apps/hour-between/

One-stop free-time planner for both saved voyages. Reuses the shared port and OpenStreetMap place records. Enter your own ready/return times, confirm the return dock, choose a walking pace, visit duration, contingency, and protected return buffer. Results show estimated out/visit/back timing and a saved device-local outing card. Optional manually verified travel-time overrides are available.

Distances are straight-line distances multiplied by a user-selected allowance, not routed pedestrian distances. The app does not claim a place is currently open, confirm berths, track the ship, or guarantee a timely return. Verify hours, routes, transport, conditions, and your actual ship/guide instructions. Opening the app online primes its offline cache; saved outings/settings remain in this browser. No Viking booking or account integration.

Tests: `node tests/hour.test.js`. Shared data attribution remains as documented under Port Pocket Guide (OpenStreetMap contributors, ODbL).
