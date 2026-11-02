// One-off probe #2: itinerary pages, dates & pricing, river site. Saves to probe-out/.
const { chromium } = require("playwright");
const fs = require("fs");
const OUT = "probe-out"; fs.mkdirSync(OUT, { recursive: true });
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const log = [];
async function get(u) { try { const r = await fetch(u, { headers: { "user-agent": UA } }); return { status: r.status, text: await r.text(), final: r.url }; } catch (e) { return { status: 0, text: String(e) }; } }
(async () => {
  for (const host of ["https://www.vikingrivercruises.com", "https://www.vikingcruises.com"]) {
    const r = await get(host + "/robots.txt"); const maps = (r.text.match(/^sitemap:\s*(\S+)/gim) || []).map(l => l.replace(/^sitemap:\s*/i, ""));
    log.push({ host, robots: r.status, maps });
    const urls = [];
    for (const m of maps.length ? maps : [host + "/sitemap.xml"]) { const s = await get(m); urls.push(...[...s.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(x => x[1])); log.push({ m, status: s.status, n: urls.length }); }
    fs.writeFileSync(`${OUT}/sitemap-${host.split(".")[1]}.txt`, urls.join("\n"));
  }
  const b = await chromium.launch();
  const ctx = await b.newContext({ userAgent: UA, locale: "en-US", viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const json = [];
  p.on("response", async r => {
    const u = r.url(); if (!/viking/i.test(u) || /\.(js|css|png|jpe?g|svg|woff2?|gif|webp)(\?|$)/i.test(u) || /somni|cookielaw/.test(u)) return;
    const ct = r.headers()["content-type"] || ""; if (/html/.test(ct) && r.request().resourceType() === "document") return;
    try { const t = await r.text(); json.push({ page: p.url(), url: u, method: r.request().method(), post: (r.request().postData() || "").slice(0, 3000), status: r.status(), ct, len: t.length, head: t.slice(0, 20000) }); } catch (e) {}
  });
  async function visit(u, name) {
    try {
      const r = await p.goto(u, { waitUntil: "networkidle", timeout: 90000 }); await p.waitForTimeout(5000);
      log.push({ visit: u, status: r && r.status(), title: await p.title(), final: p.url() });
      fs.writeFileSync(`${OUT}/${name}.html`, await p.content());
      fs.writeFileSync(`${OUT}/${name}.txt`, await p.evaluate(() => document.body ? document.body.innerText : ""));
      const links = await p.$$eval("a[href]", as => as.map(a => a.href + "  |  " + a.innerText.replace(/\s+/g, " ").trim().slice(0, 60)));
      fs.writeFileSync(`${OUT}/${name}.links.txt`, [...new Set(links)].join("\n"));
      return links;
    } catch (e) { log.push({ visit: u, err: String(e).slice(0, 300) }); return []; }
  }
  const ocean = await visit("https://www.vikingcruises.com/oceans/cruise-destinations/baltic/in-search-of-northern-lights/index.html", "ocean-itin");
  const op = ocean.find(l => /pricing/i.test(l)); if (op) await visit(op.split("  |  ")[0], "ocean-pricing");
  const rivers = fs.readFileSync(`${OUT}/sitemap-vikingrivercruises.txt`, "utf8").split("\n");
  const rm = rivers.find(u => /rhine-and-main-explorer/i.test(u) && !/video/.test(u)) || "https://www.vikingrivercruises.com/cruise-destinations/europe/rhine-and-main-explorer/2027-basel-nuremberg/index.html";
  log.push({ rm, riverItinSamples: rivers.filter(u => /cruise-destinations\/[^/]+\/[^/]+\/[^/]+\/index/.test(u)).slice(0, 30) });
  const river = await visit(rm, "river-itin");
  const rp = river.find(l => /pricing/i.test(l)); if (rp) await visit(rp.split("  |  ")[0], "river-pricing");
  // click every day in the river itinerary to see if details load
  fs.writeFileSync(`${OUT}/json.json`, JSON.stringify(json, null, 1));
  fs.writeFileSync(`${OUT}/log.json`, JSON.stringify(log, null, 1));
  await b.close();
})();
