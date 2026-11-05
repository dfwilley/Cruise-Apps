# Arctic Night

Northern lights outlook for Viking's **In Search of Northern Lights** voyage (Viking Libra, Tromsø to London (Tilbury), January 30 – February 11, 2027), and for wherever you are the rest of the year.

- **Web app:** https://dfwilley.github.io/Cruise-Apps/aurora-watch/ (open in Safari; Share › Add to Home Screen)
- **iPhone app:** https://github.com/dfwilley/Cruise-Apps/releases/download/aurora-watch-latest/Arctic-Night.ipa (install with Sideloadly)

## What it shows

- **Tonight:** Good / Fair / Poor / Too early, the best hour (ship time), an hour-by-hour chart of the dark hours, and why: aurora activity (Kp) against what's needed at that latitude, clouds, the moon and darkness.
- **Right now:** NOAA's live aurora chance near you, current Kp, clouds, solar wind direction, and a "go look north" banner when it all lines up.
- **The voyage, night by night:** where the ship is each evening, moon, dark hours, clouds and Kp, with details per night.
- **Red night-vision mode** after dark, plus tips for photographing aurora with an iPhone and keeping the battery alive in the cold.

The iPhone app adds **alerts scheduled on the phone** before each promising night's best time (they fire even without Wi-Fi), a background **"look now"** check against NOAA's live map (when iOS allows), and GPS.

## Data

- Aurora: NOAA Space Weather Prediction Center — 3-day Kp forecast, 27-day outlook, OVATION live aurora map, solar wind. Reads both NOAA's older JSON layout and the 2026 layout.
- Clouds: Open-Meteo (16-day hourly forecast along the ship's route).
- Sun and moon: calculated on the phone.
- Port times come from a published itinerary and are approximate; Viking's daily program on board governs. Edit `VOYAGE` in `arctic.js` to change them.

## Layout

- `aurora-watch/` (this folder) — the app (web version, also bundled inside the iPhone app). `arctic.js` holds all forecast logic.
- `native/aurora-watch/` — the native iPhone shell: alerts, GPS, background check.
- `tests/aurora.test.js` — `node tests/aurora.test.js` checks the forecast logic with sample NOAA and Open-Meteo files (in `tests/aurora-fixtures/`).
