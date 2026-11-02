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

Tabs: **Pier & walking** (berth options with sources, walking time to the centre and to sights, opening hours on our port day, "back to the ship" from your location), **Hours & weather** (sunrise, sunset and twilight against the ship's time in port, typical weather for these dates, a live forecast in the last two weeks, Sunday closing rules), **Money & phrases** (kroner/pounds converter with a saved rate, tipping, Norwegian and Sámi phrases spoken aloud). The iPhone app can also set all-aboard reminders.

**Data:** port facts in `port-guide/data/ports.json` (with sources). Sights, coordinates and opening hours © OpenStreetMap contributors (ODbL), typical weather from Open-Meteo (ERA5, CC BY 4.0), exchange rates from the ECB via Frankfurter — gathered by the "Port data" workflow (`tools/build_ports.py`).

## Layout

- `fjord-spotter/` — the app (web version, also bundled into the iPhone app). `fjord.js` holds the logic.
- `native/fjord-spotter/` — the iPhone shell: GPS, true-north compass and camera.
- `tests/fjord.test.js` — `node tests/fjord.test.js`
- `port-guide/`, `native/port-guide/`, `tests/port.test.js` — Port Pocket Guide (logic in `port.js`).
