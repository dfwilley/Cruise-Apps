// One-off: how does viking.com serve cruise lists, dates and itineraries? Saves pages and JSON responses to probe-out/.
const { chromium } = require("playwright");
const fs = require("fs");
const OUT = "probe-out"; fs.mkdirSync(OUT, { recursive: true });
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const log = [];
async function get(u) { try { const r = await fetch(u, { headers: { "user-agent": UA, accept: "*/*" } }); return { status: r.status, text: await r.text() }; } catch (e) { return { status: 0, text: String(e) }; } }
(async () => {
  // robots + sitemaps
  const robots = await get("https://www.viking.com/robots.txt");
  fs.writeFileSync(`${OUT}/robots.txt`, `${robots.status}\n${robots.text}`);
  let maps = (robots.text.match(/^sitemap:\s*(\S+)/gim) || []).map(l => l.split(/:\s*/).slice(1).join(":").trim());
  if (!maps.length) maps = ["https://www.viking.com/sitemap.xml"];
  const urls = [];
  for (const m of maps.slice(0, 6)) {
    const r = await get(m); log.push({ sitemap: m, status: r.status, len: r.text.length });
    const locs = [...r.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(x => x[1]);
    for (const l of locs) {
      if (/\.xml/.test(l)) { const r2 = await get(l); log.push({ sitemap: l, status: r2.status, len: r2.text.length }); urls.push(...[...r2.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(x => x[1])); }
      else urls.push(l);
    }
  }
  fs.writeFileSync(`${OUT}/sitemap-urls.txt`, urls.join("\n"));
  const b = await chromium.launch();
  const ctx = await b.newContext({ userAgent: UA, locale: "en-US", viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const json = [];
  p.on("response", async r => {
    const ct = r.headers()["content-type"] || "";
    if (/json/.test(ct) || /api|graphql|search|itiner|pricing|departure/i.test(r.url())) {
      try { const t = await r.text(); json.push({ page: p.url(), url: r.url(), method: r.request().method(), post: (r.request().postData() || "").slice(0, 2000), status: r.status(), ct, len: t.length, head: t.slice(0, 6000) }); } catch (e) {}
    }
  });
  async function visit(u, name) {
    try {
      const r = await p.goto(u, { waitUntil: "networkidle", timeout: 90000 });
      await p.waitForTimeout(4000);
      log.push({ visit: u, status: r && r.status(), title: await p.title(), final: p.url() });
      fs.writeFileSync(`${OUT}/${name}.html`, await p.content());
      fs.writeFileSync(`${OUT}/${name}.txt`, await p.evaluate(() => document.body ? document.body.innerText : ""));
      const links = await p.$$eval("a[href]", as => as.map(a => a.href + "  |  " + a.innerText.replace(/\s+/g, " ").trim().slice(0, 60)));
      fs.writeFileSync(`${OUT}/${name}.links.txt`, [...new Set(links)].join("\n"));
    } catch (e) { log.push({ visit: u, err: String(e).slice(0, 300) }); }
  }
  await visit("https://www.viking.com/", "home");
  const pick = re => urls.find(u => re.test(u));
  const rhine = pick(/rhine.*main.*explorer/i) || pick(/rhine-main/i);
  const norway = pick(/northern-lights/i);
  const list = pick(/\/(river|ocean)?-?cruises\/?$/i) || pick(/find-a-cruise|search/i);
  log.push({ rhine, norway, list, cruiseUrlSamples: urls.filter(u => /cruise/i.test(u)).slice(0, 40) });
  if (rhine) await visit(rhine, "rhine");
  if (norway) await visit(norway, "norway");
  if (list) await visit(list, "list");
  // try the dates & pricing link on the Rhine page
  if (rhine) {
    const dp = (fs.existsSync(`${OUT}/rhine.links.txt`) ? fs.readFileSync(`${OUT}/rhine.links.txt`, "utf8") : "").split("\n").find(l => /pric|dates/i.test(l));
    if (dp) await visit(dp.split("  |  ")[0], "rhine-pricing");
  }
  fs.writeFileSync(`${OUT}/json.json`, JSON.stringify(json, null, 1));
  fs.writeFileSync(`${OUT}/log.json`, JSON.stringify(log, null, 1));
  await b.close();
})();
