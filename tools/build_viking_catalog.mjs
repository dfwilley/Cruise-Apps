// Builds the Viking cruise catalog the Port Guide's "Add cruise" uses: every river, ocean and expedition cruise on
// Viking's US sites, its departures (date, ship, direction) and its day-by-day ports for each year and direction.
// Run by the "Viking catalog" workflow (weekly). Output: viking-catalog/index.json and viking-catalog/c/<cruise>.json
//   node tools/build_viking_catalog.mjs            (all cruises)
//   MAX=5 node tools/build_viking_catalog.mjs      (first 5, for a quick test)
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.OUT || "viking-catalog";
const MAX = +process.env.MAX || Infinity;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const RIVER = "https://www.vikingrivercruises.com", OCEAN = "https://www.vikingcruises.com";
const wait = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
let requests = 0;

async function get(url, opts = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      requests++; await wait(250);   // a gentle pace
      const r = await fetch(url, { ...opts, headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", ...(opts.headers || {}) } });
      if (r.ok) return await r.text();
      if (r.status === 404) return null;
      log(`  ${r.status} ${url}`);
    } catch (e) { log(`  error ${url}: ${e.message}`); }
    await wait(2000 * (i + 1));
  }
  return null;
}
const unescapeHtml = s => s.replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)));
// "London (Tilbury) to Tromsø" and "london-tilbury_to_tromso" → "london-tilbury-to-tromso"
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ø/gi, "o").replace(/æ/gi, "ae").replace(/ß/g, "ss")
  .toLowerCase().replace(/_to_/g, "-to-").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---- 1. Which pages are cruise itineraries (from the sites' own site maps) ----
async function sitemap(host) {
  const xml = await get(host + "/sitemap.xml"); if (!xml) return [];
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => unescapeHtml(m[1].trim()));
}
function cruisePages(urls) {
  const out = new Map();   // slug → { slug, type, host, region, url }
  for (const u of urls) {
    let m = u.match(/^https:\/\/www\.vikingrivercruises\.com\/cruise-destinations\/([^/]+)\/([^/]+)\/(\d{4})-[^/]+\/index\.html$/);
    if (m) { if (!out.has(m[2])) out.set(m[2], { slug: m[2], type: "river", host: RIVER, region: m[1], url: u }); continue; }
    m = u.match(/^https:\/\/www\.vikingcruises\.com\/(oceans|expeditions)\/cruise-destinations\/([^/]+)\/([^/]+)\/index\.html$/);
    if (m && !["countries", "waterways", "ports", "index"].includes(m[3]) && m[2] !== "specialty") {
      if (!out.has(m[3])) out.set(m[3], { slug: m[3], type: m[1] === "oceans" ? "ocean" : "expedition", host: OCEAN, section: m[1], region: m[2], url: u });
    }
  }
  return [...out.values()];
}

// ---- 2. One itinerary page → name, year, direction, days, and links to its other years/directions ----
function readItinerary(html, pageUrl, slug) {
  const title = unescapeHtml((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "").trim();
  const name = title.split(/\s+[-–]\s+/)[0].replace(/^NEW!?\s*/i, "").trim();
  let data = {};
  const m = html.match(/viking_page_data_additional\s*=\s*(\{[\s\S]*?\});/);
  if (m) { try { data = JSON.parse(m[1]); } catch (e) {} }
  const id = String(data.itinerary_id || "");
  const year = (id.match(/^(\d{4})_/) || [])[1] || (title.match(/\b(20\d\d)\b/) || [])[1] || null;
  const direction = norm(data.cruise_direction || (title.split(/\s+[-–]\s+/)[2] || "").replace(/\|.*$/, ""));
  const days = [];
  for (const d of html.matchAll(/aria-label="Read more about itinerary day (\d+)\. Destination is ([^"]*?)\.?"/g)) days.push([+d[1], unescapeHtml(d[2]).trim()]);
  if (!days.length) for (const [i, d] of [...html.matchAll(/class="city-label">([^<]+)</g)].entries()) days.push([i + 1, unescapeHtml(d[1]).trim()]);
  const variants = new Set();
  const base = new URL(pageUrl);
  for (const h of html.matchAll(/href="([^"]+)"/g)) {
    const href = unescapeHtml(h[1]);
    if (!href.includes("/" + slug + "/")) continue;
    let u; try { u = new URL(href, base); } catch (e) { continue; }
    if (/\/\d{4}-[^/]+\/index\.html$/.test(u.pathname) && !u.search) variants.add(u.origin + u.pathname);
    else if (u.searchParams.get("startLocation") && u.searchParams.get("year")) {
      variants.add(`${u.origin}${u.pathname}?startLocation=${u.searchParams.get("startLocation")}&endLocation=${u.searchParams.get("endLocation")}&year=${u.searchParams.get("year")}`);
    }
  }
  return { name, year, direction, days, variants: [...variants] };
}

