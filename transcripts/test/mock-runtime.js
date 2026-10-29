// Test double for the claude.ai runtime (v2): in-memory db with where/orderBy/limit and live snapshots;
// a sample() that builds plausible JSON from the material lines it receives, so refs and quotes are real.
(() => {
  const store = new Map();
  const listeners = new Set();
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const segs = (p) => p.split("/");
  const notify = () => queueMicrotask(() => { for (const l of [...listeners]) l(); });
  const snapDoc = (path) => ({ id: segs(path).pop(), exists: store.has(path), data: () => store.has(path) ? clone(store.get(path)) : undefined, metadata: { fromCache: false, hasPendingWrites: false } });
  function query(col, spec = { where: [] }) {
    const run = () => {
      let docs = [...store.keys()].filter((p) => p.startsWith(col + "/") && segs(p).length === segs(col).length + 1).map(snapDoc);
      for (const [f, op, v] of spec.where) docs = docs.filter((d) => { const x = d.data()[f]; return op === "==" ? x === v : op === "!=" ? x !== v : true; });
      if (spec.order) { const [f, dir] = spec.order; docs.sort((a, b) => ((a.data()[f] ?? 0) > (b.data()[f] ?? 0) ? 1 : -1) * (dir === "desc" ? -1 : 1)); }
      else docs.sort((a, b) => a.id.localeCompare(b.id));
      if (spec.limit) docs = docs.slice(0, spec.limit);
      return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
    };
    return {
      orderBy: (f, dir = "asc") => query(col, { ...spec, order: [f, dir] }),
      limit: (n) => query(col, { ...spec, limit: n }),
      where: (f, op, v) => query(col, { ...spec, where: [...spec.where, [f, op, v]] }),
      get: async () => run(),
      onSnapshot(next) { let last = null; const l = () => { const s = run(); const k = JSON.stringify(s.docs.map((d) => [d.id, d.data()])); if (k !== last) { last = k; next(s); } }; listeners.add(l); setTimeout(l, 20); return () => listeners.delete(l); },
      doc: (id) => docRef(col + "/" + (id || "auto" + Math.random().toString(36).slice(2))),
    };
  }
  function docRef(path) {
    if (segs(path).length % 2) throw new TypeError("doc path needs even segments: " + path);
    return {
      id: segs(path).pop(), path,
      get: async () => snapDoc(path),
      set: async (d) => { if (window.__denyPrefix && path.startsWith(window.__denyPrefix)) throw { code: "invalid_argument", message: "rules" }; const s = JSON.stringify(d); if (s.length > 262144) throw { code: "invalid_argument", message: "too big " + s.length }; store.set(path, clone(d)); notify(); },
      update: async (d) => { if (!store.has(path)) throw { code: "invalid_argument", message: "missing" }; store.set(path, { ...store.get(path), ...clone(d) }); notify(); },
      delete: async () => { store.delete(path); notify(); },
      onSnapshot(next) { const l = () => next(snapDoc(path)); listeners.add(l); setTimeout(l, 20); return () => listeners.delete(l); },
      collection: (c) => query(path + "/" + c),
    };
  }
  const db = Object.freeze({ doc: docRef, collection: (c) => query(c) });
  const av = (c, l) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${c}"/><text x="20" y="26" font-size="16" text-anchor="middle" fill="#fff" font-family="sans-serif">${l}</text></svg>`);
  const PEOPLE = { "u-bobby": { id: "u-bobby", name: "Bobby A", avatarUrl: av("#5b5146", "B") }, "u-dan": { id: "u-dan", name: "Daniel K", avatarUrl: av("#3d5a6c", "D") }, "u-rj": { id: "u-rj", name: "R J", avatarUrl: av("#6c3d55", "R") } };
  const UID = () => window.__uid || "u-bobby";
  const user = Object.freeze({
    id: async () => UID(), isOwner: async () => true, canEdit: async () => window.__role !== "analyst", can: async () => window.__role !== "viewer",
    me: async () => ({ ...PEOPLE[UID()], email: null, color: "#5b5146" }),
    profiles: async (ids) => Object.fromEntries(ids.map((i) => [i, PEOPLE[i] || { id: i, name: "", avatarUrl: av("#888", "?") }])),
    search: async () => Object.values(PEOPLE),
  });
  // ---------- AI stand-in ----------
  window.__prompts = [];
  const materialLines = (p) => { const a = p.lastIndexOf("MATERIAL") >= 0 && p.includes("END MATERIAL") ? p.slice(p.indexOf("\n", p.search(/\nMATERIAL/) + 2), p.lastIndexOf("END MATERIAL")) : p.slice(p.indexOf("EVIDENCE\n") + 9, p.lastIndexOf("END EVIDENCE"));
    return a.split("\n").map((l) => /^\[([^\] |]+)(?:[^\]]*)\] (.*)$/.exec(l)).filter(Boolean).map((m) => ({ ref: m[1], text: m[2] })); };
  const firstWords = (t, n) => t.split(/\s+/).slice(0, n).join(" ");
  const find = (L, re) => L.find((x) => re.test(x.text));
  const phrase = (x, re) => { const m = re.exec(x.text); if (!m) return firstWords(x.text, 8); const s = x.text.slice(Math.max(0, x.text.lastIndexOf(" ", m.index - 1) + 1)); return firstWords(s, 9); };
  function notesAnswer(L) {
    const sections = []; for (let i = 0; i < L.length; i += 3) { const part = L.slice(i, i + 3); sections.push({ heading: part[0].text.includes("Harbo") ? "Company overview" : /miss|call/i.test(part.map((x) => x.text).join(" ")) ? "How customers book, and missed calls" : "Dispatch, quoting and next steps", summary: "What was discussed in this stretch of the conversation.", turns: part.flatMap((x) => x.text.split(/(?<=\?)\s+/).map((t, k) => ({ speaker: /\?$/.test(t) ? "Interviewer" : "Owner", side: /\?$/.test(t) ? "interviewer" : "interviewee", text: t, ref: x.ref }))), key_points: ["Point captured from " + part[0].ref] }); }
    const notes = [];
    const add = (re, type, note, extra = {}) => { const x = find(L, re); if (x) notes.push({ ref: x.ref, type, quote: phrase(x, re), note, ...extra }); };
    add(/miss/i, "pain_point", "Missed calls during the morning rush, valued by the owner at roughly $400 each (owner's estimate, not measured).");
    add(/whiteboard/i, "bottleneck", "Scheduling lives on a whiteboard and relies on one dispatcher; one long job disrupts the day.");
    add(/headache|problem|fall/i, "emotion", "Sounds frustrated with how fragile the day's schedule is.", { emotion: "frustrated", basis: "wording" });
    add(/\d{2,}|seventy|fourteen|eleven/i, "fact", "Team size and volumes worth tracking.");
    add(/proposal|Friday|Wednesday/i, "decision", "Agreed next steps with dates.");
    add(/quick ?books/i, "question", "Which systems would need to connect, and who enters data where?");
    return { sections, notes };
  }
  function diagnoseAnswer(L) {
    const ev = (re) => { const x = find(L, re); return x ? [{ ref: x.ref, quote: phrase(x, re) }] : []; };
    return {
      headline: "Owner discovery call: missed calls and slow paper quotes are the owner's top worries.",
      executive_summary: "The owner described an 11-year-old Tampa plumbing company with 14 technicians and 3 office staff. Most work arrives by phone, and the office misses calls during the morning rush.\n\nScheduling runs off a whiteboard managed by the dispatcher, and quotes are written on paper, which delays estimates by two to three days. Next steps: a proposal by Friday and call logs by Wednesday.",
      at_a_glance: { purpose: "Understand how jobs flow from call to invoice", outcome: "Owner named missed calls and slow quotes as priorities", interest_level: "high", next_step: "Proposal by Friday; call logs by Wednesday" },
      tone: { overall: "The owner sounds candid and motivated, and frustrated about scheduling.", moments: L.filter((x) => /headache|fall apart|honestly/i.test(x.text)).slice(0, 2).map((x) => ({ ref: x.ref, emotion: "frustrated", note: "Calls it a headache; describes the day falling apart.", basis: "wording" })) },
      participants: [{ name: "Dana", role: "Owner", side: "Client", notes: "Described operations" }, { name: "Interviewer", role: "Starwell", side: "Starwell", notes: "Led the call" }],
      company_profile: { what_they_do: "Residential and light commercial plumbing in Tampa", size_and_team: "14 technicians, 3 office staff", locations: "Tampa, FL", tools_and_systems: "Whiteboard, text messages, QuickBooks" },
      meeting_flow: [{ phase: "Company overview", summary: "The owner introduced the business.", refs: [L[0]?.ref] }, { phase: "Problems", summary: "Missed calls, whiteboard dispatch and paper quotes.", refs: [find(L, /miss/i)?.ref] }],
      topics: [{ topic: "Lead intake", details: [{ text: "About 70% of work comes from phone calls.", refs: [find(L, /70|seventy/i)?.ref] }] }],
      findings: [
        { kind: "pain_point", title: "Morning-rush calls go unanswered", process: "lead_intake", symptom: "The office misses calls during the morning rush.", owner_implication: "Some enquiries may not become jobs; the owner estimates about $400 per missed call, which is unverified.", evidence_status: "reported", evidence: ev(/miss/i), hypotheses: [{ claim: "Three office staff can't cover peak call volume.", validation_needed: "Review a month of call logs by hour." }], alternative_explanations: ["Some missed calls may be repeat callers or non-jobs."], missing_information: ["How many missed calls are qualified leads", "Whether callers are called back"], next_action: "Review last month's call logs for unanswered calls by hour.", solution_class: "additional_measurement", queue: "investigate_next", business_importance: "high", priority_reason: "Potential lost jobs; size unknown until call logs are reviewed.", related_to: null },
        { kind: "bottleneck", title: "Whiteboard dispatch depends on one person", process: "scheduling_dispatch", symptom: "One long job forces the dispatcher to call everyone.", owner_implication: "Capacity is lost when the day is rebuilt by hand.", evidence_status: "reported", evidence: ev(/whiteboard/i), hypotheses: [], alternative_explanations: [], missing_information: ["How often the board is rebuilt"], next_action: "Shadow the dispatcher for one morning.", solution_class: "process_clarification", queue: "ready_to_test", business_importance: "medium", priority_reason: "Clear process gap with a low-risk test.", related_to: null },
        { kind: "pain_point", title: "Invented quote check", process: "estimates_followup", symptom: "", owner_implication: "Test of quote verification.", evidence_status: "reported", evidence: [{ ref: L[0]?.ref, quote: "this sentence was never spoken by anyone" }], hypotheses: [], alternative_explanations: [], missing_information: [], next_action: "", solution_class: "", queue: "ready_to_test", business_importance: "low", priority_reason: "", related_to: null },
      ],
      metrics: [{ label: "Missed calls", value: "around 20 a week", unit: "calls", period: "per week", definition: "Owner's guess", classification: "reported", ref: find(L, /miss/i)?.ref, caveat: "Owner's estimate" }, { label: "Average job value", value: "", unit: "$", period: "", definition: "", classification: "reported", ref: "", caveat: "Not stated precisely" }],
      people_mentioned: [{ name: "Maria", role: "Dispatcher", context: "Runs the whiteboard" }],
      action_items: [{ task: "Send a proposal", owner: "Starwell", due: "Friday", ref: find(L, /proposal/i)?.ref }],
      open_questions: ["How are after-hours calls handled?"], quotes: L.slice(0, 1).map((x) => ({ ref: x.ref, quote: firstWords(x.text, 8), speaker: "Interviewer", why: "Opening" })), tags: ["plumbing", "missed calls", "dispatch"],
    };
  }
  function askAnswer(L, p) {
    const r = L.slice(0, 2).map((x) => x.ref);
    return { what_it_means: "The owner is describing calls that go unanswered when the office is busiest.", what_it_means_refs: r, why_it_matters: "Unanswered calls can mean lost jobs, but how many is unknown.", why_it_matters_refs: r.slice(0, 1),
      what_may_be_missing: "Whether missed callers phone back later.", next_step: "Pull one month of call logs and count unanswered calls by hour.",
      claims: [{ text: "About 20 calls a week are missed (owner's estimate).", kind: "reported", refs: r.slice(0, 1) }, { text: "Peak-hour staffing is the cause.", kind: "hypothesis", refs: [] }],
      deeper: "A longer look would compare call volume by hour against staff on the phones.", finding_draft: { title: "Missed calls may cost booked jobs", kind: "pain_point", owner_implication: "Potential lost jobs during the morning rush.", next_action: "Count unanswered calls by hour.", evidence_status: "reported", importance: "high", refs: r.slice(0, 1) } };
  }
  async function answer(input, opts = {}) {
    const p = typeof input === "string" ? input : input.at(-1).content;
    window.__prompts.push({ kind: p.includes("You are annotating") ? "notes" : p.includes("You diagnose operational") ? "findings" : p.includes("You write the summary") ? "summary" : p.includes("You are Ask Starwell") ? "ask" : "other", len: p.length, p });
    await new Promise((r, j) => { const t = setTimeout(r, window.__sampleDelay ?? 300); opts.signal?.addEventListener("abort", () => { clearTimeout(t); j({ code: "cancelled", message: "" }); }); });
    if (window.__sampleFail) throw { code: window.__sampleFail, message: "forced" };
    const L = materialLines(p);
    if (p.includes("You are annotating")) return JSON.stringify(notesAnswer(L));
    if (p.includes("You diagnose operational") || p.includes("You write the summary")) return JSON.stringify(diagnoseAnswer(L));
    if (p.includes("You are Ask Starwell")) return JSON.stringify(askAnswer(L, p));
    return "Transcribed note text";
  }
  const sample = async (input, opts) => { const text = await answer(input, opts); opts?.onText?.({ text, delta: text }); return { text, truncated: false, modelTierApplied: "default" }; };
  sample.json = async (input, opts) => JSON.parse(await answer(input, opts));
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 2e7, mediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] } });
  window.__saved = [];
  const downloads = Object.freeze({ save: async (r) => { window.__saved.push(r); return { status: "saved" }; } });
  const caps = { db, user, sample, downloads };
  window.claude = { use: (n) => new Promise((r) => setTimeout(() => r(caps[n] ?? null), 30)) };
  window.__store = store;
})();
