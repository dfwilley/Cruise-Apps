# Pocket Sextant

Take a sun sight with the phone's camera and tilt sensor and work out where you are, the way navigators did before GPS. You can also enter readings from a real marine sextant and the app does the sums.

**For fun and practice, not for actual navigation.**

- **Web app:** https://dfwilley.github.io/Cruise-Apps/pocket-sextant/ (open in Safari; Share › Add to Home Screen)
- **iPhone app:** https://github.com/dfwilley/Cruise-Apps/releases/download/pocket-sextant-latest/Pocket-Sextant.ipa (install with Sideloadly). The same app with everything built in, so it works offline from the first launch and keeps your sights between launches. It asks once for the camera, the motion sensor and, when you tap Use my GPS, your location.
- The web version works offline once it has been opened with a connection. All sights and settings stay on the phone.

## The tabs

- **Shoot:** tap Start Sextant, hold the phone upright, put the sun in the ring and tap MARK. The app averages the moments when the sun is in the ring (5 seconds to 2 minutes, like an aircraft bubble sextant). Look at the screen, never at the sun.
- **Log:** every sight you mark. Checked sights go into the fix. Add a reading from a real sextant here, or load a practice problem.
- **Fix:** enter the ship's course and speed if it moved between sights (a "running fix"), then Compute Fix. Shows the position, how far off it may be, and a check against GPS.
- **Almanac:** where the sun is right now (GHA, declination, equation of time), and its altitude and bearing from any position.
- **Setup:** calibration (camera scale, then the phone's index correction at a known spot such as home), air temperature and pressure, and sighting options.
- **Help:** how it works, a quick start, what accuracy to expect, and the words used.

## Quick start

1. Calibrate once, outdoors, on the Setup tab: camera scale, then index correction at home.
2. Shoot the sun. Wait 2 to 3 hours and shoot again so it has moved round the sky. Morning, noon and afternoon sights give the best fix.
3. On the Fix tab, enter course and speed if you were moving, and tap Compute Fix.

## What accuracy to expect

One arcminute (1/60 of a degree) of error moves the position by one nautical mile. A marine sextant is good to about 1 arcminute. A calibrated phone is more like 5 to 30, so expect a phone fix within roughly 5 to 50 nautical miles. In the Arctic winter the sun stays low, which makes the air's bending of light (refraction) larger; set the air temperature and pressure on the Setup tab for better results.

## How it's built

- `index.html` — the screens.
- `sextant-core.js` — all the navigation math: sun position (standard astronomical formulas, better than 1 arcminute), corrections for refraction, parallax, dip and the sun's edge, sight reduction, and the fix (a best-fit search that also handles a moving ship).
- `sw.js` — keeps the app working offline. Raise the cache name (`pocket-sextant-v1`) when files change.
- `tests/sextant.test.js` — run `node tests/sextant.test.js` from the repository root. It checks the sun against published almanac values, the corrections, and that perfect sights taken at a known spot (Tromsø in February, and a ship under way) give that spot back.

- `native/pocket-sextant/` — the iPhone app: a thin wrapper that shows this folder, built on GitHub's cloud Macs by the "Pocket Sextant iPhone app" workflow, which publishes `Pocket-Sextant.ipa` to the `pocket-sextant-latest` release.
