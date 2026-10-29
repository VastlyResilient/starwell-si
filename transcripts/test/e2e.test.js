// End-to-end test of the Starwell workspace under an artifact-like CSP with the mock runtime.
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const APP = path.join(__dirname, "../app"), T = __dirname, SHOTS = path.join(T, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const CSP = ["default-src 'self'", "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://unpkg.com blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self' blob: data:", "worker-src 'self' blob:"].join("; ");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
  const f = path.join(APP, p);
  if (!f.startsWith(APP) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(f);
  if (p === "/index.html") body = Buffer.from('<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>' + body + "</body></html>");
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream", "content-length": body.length, "content-security-policy": CSP });
  res.end(body);
}).listen(8770);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let fails = 0;
const check = (ok, what) => { log(ok ? "PASS" : "FAIL", what); if (!ok) fails++; };
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function newPage(opts = {}) {
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, colorScheme: opts.dark ? "dark" : "light", isMobile: !!opts.mobile, hasTouch: !!opts.mobile });
    await ctx.addInitScript({ path: path.join(T, "mock-runtime.js") });
    if (opts.state) await ctx.addInitScript((s) => { const iv = setInterval(() => { if (window.__store) { for (const [k, v] of JSON.parse(s)) window.__store.set(k, v); clearInterval(iv); } }, 0); }, opts.state);
    if (opts.role) await ctx.addInitScript((r) => { window.__role = r; }, opts.role);
    if (opts.ls) await ctx.addInitScript((ls) => { for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); }, opts.ls);
    await ctx.route("https://cdnjs.cloudflare.com/**", (r) => { const local = path.join(T, "cdn", new URL(r.request().url()).pathname.replace("/ajax/libs/", "")); return fs.existsSync(local) ? r.fulfill({ path: local, contentType: "text/javascript" }) : r.abort(); });
    await ctx.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error") { const t = m.text(); if (!/content-length|Failed to load resource/.test(t)) { errors.push(t); log("console.error", t.slice(0, 300)); } } });
    page.on("pageerror", (e) => { errors.push(String(e)); log("PAGEERROR", e.message); });
    return page;
  }
  const shot = (p, n, full) => p.screenshot({ path: path.join(SHOTS, n + ".png"), fullPage: !!full });
  const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const page = await newPage();
  await page.goto("http://localhost:8770/");
  await page.waitForSelector(".hero .seat");
  const seats = await page.$$eval(".seat b", (e) => e.map((x) => x.textContent));
  check(["Bobby", "Dan", "RJ"].every((n) => seats.includes(n)), "sign-in offers Bobby, Dan and RJ: " + seats.join(", "));
  check(!(await page.$(".newmemo")), "nothing can be uploaded before signing in");
  await shot(page, "00-signin");
  await page.click(".seat:has-text('Bobby')");
  await page.waitForSelector(".page-h h1");
  check((await page.textContent(".side-foot")).includes("Bobby"), "sidebar shows who is signed in");
  check((await page.textContent(".page-h h1")) === "Start with a company", "empty workspace asks for a company");
  await shot(page, "01-empty");

  // ---- companies ----
  await page.fill("input[name=cname]", "Harbor Line Plumbing");
  await page.fill("input[name=cind]", "Plumbing");
  await page.click("#view button[type=submit]");
  await page.waitForFunction(() => document.querySelector(".page-h h1")?.textContent === "Harbor Line Plumbing");
  check(true, "company created and opened on its overview");
  check((await page.textContent("#crumbs")) === "Harbor Line Plumbing", "header names the active company");
  await page.keyboard.press("Control+k");
  await page.waitForSelector("#palette:not([hidden]) #q");
  check((await page.getAttribute("#q", "placeholder")) === "Search Harbor Line Plumbing…" && (await page.textContent("#results")).includes("Key numbers"), "Ctrl+K opens the command palette scoped to the company, with page shortcuts");
  await page.keyboard.press("Escape");
  check(await page.$eval("#palette", (e) => e.hidden), "Esc closes the palette");
  await shot(page, "02-overview-empty");

  // ---- new memo ----
  await page.click(".newmemo");
  await page.waitForSelector("#n-title");
  check((await page.$eval("#n-company", (e) => e.selectedOptions[0].textContent)) === "Harbor Line Plumbing", "new memo confirms the destination company");
  await page.fill("#n-title", "Owner discovery call, Dana");
  await page.fill("#n-interviewee", "Dana Reyes"); await page.fill("#n-role", "Owner"); await page.fill("#n-interviewers", "Jordan");
  await page.setInputFiles("#filePick", [path.join(T, "fixtures", "interview.m4a"), path.join(T, "fixtures", "precall-notes.pdf")]);
  await page.fill("#n-paste", "Follow-up note: Dana said they tried an answering service in 2022 and cancelled it because it booked the wrong job types.");
  await page.click("text=Add pasted text");
  const t0 = Date.now();
  await page.waitForFunction(() => [...document.querySelectorAll(".src .st")].length === 3 && [...document.querySelectorAll(".src .st")].every((e) => /ready|bad/.test(e.textContent + e.className)), null, { timeout: 300000 });
  log("sources ready in", Math.round((Date.now() - t0) / 1000), "s:", (await page.$$eval(".src .st", (e) => e.map((x) => x.textContent))).join(" | "));
  await shot(page, "03-new-memo", true);
  await page.evaluate(() => { window.__sampleDelay = 1800; });
  const tc = Date.now();
  await page.click("text=Save and analyze");
  await page.waitForSelector(".progress-card");
  check(Date.now() - tc < 1500, `progress screen appears immediately (${Date.now() - tc} ms)`);
  await page.waitForSelector(".srow");
  check((await page.$$(".srow")).length > 3, "original transcript is readable while analysis runs");
  const segInfo = await page.$$eval(".srow .ref", (e) => e.map((x) => x.textContent));
  check(segInfo.some((x) => /^\d+:\d\d$/.test(x)) && segInfo.some((x) => /^¶/.test(x)), `audio keeps timestamps, text gets paragraph refs (${segInfo.slice(0, 3).join(", ")} … ${segInfo.slice(-2).join(", ")})`);
  await shot(page, "04-progress");

  // ---- switch company mid-analysis: results must stay with Harbor Line ----
  await page.click(".switch-btn");
  await page.click(".pop-item:has-text('New company')");
  await page.fill(".dlg input[name=cname]", "Northside HVAC");
  await page.click(".dlg button[type=submit]");
  await page.waitForFunction(() => document.querySelector(".page-h h1")?.textContent === "Northside HVAC");
  check(!(await page.textContent("#side")).includes("Owner discovery call"), "the sidebar only lists the active company's memos");
  await page.waitForFunction(() => [...window.__store.entries()].some(([k, v]) => /^interviews\/[^/]+$/.test(k) && v.status === "ready"), null, { timeout: 60000 });
  const iso = await page.evaluate(() => { const e = [...window.__store.entries()]; const cos = Object.fromEntries(e.filter(([k]) => /^companies\//.test(k)).map(([k, v]) => [v.name, k.split("/")[1]])); const f = e.filter(([k]) => /^findings\//.test(k)).map(([, v]) => v.companyId); return { harbor: cos["Harbor Line Plumbing"], north: cos["Northside HVAC"], f }; });
  check(iso.f.length > 0 && iso.f.every((c) => c === iso.harbor), `findings saved to the memo's company even after switching (${iso.f.length} findings)`);
  check((await page.textContent(".page-h")).includes("Northside") && !(await page.textContent("#view")).includes("Morning-rush"), "Northside's overview shows none of Harbor Line's findings");

  // ---- back to the memo ----
  await page.click(".switch-btn"); await page.click(".pop-item >> text=Harbor Line Plumbing");
  await page.waitForFunction(() => document.querySelector(".page-h h1")?.textContent === "Harbor Line Plumbing");
  await shot(page, "05-overview");
  check((await page.$$(".prio-row")).length >= 2 && (await page.$$(".kpi")).length === 4, "overview shows four summary numbers and the top priorities");
  await page.click(".recent a");
  await page.waitForSelector(".viewbar");
  await page.waitForSelector(".turn");
  check(await page.$eval('.vtabs button[aria-selected="true"]', (e) => e.textContent) === "Transcript" && await page.$eval('.tmode button[aria-pressed="true"]', (e) => e.textContent) === "Organized", "a finished memo opens on the organized transcript");
  const nNotes = (await page.$$(".turn .note, .osec .note")).length;
  check(nNotes >= 3, `AI notes appear on the organized transcript (${nNotes})`);
  await shot(page, "06-memo-organized");
  await page.click("#askBtn"); await page.waitForSelector(".a-scope");
  const scopeNow = await page.$eval('.a-scope button[aria-pressed="true"]', (e) => e.textContent);
  check(scopeNow === "This memo", "Ask Starwell points at the open memo (" + scopeNow + ")");
  await page.click("#askBtn");
  // speaker rename
  await page.click(".turn .who button.spk >> nth=0");
  await page.fill(".turn .who input", "Jordan (Starwell)"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.body.textContent.includes("Jordan (Starwell)") && !document.querySelector(".turn .who input"));
  check((await page.$$eval(".turn .who", (e) => e.filter((x) => x.textContent.includes("Jordan (Starwell)")).length)) > 1, "renaming a speaker updates every turn");

  // Original view: highlights + cues
  await page.click('.tmode button:has-text("Original")');
  await page.waitForSelector(".srow");
  check((await page.$$("mark.hl")).length >= 2, `note quotes are highlighted in the original wording (${(await page.$$("mark.hl")).length})`);
  await shot(page, "07-memo-original");
  // Summary
  await page.click('.vtabs button:has-text("Brief")');
  check((await page.textContent("#view")).includes("Tone and delivery") && (await page.textContent("#view")).includes("not measurements"), "summary includes tone, labeled as interpretation");
  await shot(page, "08-memo-summary");
  // Findings
  await page.click('.vtabs button:has-text("Findings")');
  await page.waitForSelector(".dcard");
  check((await page.$$(".dcard")).length === 3, "memo findings listed");
  await page.click(".dcard:has-text('Invented quote check') .dhead");
  await page.waitForSelector(".dcard:has-text('Invented quote check') .dbody");
  check((await page.textContent(".dcard:has-text('Invented quote check')")).includes("Not found in source"), "a quote that isn't in the transcript is flagged, not trusted");
  check((await page.textContent(".dcard:has-text('Invented quote check') .dtop")).includes("Unknown"), "a finding with no real evidence is downgraded to Unknown");
  await page.click(".dcard:has-text('Morning-rush') .dhead");
  await page.waitForSelector(".dcard:has-text('Morning-rush') .dbody");
  check((await page.textContent(".dcard:has-text('Morning-rush')")).includes("Exact quote"), "real quotes are verified against the source");
  await shot(page, "09-memo-findings");
  // evidence link → original + flash
  await page.click(".dcard:has-text('Morning-rush') .evq .ev");
  await page.waitForSelector(".srow.flash");
  check(await page.$eval('.tmode button[aria-pressed="true"]', (e) => e.textContent) === "Original", "clicking evidence opens the original passage and highlights it");

  // ---- review + task from card ----
  await page.click('.vtabs button:has-text("Findings")');
  await page.waitForSelector(".dcard:has-text('Morning-rush') .dbody");
  await page.click(".dcard:has-text('Morning-rush') button:has-text('Accept')");
  await page.waitForFunction(() => document.querySelector(".dcard")?.textContent.includes("Accepted"));
  check(true, "reviewer accepted a finding");
  await page.click(".dcard:has-text('Morning-rush') button:has-text('Create task')");
  await page.click(".dcard:has-text('Morning-rush') textarea"); await page.keyboard.type("Jordan will pull the logs.");
  await page.click(".dcard:has-text('Morning-rush') button:has-text('Comment')");
  await page.waitForFunction(() => document.body.textContent.includes("Jordan will pull the logs."));
  check(true, "comment posted on a finding");

  // ---- highlight → Explain ----
  await page.click('.vtabs button:has-text("Transcript")');
  await page.waitForSelector(".turn .tx");
  await page.evaluate(() => { const el = [...document.querySelectorAll(".turn .tx")].find((x) => /miss/i.test(x.textContent)) || document.querySelector(".turn .tx"); const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await page.waitForSelector("#selbar:not([hidden])");
  check(true, "selection toolbar appears on highlighted text");
  await shot(page, "10-selection");
  await page.click('#selbar button[data-act="explain"]');
  await page.waitForSelector(".a-msg h4");
  const ans = await page.textContent(".apanel");
  check(["What this means", "Why it matters", "What may be missing", "Next step"].every((x) => ans.includes(x)), "answer uses the four-part format");
  check((await page.$$(".a-msg .ev")).length >= 2 && ans.includes("Hypothesis") && ans.includes("Reported"), "answer cites passages and labels claims");
  check((await page.$eval(".u-msg blockquote", (e) => e.textContent)).length > 10, "highlighted passage is visibly attached to the question");
  const askP = await page.evaluate(() => window.__prompts.filter((p) => p.kind === "ask").at(-1).p);
  check(askP.includes("Scope: one memo only") && askP.includes("highlighted this passage"), "the request is scoped to the memo with the passage");
  await shot(page, "11-assistant-answer");
  await page.click("button:has-text('Save as draft finding')");
  await page.waitForFunction(() => [...window.__store.values()].some((v) => v.origin === "assistant"));
  check(true, "assistant answer saved as a draft finding (not auto-approved)");
  check(await page.evaluate(() => ![...window.__store.entries()].some(([k, v]) => k.startsWith("reviews/") && [...window.__store.values()].find((x) => x.origin === "assistant") && v.findingId === [...window.__store.entries()].find(([, x]) => x.origin === "assistant")[0].split("/")[1])), "assistant finding has no review until a person reviews it");

  // ---- company switch clears attachment, keeps chat per company ----
  await page.evaluate(() => { const el = document.querySelector(".turn .tx"); const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await page.waitForSelector("#selbar:not([hidden])");
  await page.click('#selbar button[data-act="ask"]');
  await page.waitForSelector(".a-chip");
  await page.click(".switch-btn"); await page.click(".pop-item >> text=Northside HVAC");
  await page.waitForFunction(() => document.querySelector(".page-h h1")?.textContent === "Northside HVAC");
  check(!(await page.$(".a-chip")) && !(await page.$(".a-msg h4")), "switching company clears the attachment and shows that company's own (empty) chat");
  await page.click(".switch-btn"); await page.click(".pop-item >> text=Harbor Line Plumbing");
  await page.waitForSelector(".a-msg h4");
  check(!(await page.$(".a-chip")), "returning keeps Harbor Line's conversation, without the stale attachment");

  // ---- search ----
  await page.keyboard.press("Control+k");
  await page.fill("#q", "whiteboard");
  await page.waitForSelector("#palette:not([hidden]) #results .grp:has-text('Passages')");
  const groups = await page.$$eval("#results .grp", (e) => e.map((x) => x.textContent));
  check(groups.includes("Passages") && groups.includes("Findings"), "search shows plain results by type: " + groups.join(", "));
  const promptsBefore = await page.evaluate(() => window.__prompts.length);
  check(true, "typing in search sent no AI request (" + promptsBefore + " total so far)");
  await shot(page, "12-search");
  await page.click("#results .res.ask");
  await page.waitForFunction((n) => window.__prompts.length > n, promptsBefore);
  const cp = await page.evaluate(() => window.__prompts.at(-1).p);
  check(cp.includes("Scope: all evidence for Harbor Line Plumbing") && !cp.includes("Northside"), "Ask Starwell from search uses company evidence only");

  // ---- diagnostics / metrics / actions ----
  await page.click(".nav a:has-text('Findings')");
  await page.waitForSelector(".queues");
  check((await page.textContent(".queues")).includes("Investigate next") && (await page.textContent(".queues")).includes("Ready to test"), "diagnostics split into two queues");
  await shot(page, "13-diagnostics");
  await page.click(".nav a:has-text('Key numbers')");
  await page.waitForSelector(".mcard");
  const kn = await page.textContent("#view");
  check((await page.$$(".mcard")).length >= 1 && kn.includes("Said in conversation") && kn.includes("Mentioned without a number") && !kn.includes("Not available"), "key numbers show as cards; figures with no value are listed separately, never as zero");
  check(await page.$eval(".mcard .mval", (e) => e.textContent) === "around 20 a week", "value and period read naturally (no 'calls · per week' duplication)");
  await shot(page, "14-metrics");
  await page.click(".nav a:has-text('Tasks')");
  await page.waitForSelector(".task");
  const nTasks = (await page.$$(".task")).length;
  await page.click(".task input[type=checkbox] >> nth=0");
  await page.waitForSelector(".task.done");
  check(nTasks >= 1, `actions list tasks and completes them (${nTasks})`);
  await shot(page, "15-actions");
  await page.click(".nav a:has-text('Overview')");
  await page.waitForSelector(".feed li");
  check((await page.$$(".feed li")).length >= 5, "activity feed records who did what");

  // ---- error + resume ----
  await page.click(".recent a");
  await page.waitForSelector(".viewbar");
  await page.evaluate(() => { window.__sampleFail = "rate_limited"; });
  await page.click("button[aria-label='More actions']");
  await shot(page, "18-memo-menu");
  await page.click(".pop-item:has-text('Re-run analysis')");
  await page.waitForSelector(".lsteps li.fail");
  check((await page.textContent(".progress-card")).includes("usage limit"), "a failed stage shows its reason and keeps finished work");
  await page.evaluate(() => { window.__sampleFail = null; });
  await page.click("button:has-text('Resume analysis')");
  await page.waitForFunction(() => [...window.__store.entries()].every(([k, v]) => !/^interviews\/[^/]+$/.test(k) || v.status === "ready"), null, { timeout: 30000 });
  await page.waitForSelector(".tmode button[aria-pressed='true']:has-text('Organized')", { timeout: 30000 });
  const reviewed = await page.evaluate(() => [...window.__store.entries()].filter(([k]) => k.startsWith("findings/")).map(([, v]) => v.title));
  check(reviewed.filter((t) => t === "Morning-rush calls go unanswered").length === 2, "re-analysis kept the reviewed finding and added a fresh draft beside it (no silent overwrite)");

  const state = await page.evaluate(() => JSON.stringify([...window.__store.entries()]));
  fs.writeFileSync(path.join(T, "state2.json"), state);
  const mid = JSON.parse(state).find(([k, v]) => /^interviews\/[^/]+$/.test(k))[0].split("/")[1];
  const cid = JSON.parse(state).find(([k, v]) => /^companies\//.test(k) && v.name === "Harbor Line Plumbing")[0].split("/")[1];

  // ---- a second teammate: Dan signs in on his own Claude account and shares a memo ----
  const dan = await newPage({ state, ls: { "sw:cid": JSON.stringify(cid) } });
  await dan.addInitScript(() => { window.__uid = "u-dan"; });
  await dan.goto("http://localhost:8770/");
  await dan.waitForSelector(".hero .seat");
  check(await dan.$eval(".seat:has-text('Bobby')", (e) => e.disabled) && (await dan.textContent(".seat:has-text('Bobby')")).includes("Already signed in"), "Bobby's seat is taken for other accounts");
  await dan.click(".seat:has-text('Dan')");
  await dan.waitForSelector(".page-h h1");
  await dan.click(".newmemo"); await dan.waitForSelector("#n-title");
  await dan.fill("#n-title", "Dan's ride-along with a tech");
  const longNote = "Tech said the van inventory is never right. " + "He spends twenty minutes a morning hunting parts at the supply house. ".repeat(3) + "The final line of Dan's full note is kept word for word.";
  await dan.fill("#n-paste", longNote); await dan.click("text=Add pasted text");
  await dan.click("text=Save and analyze");
  await dan.waitForFunction(() => [...window.__store.entries()].some(([k, v]) => /^interviews\//.test(k) && v.title === "Dan's ride-along with a tech" && v.status === "ready"), null, { timeout: 30000 });
  await dan.goto("http://localhost:8770/#mine"); await dan.waitForSelector(".lrow");
  check((await dan.textContent("#view")).includes("Dan's ride-along"), "Dan sees his upload under My memos");
  await dan.goto("http://localhost:8770/#team"); await dan.waitForSelector(".lrow");
  const teamTxt = await dan.textContent("#view");
  check(/Bobby[\s\S]*Signed in/.test(teamTxt) && /Dan \(you\)/.test(teamTxt) && /RJ[\s\S]*Hasn't signed in yet/.test(teamTxt), "Team page shows who has signed in");
  await shot(dan, "16-team");
  const state3 = await dan.evaluate(() => JSON.stringify([...window.__store.entries()]));
  await dan.context().close();
  const bob = await newPage({ state: state3, ls: { "sw:cid": JSON.stringify(cid) } });
  await bob.goto("http://localhost:8770/#c-" + cid + "-memos"); await bob.waitForSelector(".uploader");
  check((await bob.textContent(".uploader")).includes("Dan") && (await bob.textContent(".uploader")).includes("Bobby"), "Memos can be filtered by who uploaded them");
  await bob.click(".lrow:has-text(\"Dan's ride-along\")");
  await bob.waitForSelector(".meta-line");
  check((await bob.textContent(".meta-line")).includes("by Dan"), "Bobby sees the memo labeled as Dan's");
  await bob.click('.vtabs button:has-text("Transcript")'); await bob.click('.tmode button:has-text("Original")'); await bob.waitForSelector(".srow");
  check((await bob.textContent("#view")).includes("The final line of Dan's full note is kept word for word."), "Bobby can read Dan's note in full");
  await shot(bob, "17-dan-memo-for-bobby");
  await bob.context().close();

  // ---- widths, themes, roles ----
  for (const [name, o] of [["w1440", { viewport: { width: 1440, height: 900 } }], ["w1280", { viewport: { width: 1280, height: 800 } }], ["w768", { viewport: { width: 768, height: 1000 } }], ["w390", { viewport: { width: 390, height: 844 }, mobile: true }], ["w1440-dark", { viewport: { width: 1440, height: 900 }, dark: true }]]) {
    const p = await newPage({ ...o, state, ls: { "sw:cid": JSON.stringify(cid), "sw:tabs": JSON.stringify({ [cid]: [mid] }) } });
    await p.goto("http://localhost:8770/#m-" + mid);
    await p.waitForSelector(".turn");
    check((await overflow(p)) <= 0, name + ": no horizontal page scroll");
    await shot(p, "20-" + name);
    if (o.viewport.width < 1200) {
      await p.click("#askBtn");
      await p.waitForTimeout(400);
      const box = await p.$eval(".apanel", (e) => { const r = e.getBoundingClientRect(); return { x: r.x, w: r.width, vis: r.right <= innerWidth + 1 && r.x >= -1 }; });
      check(box.vis, name + ": Ask Starwell opens as a " + (o.viewport.width < 600 ? "full-screen sheet" : "drawer"));
      await shot(p, "21-" + name + "-assistant");
      if (o.viewport.width < 900) {
        await p.click("#scrim").catch(() => {}); await p.click(".a-head button[aria-label='Close Ask Starwell']").catch(() => {});
        await p.waitForTimeout(300);
        await p.click("#menuBtn"); await p.waitForTimeout(350);
        check(await p.$eval(".side", (e) => e.getBoundingClientRect().x >= -1), name + ": navigation opens as a drawer");
        await shot(p, "22-" + name + "-nav");
      }
    }
    await p.context().close();
  }
  const v = await newPage({ state, role: "viewer", ls: { "sw:cid": JSON.stringify(cid) } });
  await v.goto("http://localhost:8770/#m-" + mid);
  await v.waitForSelector(".turn");
  await v.click("button[aria-label='More actions']");
  const vm = await v.textContent(".pop");
  check(!(await v.$(".newmemo")) && !vm.includes("Re-run") && !vm.includes("Delete") && !vm.includes("Edit"), "viewers get no editing controls (menu: " + vm + ")");
  await v.context().close();
  const an = await newPage({ state, role: "analyst", ls: { "sw:cid": JSON.stringify(cid) } });
  await an.goto("http://localhost:8770/#c-" + cid + "-diagnostics");
  await an.waitForSelector(".dcard");
  await an.click(".dcard .dhead");
  check(!(await an.$(".dbody button:has-text('Accept')")) && !!(await an.$(".dbody button:has-text('Edit')")), "analysts can edit but not review");
  await an.context().close();
  log("ERRORS:", errors.length ? errors : "none");
  log(fails ? `${fails} FAILED` : "ALL CHECKS PASSED");
  await browser.close(); server.close();
})().catch((e) => { console.error("TEST CRASHED", e); process.exit(1); });