// ---- 3. Departures from Viking's "Dates & Pricing" data ----
async function departures(c) {
  const ep = c.type === "river" ? `${RIVER}/Core/DnPCruiseFullInfo?v=11` : `${OCEAN}/${c.section}/Core/DnPCruiseFullInfo?v=11`;
  const body = JSON.stringify({ cruiseId: c.slug, parameters: "", offerCode: "" });
  const txt = await get(ep, { method: "POST", body, headers: { "content-type": "application/json; charset=utf-8", "x-requested-with": "XMLHttpRequest", origin: c.host, referer: c.url } });
  if (!txt) return null;
  let j; try { j = JSON.parse(txt); } catch (e) { log(`  not JSON from ${ep}: ${txt.slice(0, 120)}`); return null; }
  return (j.cruises || []).map(x => ({
    date: `${x.DepartureDateString.slice(0, 4)}-${x.DepartureDateString.slice(4, 6)}-${x.DepartureDateString.slice(6, 8)}`,
    ship: x.shipType || null, direction: norm(x.cruiseDirection), directionText: x.cruiseDirection || "", year: String(x.cruiseYearNumber || x.year || ""),
    soldOut: !!x.soldOut, name: x.CruiseName
  }));
}

// ---- Run ----
const today = new Date().toISOString().slice(0, 10);
const cutoff = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);   // keep cruises that started recently (you may be on one)
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const pages = cruisePages([...(await sitemap(RIVER)), ...(await sitemap(OCEAN))]).filter(c => !ONLY || ONLY.includes(c.slug)).slice(0, MAX);
log(`${pages.length} cruises in Viking's site maps`);
fs.mkdirSync(path.join(OUT, "c"), { recursive: true });
const index = [];
let failed = 0;
for (const [n, c] of pages.entries()) {
  const html = await get(c.url);
  if (!html) { failed++; continue; }
  const first = readItinerary(html, c.url, c.slug);
  if (!first.days.length) { log(`- ${c.slug}: no day-by-day list, skipped`); continue; }
  const itineraries = {}, seen = new Set([c.url]);
  const add = it => { if (it.days.length && it.year) itineraries[`${it.year}|${it.direction}`] = it.days; };
  add(first);
  for (const v of first.variants) {
    if (seen.has(v)) continue; seen.add(v);
    const h = await get(v); if (h) add(readItinerary(h, v, c.slug));
  }
  const deps = ((await departures(c)) || []).filter(d => d.date >= cutoff);
  // Match each departure to the itinerary for its year and direction (else the nearest year in that direction).
  const keys = Object.keys(itineraries);
  const pick = d => {
    if (itineraries[`${d.year}|${d.direction}`]) return `${d.year}|${d.direction}`;
    const same = keys.filter(k => k.split("|")[1] === d.direction).sort((a, b) => Math.abs(a.split("|")[0] - d.year) - Math.abs(b.split("|")[0] - d.year));
    return same[0] || keys.filter(k => k.split("|")[0] === d.year)[0] || keys[0];
  };
  const out = {
    id: c.slug, name: first.name || deps[0]?.name || c.slug, type: c.type, region: c.region, url: c.url,
    itineraries, departures: deps.map(d => [d.date, d.ship, pick(d), d.directionText, d.soldOut ? 1 : 0]).sort((a, b) => a[0] < b[0] ? -1 : 1)
  };
  fs.writeFileSync(path.join(OUT, "c", c.slug + ".json"), JSON.stringify(out));
  const future = out.departures.filter(d => d[0] >= today);
  index.push({ id: c.slug, name: out.name, type: c.type, region: c.region, days: Math.max(...Object.values(itineraries).map(d => d[d.length - 1][0])),
    from: future[0]?.[0] || out.departures[0]?.[0] || null, to: future[future.length - 1]?.[0] || null, n: future.length,
    ships: [...new Set(out.departures.map(d => d[1]).filter(Boolean))], route: Object.values(itineraries)[0].filter(([, p]) => !/^(sail|scenic|cruis|at sea|crossing)/i.test(p)).map(([, p]) => p.split(",")[0]).filter((p, i, a) => a.indexOf(p) === i).join(" · ") });
  log(`${n + 1}/${pages.length} ${out.name} (${c.type}): ${Object.keys(itineraries).length} itineraries, ${future.length} departures`);
}
index.sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ generated: today, source: "viking.com (vikingrivercruises.com, vikingcruises.com)", cruises: index }));
log(`Done: ${index.length} cruises, ${requests} requests, ${failed} pages failed.`);
if (index.length < Math.min(10, pages.length)) { console.error("Too few cruises — keeping the previous catalog."); process.exit(1); }
