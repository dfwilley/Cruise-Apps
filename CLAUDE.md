# Handoff note for Claude Code: Cruise-Apps

Read this first, then `README.md`, which describes what each app does and where its data comes from. This note covers how the owner works, how changes reach his phone, and the traps.

## The owner and how to work with him

- The owner is not a programmer. Claude writes all the code. Explain things in plain language and define technical terms.
- He has a Windows PC and an iPhone. **There is no Mac.** Everything Apple-related is built on GitHub's cloud Macs (GitHub Actions). Never suggest opening Xcode.
- He has a paid Apple Developer account. Apps reach phones by TestFlight or by Sideloadly on the PC.
- Lead with the result, then limitations. Make low-risk decisions without asking. Ask first before deleting files, publishing anything new, spending money, or any change that can't be undone.
- Keep changes focused on what was asked. Don't add dependencies unless the task needs them.
- Commit messages follow the existing pattern: `App name: what changed, in plain words` (see `git log`).

## The deadline

Most of these apps were built for one trip: Viking's **In Search of Northern Lights** voyage, Tromsø to London, **January 30 to February 11, 2027**. They will be used at sea with little or no internet. Anything that must work on the trip has to be finished, installed and tried on the phone before departure, and has to work offline.

## Layout

Each app is a plain web app in its own top-level folder: HTML, CSS and JavaScript with **no build step and no package manager**. GitHub Pages serves the repository at https://dfwilley.github.io/Cruise-Apps/ (`index.html` is the landing page).

| Folder | App | iPhone version |
|---|---|---|
| `fjord-spotter/` | Fjord Spotter (logic in `fjord.js`) | `native/fjord-spotter/` |
| `aurora-watch/` | Arctic Night, also called Aurora Watch (logic in `arctic.js`) | `native/aurora-watch/` (TestFlight) |
| `port-guide/` | Port Pocket Guide (logic in `port.js`, `import.js`) | `native/port-guide/` (TestFlight) |
| `port-side-quests/` | Port Side Quests | `native/port-side-quests/` (TestFlight) |
| `hour-between/` | The Hour Between | none |
| `pocket-sextant/` | Pocket Sextant | none |

Other folders: `tools/` (data-building scripts), `viking-catalog/` (generated data), `tests/`.

All four iPhone apps are **shells**: each `native/<app>/project.yml` bundles the web folder as-is and shows it in a web view, adding native extras (GPS, compass, camera, alerts, Apple Maps). A change to a web folder changes the iPhone app too. Port Side Quests also bundles `port-guide/` and `hour-between/`, so changes to those two can affect it.

Each native app is defined by a `project.yml` that XcodeGen turns into an Xcode project during the cloud build. Generated projects and `Info.plist` files are not checked in.

## Tests

No install is needed. Run them with Node from the repository root:

```
node tests/aurora.test.js
node tests/fjord.test.js
node tests/hour.test.js
node tests/port.test.js
node tests/quests.test.js
```

All five passed on November 12, 2026. Pocket Sextant has no automated tests. The Swift unit tests and screenshot tests under `native/*/` need a Mac, so they run only in GitHub Actions.

## How a change reaches the phone

**A push to `main` is a release.** There is no staging step.

- The web apps go live on GitHub Pages as soon as they are pushed.
- Each `...-ios.yml` workflow runs when its app's files change: it runs the tests, builds an unsigned `.ipa`, and replaces the `<app>-latest` release (for Sideloadly).
- Arctic Night, Port Pocket Guide and Port Side Quests also have `...-testflight.yml` workflows that sign and upload to TestFlight on every push that touches them. These **do not run the tests**, so a change with failing tests can still be uploaded. Check the test run before calling work finished.
- Signing uses four repository secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `APPLE_TEAM_ID`. Never print or log them. The shared helper scripts are in `.github/scripts/`.

For anything larger than a small fix, work on a branch and merge to `main` only when it is ready.

## Things that are easy to get wrong

- **Robots commit to `main` here.** The "Viking catalog" workflow runs every Monday and commits to `viking-catalog/`. "Port data", "Landmark data" and "Quest data" commit regenerated data files when their inputs change. Pull before you push, and expect commits you didn't make.
- **Don't hand-edit generated data.** `fjord-spotter/data/landmarks.*`, `port-guide/data/places.*`, `port-guide/data/ports.js`, `port-side-quests/data/quests.js` and everything in `viking-catalog/` are produced by the scripts in `tools/`. Change the script or the hand-made source file (`route.json`, `ports.json`) instead. The `.js` files are copies of the `.json` data for offline loading.
- **Offline caching.** Every web app except Port Side Quests has a service worker (`sw.js`) with a named cache (for example `port-guide-v3`) and a list of files to keep offline. When you add, rename or remove a file the app needs, update that list and raise the cache version so phones drop the old copy.
- **Port Side Quests shared journal** uses a Supabase project the owner sets up himself (`port-side-quests/SETUP.md`, tables in `supabase/schema.sql`). Only the **publishable** key may appear in `sync-config.js`. Never put a secret or `service_role` key in this public repository. Don't change `schema.sql` on a database that already holds rows without asking.
- **Outside data sources** change without notice: NOAA space weather (Arctic Night already reads two layouts), Open-Meteo, OpenStreetMap and Viking's website. Keep the attributions listed in `README.md`.
- **Safety wording stays.** Light characteristics are "not for navigation", port times are approximate, and return-to-ship times carry a safety buffer. Don't weaken these notes or shorten buffers unless asked.
- This repository is public. No booking numbers, cabin details or other personal travel data.
- Small cleanup available: `tools/__pycache__/` was committed by accident and `pocket-sextant/README.md` is only a title. Ask before removing or rewriting.

## Background

Arctic Night and Pocket Sextant were separate repositories until November 5, 2026; their history was brought over. Port Side Quests was removed and rebuilt from scratch on November 8, 2026. The owner keeps a running list of app ideas in the Claude app; cruise and travel apps belong here.
