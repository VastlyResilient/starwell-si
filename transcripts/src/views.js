
// =====================================================================================
// Segments + EvidenceLink
// =====================================================================================
const refLabel = (s) => s.t != null ? fmtClock(s.t) : s.id;
async function getSegments(mid) {
  if (S.segCache.has(mid)) return S.segCache.get(mid);
  const m = memo(mid);
  if (!m || !S.db) return [];
  let segs = [];
  if (m.segParts) {
    const docs = await Promise.all(Array.from({ length: m.segParts }, (_, i) => S.db.doc(`interviews/${mid}/parts/seg-${i}`).get()));
    segs = docs.flatMap((d) => d.exists ? arr(d.data().items) : []);
  } else if (m.rawParts) {
    // memo saved before segments existed: derive paragraph references from the stored raw text
    const docs = await Promise.all(Array.from({ length: m.rawParts }, (_, i) => S.db.doc(`interviews/${mid}/parts/raw-${i}`).get()));
    segs = segmentSources([{ text: docs.map((d) => d.exists ? d.data().text : "").join("\n\n"), name: "Uploaded material" }]);
  }
  segs = segs.map((s) => ({ ...s, memoId: mid }));
  if (segs.length && m.status !== "pending") S.segCache.set(mid, segs);
  return segs;
}
async function companySegments(cid) {
  const ms = companyMemos(cid).filter((m) => m.segParts || m.rawParts);
  return (await Promise.all(ms.map((m) => getSegments(m.id)))).flat();
}
// A citation chip: hover shows the passage, click opens the original wording and highlights it.
function evLink(mid, ref, label) {
  const b = h("button", { class: "ev", type: "button", "aria-label": "Show source passage " + (label || ref) }, label || ref);
  const seg = S.segCache.get(mid)?.find((s) => s.id === ref);
  if (seg) { b.textContent = label || refLabel(seg); b.title = seg.text.slice(0, 280); }
  else getSegments(mid).then((ss) => { const s = ss.find((x) => x.id === ref); if (s) { if (!label) b.textContent = refLabel(s); b.title = s.text.slice(0, 280); } else { b.title = "This reference isn't in the memo's source text."; b.classList.add("bad"); } });
  b.onclick = (e) => { e.stopPropagation(); openEvidence(mid, ref); };
  return b;
}
function openEvidence(mid, ref) {
  hideResults(); closeDrawers();
  S.focus = { memoId: mid, ref };
  S.memoView ||= {}; S.memoView[mid] = "original";
  if (location.hash === "#m-" + mid) render(true); else location.hash = "#m-" + mid;
}
function focusPassage() {
  const f = S.focus; if (!f) return;
  const el = document.querySelector(`[data-memo="${f.memoId}"] [data-ref="${CSS.escape(f.ref)}"]`);
  if (!el) return;
  S.focus = null;
  el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
}

// =====================================================================================
// Ranking and merging: the same claim from two memos is one item, not two
// =====================================================================================
const IMPORTANCE = { high: 0, medium: 1, low: 2 };
function rankFindings(list) {
  const rv = { accepted: 0, draft: 1, needs_evidence: 2 };
  return list.filter((f) => reviewOf(f.id) !== "rejected").sort((a, b) => (IMPORTANCE[a.importance] ?? 3) - (IMPORTANCE[b.importance] ?? 3) || (rv[reviewOf(a.id)] ?? 3) - (rv[reviewOf(b.id)] ?? 3) || b.createdAt - a.createdAt);
}
const SIMILAR = new WeakMap(); // finding -> lower-ranked findings with the same title
function dedupeFindings(ranked) {
  const seen = new Map(), out = [];
  for (const f of ranked) {
    const k = norm(f.title);
    if (seen.has(k)) { const top = seen.get(k); SIMILAR.set(top, [...(SIMILAR.get(top) || []), f]); continue; }
    seen.set(k, f); SIMILAR.set(f, []); out.push(f);
  }
  return out;
}
const memoCountOf = (f) => new Set([f.memoId, ...(SIMILAR.get(f) || []).map((x) => x.memoId)].filter(Boolean)).size;
// Key numbers: identical label + value from several places become one row with several sources.
function metricRows(cid) {
  const rows = new Map();
  for (const x of S.metrics.filter((m) => m.companyId === cid && str(m.value))) {
    const k = norm(x.label) + "|" + norm(x.value);
    if (rows.has(k)) rows.get(k).all.push(x); else rows.set(k, { x, all: [x] });
  }
  return [...rows.values()];
}

// =====================================================================================
// Overview: the state of the engagement at a glance, then what matters most
// =====================================================================================
function viewOverview(view) {
  const alive = liveCheck();
  const draw = async () => {
    const c = company(); if (!c) return;
    const ms = companyMemos(), all = companyFindings(), live = rankFindings(all), top = dedupeFindings(live);
    const tasks = S.tasks.filter((t) => t.companyId === c.id), open = tasks.filter((t) => !t.done);
    const today = new Date().toISOString().slice(0, 10), late = open.filter((t) => t.due && t.due < today);
    const toReview = live.filter((f) => reviewOf(f.id) === "draft").length, accepted = live.filter((f) => reviewOf(f.id) === "accepted").length;
    const nums = metricRows(c.id), unnumbered = new Set(S.metrics.filter((x) => x.companyId === c.id && !str(x.value)).map((x) => norm(x.label))).size;
    const gaps = [...new Set([...ms.flatMap((m) => arr(m.openQuestions)), ...live.flatMap((f) => arr(f.missing))].map(str).filter(Boolean))].slice(0, 6);
    const evs = S.events.filter((e) => e.companyId === c.id).slice(0, 8);
    const ps = await people([...evs.map((e) => e.by), ...open.map((t) => t.assigneeId)]);
    if (!alive()) return;
    const P = { ...(c.profile || {}) }; if (!str(P.industry)) P.industry = c.industry || "";
    const filled = PROFILE_FIELDS.filter(([k]) => str(P[k]));
    const sugg = ms.find((m) => m.profileSuggestion && Object.entries(m.profileSuggestion).some(([k, v]) => str(v) && !str(P[k])));
    const processing = ms.filter((m) => m.status === "analyzing" && !isStale(m));
    const nextTask = open.sort((a, b) => (a.due || "9") < (b.due || "9") ? -1 : 1)[0];
    const goFinding = (f) => (e) => { e.preventDefault(); S.focusFinding = f.id; location.hash = "#c-" + c.id + "-diagnostics"; render(true); };
    const href = (p) => "#c-" + c.id + "-" + p;
    const kpi = (label, icon, value, foot, to) => h("a", { class: "kpi", href: to }, h("span", { class: "k" }, svg(icon, 14), label), h("span", { class: "v" }, value), h("span", { class: "f" }, foot));
    const sub = [c.industry || P.industry, P.size_and_team, P.locations].map(str).filter(Boolean).join(" · ");
    view.replaceChildren(
      h("div", { class: "ov-h" }, h("span", { class: "co-av lg", "aria-hidden": "true" }, initials(c.name)),
        h("div", { class: "page-h", style: "margin:0;flex:1" }, h("div", null, h("h1", null, c.name), h("p", null, sub || "No company profile yet", ms.length ? " · " + plural(ms.length, "memo") + (ms[0] ? ", latest " + fmtShort(ms[0].createdAt) : "") : "")))),
      processing.length ? h("div", { class: "notice info", style: "margin-bottom:16px" }, h("span", { class: "spin", style: "color:var(--info)" }), h("span", null, `${plural(processing.length, "memo is", "memos are")} being analyzed. Findings appear here when ready.`), h("a", { class: "btn sm", href: "#m-" + processing[0].id }, "View progress")) : null,
      !ms.length ? emptyState(IC.mic, "No memos for " + c.name + " yet", "Upload a voice memo, a document or a pasted transcript. Starwell organizes it, annotates it and drafts findings that link to the exact passages.", S.can.write ? h("a", { class: "btn primary", href: "#new" }, svg(IC.plus), "Upload the first memo") : null) : [
        h("div", { class: "kpis" },
          kpi("Findings", IC.diag, top.length, live.length ? [h("b", null, toReview), " to review · ", accepted + " accepted"] : "None yet", href("diagnostics")),
          kpi("Open tasks", IC.actions, open.length, late.length ? h("b", { style: "color:var(--bad)" }, late.length + " overdue") : tasks.length ? (tasks.length - open.length) + " done" : "None yet", href("actions")),
          kpi("Key numbers", IC.metrics, nums.length, unnumbered ? unnumbered + " mentioned without a figure" : nums.length ? "Mostly said out loud" : "None yet", href("metrics")),
          kpi("Memos", IC.memos, ms.length, processing.length ? processing.length + " analyzing" : "Latest " + fmtShort(ms[0].recordedDate || ms[0].createdAt), href("memos"))),
        h("div", { class: "ov-grid" },
          h("div", { class: "ov-col" },
            h("section", { class: "card", "aria-labelledby": "ov-top" }, h("div", { class: "card-h" }, h("h2", { id: "ov-top" }, "Top priorities"), top.length > 5 ? h("a", { class: "textlink", href: href("diagnostics"), style: "font-size:13px" }, "All " + top.length) : null),
              top.length ? h("div", null, top.slice(0, 5).map((f) => h("a", { class: "prio-row", href: href("diagnostics"), onclick: goFinding(f) }, statusIcon(reviewOf(f.id)),
                h("div", { style: "min-width:0" }, h("b", null, f.title), h("small", null, f.nextAction ? "Next: " + f.nextAction : f.ownerImplication)),
                h("div", { class: "end" }, prioTag(f.importance), memoCountOf(f) > 1 ? h("span", { class: "hint" }, memoCountOf(f) + " memos") : null))))
                : h("div", { class: "empty flat" }, h("p", null, "Findings appear here after a memo is analyzed, ranked by business importance."))),
            h("section", { class: "card", "aria-labelledby": "ov-gaps" }, h("div", { class: "card-h" }, h("h2", { id: "ov-gaps" }, "Still unknown"), h("span", { class: "hint" }, "Gaps to cover next time, not confirmed problems")),
              gaps.length ? h("ul", { class: "gaps" }, gaps.map((g) => h("li", null, g))) : h("div", { class: "empty flat" }, h("p", null, "No open questions recorded yet.")))),
          h("div", { class: "ov-col" },
            h("section", { class: "card next-card", "aria-labelledby": "ov-next" }, h("div", { class: "card-h" }, h("h2", { id: "ov-next" }, "Next step")),
              h("div", { class: "card-b" }, nextTask ? [h("p", null, nextTask.title), h("small", null, [nextTask.assigneeId ? (ps[nextTask.assigneeId]?.name || "Teammate") : "Unassigned", nextTask.due ? "due " + fmtShort(nextTask.due) : null].filter(Boolean).join(" · ")), h("a", { class: "btn sm", href: href("actions") }, "Open tasks")]
                : top[0]?.nextAction ? [h("p", null, top[0].nextAction), h("small", null, "Suggested by: " + top[0].title), S.can.write ? h("button", { class: "btn sm", type: "button", onclick: () => createTask({ title: top[0].nextAction, findingId: top[0].id, memoId: top[0].memoId, companyId: c.id }) }, svg(IC.plus), "Create task") : null]
                : h("p", { class: "muted", style: "font-weight:400" }, "Nothing yet."))),
            h("section", { class: "card", "aria-labelledby": "ov-prof" }, h("div", { class: "card-h" }, h("h2", { id: "ov-prof" }, "Company profile"), S.can.write ? h("button", { class: "btn ghost sm", type: "button", onclick: () => openDialog("Company profile", (close) => profileForm(c, close), { wide: true }) }, "Edit") : null),
              h("div", { class: "card-b", style: "padding-top:8px;padding-bottom:8px" }, filled.length ? h("dl", { class: "profile" }, filled.slice(0, 6).map(([k, l]) => [h("dt", null, l), h("dd", null, str(P[k]))])) : h("p", { class: "muted", style: "font-size:13px;padding:6px 0" }, "Nothing recorded yet."),
                filled.length > 6 ? h("button", { class: "linkish", type: "button", style: "font-size:13px;margin-top:6px", onclick: () => openDialog("Company profile", h("dl", { class: "profile" }, filled.map(([k, l]) => [h("dt", null, l), h("dd", null, str(P[k]))])), { wide: true }) }, "Show all " + filled.length + " fields") : null),
              sugg && S.can.write ? h("div", { class: "card-f" }, h("div", { class: "row", style: "flex-wrap:wrap" }, h("span", { class: "hint", style: "flex:1 1 180px" }, "“" + sugg.title + "” mentions details that aren't in the profile yet."), h("button", { class: "btn sm", type: "button", onclick: () => applyProfile(c, sugg) }, "Apply"))) : null),
            h("section", { class: "card", "aria-labelledby": "ov-act" }, h("div", { class: "card-h" }, h("h2", { id: "ov-act" }, "Activity")),
              evs.length ? h("ul", { class: "feed" }, evs.map((e) => h("li", null, avatar(ps[e.by], ps[e.by]?.name, "xs"), h("div", null, h("b", null, ps[e.by]?.name || "Someone"), " " + e.text, h("small", null, fmtWhen(e.at)))))) : h("div", { class: "empty flat" }, h("p", null, "No activity yet."))))) ]);
  };
  currentView.refresh = draw; draw();
}
const PROFILE_FIELDS = [["what_they_do", "What they do"], ["industry", "Industry"], ["size_and_team", "Size and team"], ["locations", "Service area"], ["offerings", "Services"], ["customers", "Customers"], ["business_model", "Business model"], ["tools_and_systems", "Software and tools"], ["goals", "Current goals"], ["constraints", "Known constraints"]];
function profileForm(c, done) {
  const v = { ...(c.profile || {}) }; if (!v.industry) v.industry = c.industry || "";
  return h("form", { class: "stack", style: "gap:14px", onsubmit: async (e) => { e.preventDefault(); try { await S.db.doc("companies/" + c.id).update({ profile: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, str(x)])), industry: str(v.industry), updatedAt: Date.now() }); logEvent(c.id, "profile", "updated the company profile"); toast("Profile saved"); done(); } catch { toast("Couldn't save the profile."); } } },
    h("div", { class: "grid2" }, PROFILE_FIELDS.map(([k, l]) => h("div", { class: "field" }, h("label", { for: "p-" + k }, l), h("input", { id: "p-" + k, value: v[k] || "", oninput: (e) => (v[k] = e.target.value) })))),
    h("div", { class: "dlg-foot" }, h("button", { class: "btn", type: "button", onclick: done }, "Cancel"), h("button", { class: "btn primary", type: "submit" }, "Save profile")));
}
async function applyProfile(c, m) {
  const P = { ...(c.profile || {}) }; let n = 0;
  for (const [k, v] of Object.entries(m.profileSuggestion || {})) if (str(v) && !str(P[k]) && PROFILE_FIELDS.some(([f]) => f === k)) { P[k] = str(v); n++; }
  try { await S.db.doc("companies/" + c.id).update({ profile: P, updatedAt: Date.now() }); logEvent(c.id, "profile", `filled ${n} profile field(s) from “${m.title}”`, { memoId: m.id }); toast(`Added ${plural(n, "field")}. Edit them if anything is off.`); } catch { toast("Couldn't update the profile."); }
}

// =====================================================================================
// Memos table + Unassigned queue
// =====================================================================================
function statusState(m) {
  if (S.pending.has(m.id)) return h("span", { class: "state info" }, h("i", { class: "dot" }), "Saving");
  if (m.status === "ready") return h("span", { class: "state ok" }, h("i", { class: "dot" }), "Ready");
  if (m.status === "error") return h("span", { class: "state bad" }, h("i", { class: "dot" }), "Needs attention");
  if (isStale(m)) return h("span", { class: "state warn" }, h("i", { class: "dot" }), "Paused");
  return h("span", { class: "state info" }, h("i", { class: "dot" }), "Analyzing");
}
const memoSub = (m) => [m.interviewee && m.interviewee + (m.role && m.role !== m.interviewee ? ", " + m.role : ""), !m.role || m.type !== m.role ? m.type : null].filter(Boolean).join(" · ");
function memoTable(ms, ps, opts = {}) {
  const nf = (m) => S.findings.filter((f) => f.memoId === m.id && reviewOf(f.id) !== "rejected").length;
  return h("div", { class: "table memos-t" + (opts.company ? " with-co" : "") },
    h("div", { class: "thead", role: "presentation" }, h("span", null, "Memo"), opts.company ? h("span", { class: "c opt" }, "Company") : h("span", { class: "c opt" }, "Uploaded by"), h("span", { class: "c" }, "Recorded"), h("span", { class: "c r opt" }, "Findings"), h("span", { class: "c" }, "Status")),
    ms.map((m) => h("a", { class: "lrow", href: "#m-" + m.id },
      h("div", { style: "min-width:0" }, h("h3", null, m.title || "Untitled memo"), h("small", null, memoSub(m) || "—")),
      opts.company ? h("span", { class: "c opt" }, company(m.companyId)?.name || "Unassigned") : h("span", { class: "c opt who" }, avatar(ps[m.ownerId], ps[m.ownerId]?.name, "xs"), h("span", { style: "overflow:hidden;text-overflow:ellipsis" }, ps[m.ownerId]?.name || "—")),
      h("span", { class: "c num" }, fmtShort(m.recordedDate || m.createdAt)),
      h("span", { class: "c r num opt" }, nf(m) || "—"),
      h("span", { class: "c keep" }, statusState(m)))));
}
let uploaderFilter = "";
function viewMemos(view) {
  const alive = liveCheck();
  const draw = async () => {
    const c = company(); if (!c) return;
    const all = companyMemos();
    const ups = [...new Set(all.map((m) => m.ownerId).filter(Boolean))];
    const ms = uploaderFilter ? all.filter((m) => m.ownerId === uploaderFilter) : all;
    const ps = await people(all.map((m) => m.ownerId));
    if (!alive()) return;
    view.replaceChildren(pageHead("Memos", plural(all.length, "memo") + " for " + c.name + ". Each keeps its original wording beside the organized version.", S.can.write ? h("a", { class: "btn primary", href: "#new" }, svg(IC.plus), "New memo") : null),
      ups.length > 1 ? h("div", { class: "toolbar" }, h("div", { class: "seg uploader", role: "group", "aria-label": "Uploaded by" }, [["", "Everyone"], ...ups.map((u) => [u, ps[u]?.name || "Teammate"])].map(([u, l]) => h("button", { type: "button", "aria-pressed": String(uploaderFilter === u), onclick: () => { uploaderFilter = u; draw(); } }, l, h("span", { class: "n" }, u ? all.filter((m) => m.ownerId === u).length : all.length))))) : null,
      unassignedMemos().length ? h("div", { class: "notice", style: "margin-bottom:16px" }, svg(IC.inbox), h("span", null, plural(unassignedMemos().length, "memo") + " aren't linked to any company yet."), h("a", { class: "btn sm", href: "#unassigned" }, "Review")) : null,
      ms.length ? memoTable(ms, ps) : emptyState(IC.memos, "No memos yet", "Upload a voice memo, notes or a transcript from an interview.", S.can.write ? h("a", { class: "btn primary", href: "#new" }, svg(IC.plus), "New memo") : null));
  };
  currentView.refresh = draw; draw();
}
function viewUnassigned(view) {
  const draw = () => {
    const ms = unassignedMemos();
    view.replaceChildren(pageHead("Unassigned memos", "These aren't linked to a company, so they're left out of every company's findings until someone assigns them."),
      ms.length ? h("div", { class: "table" }, ms.map((m) => h("div", { class: "lrow", style: "grid-template-columns:minmax(0,1fr) auto" },
        h("div", { style: "min-width:0" }, h("h3", null, h("a", { href: "#m-" + m.id }, m.title || "Untitled memo")), h("small", null, [m.company && "Company field: " + m.company, fmtDate(m.createdAt)].filter(Boolean).join(" · "))),
        S.can.write && S.companies.length ? h("select", { class: "inp sm", "aria-label": "Assign " + (m.title || "memo") + " to a company", style: "width:auto", onchange: async (e) => { const cid = e.target.value; if (!cid) return; await S.db.doc("interviews/" + m.id).update({ companyId: cid, updatedAt: Date.now() }); logEvent(cid, "assign", `assigned “${m.title}” to this company`, { memoId: m.id }); toast("Assigned to " + company(cid).name); } },
          h("option", { value: "" }, "Assign to…"), S.companies.map((c) => h("option", { value: c.id }, c.name))) : null))) : emptyState(IC.inbox, "Nothing to assign", "Every memo belongs to a company."));
  };
  currentView.refresh = draw; draw();
}

// =====================================================================================
// Review status + DiagnosticCard
// =====================================================================================
// Review state as one small icon: accepted ✓, needs evidence ?, rejected ×, draft (dashed ring).
function statusIcon(st) {
  const d = {
    accepted: '<circle cx="7" cy="7" r="7" fill="var(--ok)"/><path d="M4.1 7.15 6.05 9.05 9.9 5.2" stroke="var(--bg)" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    needs_evidence: '<circle cx="7" cy="7" r="7" fill="var(--neck)"/><path d="M5.35 5.5a1.7 1.7 0 1 1 2.45 1.52c-.52.26-.83.63-.83 1.2v.3" stroke="#fff" stroke-width="1.25" fill="none" stroke-linecap="round"/><circle cx="6.97" cy="10.05" r=".78" fill="#fff"/>',
    rejected: '<circle cx="7" cy="7" r="7" fill="var(--fg-4)"/><path d="m4.9 4.9 4.2 4.2m0-4.2-4.2 4.2" stroke="var(--bg)" stroke-width="1.4" stroke-linecap="round"/>',
    draft: '<circle cx="7" cy="7" r="6.2" fill="none" stroke="var(--fg-4)" stroke-width="1.4" stroke-dasharray="2.2 1.8"/>',
  }[st] || "";
  return h("span", { class: "stat-ic", role: "img", "aria-label": REVIEW[st]?.[1] || "Draft", html: `<svg width="16" height="16" viewBox="0 0 14 14">${d}</svg>` });
}
const reviewTag = (f) => { const st = reviewOf(f.id), r = S.reviews[f.id]; return h("span", { class: "rv", title: r ? `${REVIEW[st][0]} ${fmtWhen(r.at)}` : "Not reviewed yet" }, statusIcon(st), REVIEW[st]?.[0] || "Draft"); };
async function setReview(f, status) {
  try {
    await S.db.doc("reviews/" + f.id).set({ companyId: f.companyId, findingId: f.id, status, by: S.uid, at: Date.now() });
    logEvent(f.companyId, "review", `marked “${f.title}” as ${REVIEW[status][1].toLowerCase()}`, { findingId: f.id });
    toast("Marked " + REVIEW[status][0].toLowerCase());
  } catch { toast("Only reviewers (Editors of this page) can record review decisions."); }
}
let teamCache = null;
async function teammates() {
  if (teamCache) return teamCache;
  try { teamCache = (await S.user?.search("")) || []; } catch { teamCache = []; }
  if (S.me?.id && !teamCache.some((p) => p.id === S.me.id)) teamCache.unshift({ id: S.me.id, name: S.me.name || "You" });
  return teamCache;
}
const openCards = new Set();
function DiagnosticCard(f, opts = {}) {
  const open = openCards.has(f.id);
  const el = h("article", { class: "dcard" + (open ? " open" : ""), id: "f-" + f.id });
  const st = reviewOf(f.id);
  const ev = arr(f.evidence);
  const head = h("button", { class: "dhead", type: "button", "aria-expanded": String(open), onclick: () => { if (openCards.has(f.id)) openCards.delete(f.id); else openCards.add(f.id); el.replaceWith(DiagnosticCard(f, opts)); } },
    h("div", { class: "dtop" }, reviewTag(f), kindTag(f.kind), h("span", { class: "ev-s" + (EVID[f.evidenceStatus]?.[1] ? " weak" : "") }, EVID[f.evidenceStatus]?.[0] || "Reported"),
      !ev.length ? h("span", { class: "ev-s weak" }, "No linked quote") : h("span", { class: "ev-s" }, plural(ev.length, "quote")),
      f.origin === "assistant" ? h("span", { class: "badge outline" }, "From Ask Starwell") : null,
      opts.similar ? h("span", { class: "badge outline", title: "Another finding has the same title" }, "Similar to another finding") : null,
      h("span", { class: "grow" }), prioTag(f.importance)),
    h("h3", null, f.title),
    f.ownerImplication ? h("p", { class: "impl" }, f.ownerImplication) : null,
    f.nextAction ? h("p", { class: "next" }, h("b", null, "Next: "), f.nextAction) : null);
  el.append(head);
  if (!open) return el;
  const main = h("div", { class: "dmain" });
  main.append(h("h4", null, "Supporting quotes"), ev.length ? ev.map((e) => h("div", { class: "evq" }, "“" + str(e.quote) + "”",
    h("footer", null, evLink(e.memoId || f.memoId, e.ref), e.check === "exact" ? h("span", { class: "badge ok" }, "Exact quote") : e.check === "paraphrase" ? h("span", { class: "badge warn" }, "Paraphrase") : e.check ? h("span", { class: "badge bad" }, "Not found in source") : null,
      memo(e.memoId || f.memoId) && (e.memoId || f.memoId) !== opts.memoId ? h("span", null, memo(e.memoId || f.memoId).title) : null))) : h("div", { class: "notice warn" }, h("span", null, "No passage is linked. Treat this as unsupported until evidence is added.")));
  if (f.symptom) main.append(h("h4", null, "What was observed"), h("p", null, f.symptom));
  if (arr(f.hypotheses).length) main.append(h("h4", null, "Possible causes"), h("ul", null, f.hypotheses.map((x) => h("li", null, str(x.claim), x.validation_needed ? h("div", { class: "sub" }, "To check: " + x.validation_needed) : null))));
  if (arr(f.alternatives).length) main.append(h("h4", null, "Other explanations"), h("ul", null, f.alternatives.map((x) => h("li", null, str(x)))));
  if (arr(f.missing).length) main.append(h("h4", null, "Missing information"), h("ul", null, f.missing.map((x) => h("li", null, str(x)))));
  if (f.solutionClass) main.append(h("h4", null, "Recommended approach"), h("p", null, SOLUTION[f.solutionClass] || f.solutionClass));
  const related = S.findings.filter((o) => o.id !== f.id && o.companyId === f.companyId && (o.id === f.relatedTo?.id || f.id === o.relatedTo?.id || (o.process && o.process === f.process && o.memoId !== f.memoId) || norm(o.title) === norm(f.title)));
  if (related.length) main.append(h("h4", null, "Connected findings"), h("ul", null, related.slice(0, 5).map((o) => h("li", null, h("a", { class: "textlink", href: "#f-" + o.id, onclick: (e) => { e.preventDefault(); S.focusFinding = o.id; location.hash = "#c-" + o.companyId + "-diagnostics"; render(true); } }, o.title), h("span", { class: "sub" }, " · " + (memo(o.memoId)?.title || "") + " · " + REVIEW[reviewOf(o.id)][0].toLowerCase()), f.relatedTo?.id === o.id ? h("span", { class: "badge outline", style: "margin-left:6px" }, f.relatedTo.relation) : null))));
  const meta = h("p", { class: "dmeta" });
  people([f.createdBy, f.editedBy, S.reviews[f.id]?.by, f.assigneeId]).then((ps) => {
    meta.textContent = [f.origin === "ai" ? "Drafted by the analysis of " + (memo(f.memoId)?.title || "a memo") : "Added by " + (ps[f.createdBy]?.name || "a teammate"), fmtDate(f.createdAt),
      f.editedBy ? "edited by " + (ps[f.editedBy]?.name || "a teammate") + " " + fmtWhen(f.editedAt) : null, S.reviews[f.id] ? REVIEW[st][1].toLowerCase() + " by " + (ps[S.reviews[f.id].by]?.name || "a reviewer") : "not reviewed"].filter(Boolean).join(" · ");
  });
  main.append(meta);
  // comments
  const cbox = h("div", { class: "comments" }, h("h4", { style: "margin-top:0" }, "Comments"));
  const clist = h("div"); cbox.append(clist);
  const loadComments = async () => {
    try {
      const snap = await S.db.collection("comments").where("findingId", "==", f.id).get();
      const cs = snap.docs.map((d) => d.data()).sort((a, b) => a.at - b.at);
      const ps = await people(cs.map((x) => x.by));
      clist.replaceChildren(...(cs.length ? cs.map((x) => h("div", { class: "comment" }, avatar(ps[x.by], ps[x.by]?.name, ""), h("div", null, h("b", { style: "font-weight:600" }, ps[x.by]?.name || "Someone"), h("small", null, " · " + fmtWhen(x.at)), h("p", null, x.text)))) : [h("p", { class: "hint" }, "No comments yet.")]));
    } catch { clist.replaceChildren(h("p", { class: "hint" }, "Comments couldn't be loaded.")); }
  };
  loadComments();
  if (S.can.write) { const ta = h("textarea", { class: "inp", rows: "1", placeholder: "Add a comment for the team", "aria-label": "Comment" });
    cbox.append(h("form", { class: "comment-form", onsubmit: async (e) => { e.preventDefault(); const t = str(ta.value); if (!t) return; try { await S.db.collection("comments").doc(newId("cm")).set({ companyId: f.companyId, findingId: f.id, by: S.uid, at: Date.now(), text: t }); ta.value = ""; logEvent(f.companyId, "comment", `commented on “${f.title}”`, { findingId: f.id }); loadComments(); } catch { toast("Couldn't post the comment."); } } }, ta, h("button", { class: "btn", type: "submit" }, "Comment"))); }
  main.append(cbox);
  // side: review first, then ownership and follow-ups
  const side = h("div", { class: "dside" });
  if (S.can.review) side.append(h("h4", null, "Review"), h("div", { class: "review-seg", role: "group", "aria-label": "Review decision" },
    [["accepted", "Accept"], ["needs_evidence", "Needs evidence"], ["rejected", "Reject"]].map(([k, l]) => h("button", { class: "btn sm" + (k === "accepted" && st !== "accepted" ? " primary" : "") + (k === "rejected" ? " ghost danger" : ""), type: "button", "aria-pressed": String(st === k), onclick: () => setReview(f, k) }, st === k ? statusIcon(k) : null, st === k ? REVIEW[k][0] : l))));
  const asg = h("div", { class: "field", style: "margin-top:8px" }, h("label", { for: "as-" + f.id, style: "font-size:12px;color:var(--fg-3)" }, "Owner"));
  const sel = h("select", { id: "as-" + f.id, class: "inp sm", disabled: !S.can.write, onchange: async (e) => { try { await S.db.doc("findings/" + f.id).update({ assigneeId: e.target.value || null, updatedAt: Date.now() }); logEvent(f.companyId, "assign", `assigned “${f.title}”`, { findingId: f.id }); } catch { toast("Couldn't save the owner."); } } }, h("option", { value: "" }, "Unassigned"));
  teammates().then(async (tm) => { const ids = new Set(tm.map((p) => p.id)); if (f.assigneeId && !ids.has(f.assigneeId)) { const ps = await people([f.assigneeId]); tm = [...tm, ps[f.assigneeId] || { id: f.assigneeId, name: "Teammate" }]; } for (const p of tm) sel.append(h("option", { value: p.id, selected: p.id === f.assigneeId }, p.name || "Teammate")); });
  asg.append(sel); side.append(asg);
  side.append(h("h4", { style: "margin-top:12px" }, "Follow up"));
  if (S.can.write) side.append(h("button", { class: "btn sm", type: "button", onclick: () => createTask({ title: f.nextAction || "Follow up: " + f.title, findingId: f.id, memoId: f.memoId, companyId: f.companyId }) }, svg(IC.actions), "Create task"),
    h("button", { class: "btn sm", type: "button", onclick: () => main.replaceWith(findingEditor(f, () => el.replaceWith(DiagnosticCard(f, opts)))) }, svg(IC.edit), "Edit"));
  side.append(h("button", { class: "btn sm", type: "button", onclick: () => { attachToChat({ companyId: f.companyId, memoId: f.memoId, ref: arr(f.evidence)[0]?.ref || null, text: f.title + ". " + (f.ownerImplication || ""), label: "Finding" }); openAssistant(); } }, svg(IC.spark), "Ask about this"));
  el.append(h("div", { class: "dbody" }, main, side));
  return el;
}
const SOLUTION = { process_clarification: "Clarify the process and who owns it", conventional_automation: "Conventional automation or a software rule", ai_assistance: "AI assistance", human_escalation: "Human escalation", additional_measurement: "Measure first before changing anything", investigate_before_automation: "Investigate before automating", no_change: "No change recommended" };
function findingEditor(f, done) {
  const v = { title: f.title, ownerImplication: f.ownerImplication, nextAction: f.nextAction, queue: f.queue, importance: f.importance, evidenceStatus: f.evidenceStatus };
  const startRev = f.rev || 1;
  const err = h("div", { class: "err", hidden: true });
  const inp = (k, l, el) => h("div", { class: "field" }, h("label", { for: "fe-" + k + f.id }, l), el);
  return h("form", { class: "dmain stack", style: "gap:14px", onsubmit: async (e) => {
    e.preventDefault();
    if (!str(v.title)) { err.textContent = "A finding needs a title."; err.hidden = false; return; }
    try {
      const cur = await S.db.doc("findings/" + f.id).get();
      if ((cur.data()?.rev || 1) !== startRev) { err.textContent = "Someone else changed this finding while you were editing. Close and reopen it to see their version, then edit again."; err.hidden = false; return; }
      await S.db.doc("findings/" + f.id).update({ ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, str(x)])), rev: startRev + 1, editedBy: S.uid, editedAt: Date.now() });
      logEvent(f.companyId, "edit", `edited “${str(v.title)}”`, { findingId: f.id });
      toast("Finding saved"); done();
    } catch { err.textContent = "Couldn't save. Try again."; err.hidden = false; }
  } },
    inp("title", "Title", h("input", { id: "fe-title" + f.id, value: v.title || "", oninput: (e) => (v.title = e.target.value) })),
    inp("impl", "Why it matters to the owner", h("textarea", { id: "fe-impl" + f.id, rows: "2", oninput: (e) => (v.ownerImplication = e.target.value) }, v.ownerImplication || "")),
    inp("next", "Next action", h("input", { id: "fe-next" + f.id, value: v.nextAction || "", oninput: (e) => (v.nextAction = e.target.value) })),
    h("div", { class: "grid2" },
      inp("queue", "Stage", h("select", { id: "fe-queue" + f.id, onchange: (e) => (v.queue = e.target.value) }, [["investigate_next", "Investigate next"], ["ready_to_test", "Ready to test"]].map(([k, l]) => h("option", { value: k, selected: v.queue === k }, l)))),
      inp("imp", "Business importance", h("select", { id: "fe-imp" + f.id, onchange: (e) => (v.importance = e.target.value) }, ["high", "medium", "low"].map((k) => h("option", { value: k, selected: v.importance === k }, k[0].toUpperCase() + k.slice(1))))),
      inp("ev", "Evidence status", h("select", { id: "fe-ev" + f.id, onchange: (e) => (v.evidenceStatus = e.target.value) }, Object.entries(EVID).map(([k, [l]]) => h("option", { value: k, selected: v.evidenceStatus === k }, l))))),
    err, h("div", { class: "row" }, h("button", { class: "btn primary sm", type: "submit" }, "Save finding"), h("button", { class: "btn sm", type: "button", onclick: done }, "Cancel")));
}

// =====================================================================================
// Findings page: filter by review state and type; grouped by stage, never scored
// =====================================================================================
let findFilter = { review: "all", kind: "all" };
function viewDiagnostics(view) {
  const draw = () => {
    const c = company(); if (!c) return;
    if (S.focusFinding) findFilter = { review: "all", kind: "all" };
    const allF = companyFindings();
    const byKind = allF.filter((f) => findFilter.kind === "all" || f.kind === findFilter.kind);
    const live = rankFindings(byKind);
    const n = (st) => st === "all" ? live.length : st === "rejected" ? byKind.filter((f) => reviewOf(f.id) === "rejected").length : live.filter((f) => reviewOf(f.id) === st).length;
    const shown = findFilter.review === "rejected" ? byKind.filter((f) => reviewOf(f.id) === "rejected") : findFilter.review === "all" ? live : live.filter((f) => reviewOf(f.id) === findFilter.review);
    const firstOf = new Map(); for (const f of rankFindings(allF)) if (!firstOf.has(norm(f.title))) firstOf.set(norm(f.title), f.id);
    const card = (f) => DiagnosticCard(f, { similar: firstOf.get(norm(f.title)) !== f.id && reviewOf(f.id) !== "rejected" });
    const q = (k) => shown.filter((f) => (f.queue || "investigate_next") === k);
    const kinds = [["all", "All types"], ["pain_point", "Pain points"], ["bottleneck", "Bottlenecks"], ["risk", "Risks"], ["opportunity", "Opportunities"]];
    view.replaceChildren(
      pageHead("Findings", "Drafted from each memo's analysis. They stay drafts until a reviewer accepts them; importance and evidence are rated separately."),
      !allF.length ? emptyState(IC.diag, "No findings yet", "Findings appear after a memo is analyzed. A memo can also produce none, if nothing actionable was said.") : [
        h("div", { class: "toolbar" },
          h("div", { class: "seg", role: "group", "aria-label": "Review state" }, [["all", "All"], ["draft", "To review"], ["accepted", "Accepted"], ["needs_evidence", "Needs evidence"], ["rejected", "Rejected"]].map(([k, l]) =>
            h("button", { type: "button", "aria-pressed": String(findFilter.review === k), onclick: () => { findFilter.review = k; draw(); } }, l, h("span", { class: "n" }, n(k))))),
          h("select", { class: "inp sm", style: "width:auto;margin-left:auto", "aria-label": "Type", onchange: (e) => { findFilter.kind = e.target.value; draw(); } }, kinds.map(([k, l]) => h("option", { value: k, selected: findFilter.kind === k }, l)))),
        !shown.length ? h("div", { class: "empty flat" }, h("p", null, "Nothing matches this filter.")) :
        findFilter.review === "rejected" ? h("div", { class: "dlist" }, shown.map(card)) :
        h("div", { class: "queues" },
          [["investigate_next", "Investigate next", "Potentially important, but needs more evidence before acting."], ["ready_to_test", "Ready to test", "Supported well enough to try a practical, reversible improvement."]].map(([k, t, d]) =>
            h("section", null, h("div", { class: "group-h" }, h("h2", null, t), h("span", { class: "cnt" }, q(k).length), h("p", null, d)),
              q(k).length ? h("div", { class: "dlist" }, q(k).map(card)) : h("p", { class: "hint", style: "padding:4px 0" }, "Nothing here."))))]);
    if (S.focusFinding) { const id = S.focusFinding; S.focusFinding = null; openCards.add(id); const el = $("#f-" + id); const f = S.findings.find((x) => x.id === id); if (el && f) { el.replaceWith(card(f)); $("#f-" + id)?.scrollIntoView({ block: "center" }); } }
  };
  currentView.refresh = () => { if (!document.querySelector(".dcard form, .dcard textarea:focus, .dcard select:focus")) draw(); };
  draw();
}

// =====================================================================================
// Key numbers: one row per figure (merged across memos), what it measures, where it was said, how sure we are
// =====================================================================================
const SOURCE_PLAIN = { reported: "Said in conversation", measured: "From a record", calculated: "Calculated", scenario: "What-if estimate", external: "Outside benchmark" };
function valueWithPeriod(x) {
  const v = str(x.value), p = str(x.period).toLowerCase();
  if (!v || !p || v.toLowerCase().includes(p) || /\b(a|per|each|every)\s+(month|week|year|day)/i.test(v)) return v;
  return v + " / " + p.replace(/^per\s+/, "");
}
function confidence(x) {
  const cav = str(x.caveat);
  if (/not reconciled|conflict|contradict|inconsistent/i.test(cav)) return h("span", { class: "badge warn" }, "Conflicting");
  if (x.classification === "measured") return h("span", { class: "badge ok" }, "From a record");
  if (x.classification === "scenario" || /estimate|approximate|guess|aspiration|unclear|not verified/i.test(cav)) return h("span", { class: "badge warn" }, x.classification === "scenario" ? "What-if estimate" : "Estimate");
  return h("span", { class: "badge" }, SOURCE_PLAIN[x.classification] || "Said in conversation");
}
function MetricCard(row, opts = {}) {
  const { x, all } = row.x ? row : { x: row, all: [row] };
  const cav = str(x.caveat);
  const shaky = /not reconciled|unclear|conflict|contradict|inconsistent|estimate|approximate|guess|aspiration|not verified/i.test(cav);
  const ms = [...new Set(all.map((y) => y.memoId))].map(memo).filter(Boolean);
  return h("article", { class: "mcard" },
    h("div", { class: "mval num" }, valueWithPeriod(x)),
    h("div", { class: "mwhat", style: "min-width:0" }, h("h3", null, str(x.label)), str(x.definition) ? h("p", { class: "mdef" }, x.definition) : null,
      cav ? h("p", { class: "mwarn" + (shaky ? " shaky" : "") }, (shaky ? "Check: " : "Note: ") + cav) : null),
    opts.inMemo ? null : h("div", { class: "msrc" }, h("div", { class: "t" }, SOURCE_PLAIN[x.classification] || "Said in conversation"), h("div", { class: "t muted" }, ms.length > 1 ? plural(ms.length, "memo") + " agree" : ms[0]?.title || "—"),
      h("div", { class: "refs" }, all.filter((y) => y.ref).map((y) => evLink(y.memoId, y.ref, all.length > 1 ? (memo(y.memoId)?.interviewee || "See where") : "See where")))),
    h("div", { class: "mconf" }, confidence(x), opts.inMemo && x.ref ? h("div", { style: "margin-top:6px" }, evLink(x.memoId, x.ref, "See where")) : null));
}
function metricsTable(rows, opts = {}) {
  return h("div", { class: "mtable" + (opts.inMemo ? " compact" : "") }, h("div", { class: "thead", role: "presentation" }, h("span", null, "Figure"), h("span", null, "What it measures"), opts.inMemo ? null : h("span", null, "Source"), h("span", null, "Confidence")), rows.map((r) => MetricCard(r, opts)));
}
function viewMetrics(view) {
  const draw = () => {
    const c = company(); if (!c) return;
    const rows = metricRows(c.id);
    const noValue = [...new Map(S.metrics.filter((x) => x.companyId === c.id && !str(x.value)).map((x) => [norm(x.label), x])).values()];
    // newest memo first, then in the order they were said
    const order = new Map(companyMemos().map((m, i) => [m.id, i]));
    rows.sort((a, b) => (order.get(a.x.memoId) ?? 99) - (order.get(b.x.memoId) ?? 99) || cmpRef(a.x.ref || "0.0", b.x.ref || "0.0"));
    view.replaceChildren(
      pageHead("Key numbers", "Every figure someone mentioned in " + c.name + "'s memos. Most were said out loud, not checked against records, so treat them as a starting point."),
      rows.length ? metricsTable(rows) : null,
      noValue.length ? h("section", { class: "sec" }, h("div", { class: "sec-h" }, h("h2", null, "Mentioned without a number"), h("p", null, "These came up, but nobody gave a figure. Worth asking about next time.")),
        h("div", { class: "card" }, h("ul", { class: "missing" }, noValue.map((x) => h("li", null, h("span", { style: "font-weight:500" }, str(x.label)), str(x.caveat) ? h("span", { class: "muted" }, x.caveat) : null, x.ref ? evLink(x.memoId, x.ref, "See where") : null))))) : null,
      !S.metrics.some((x) => x.companyId === c.id) ? emptyState(IC.metrics, "No numbers yet", "Figures people mention in memos (revenue, call volumes, team size, hours lost) show up here with where they were said.") : null);
  };
  currentView.refresh = draw; draw();
}

// =====================================================================================
// Tasks
// =====================================================================================
async function createTask(t) {
  if (!S.db || !t.companyId) return;
  try {
    const id = newId("tk");
    await S.db.doc("tasks/" + id).set({ companyId: t.companyId, title: str(t.title), findingId: t.findingId || null, memoId: t.memoId || null, assigneeId: t.assigneeId || null, due: t.due || "", done: false, createdAt: Date.now(), createdBy: S.uid });
    logEvent(t.companyId, "task", `created the task “${str(t.title)}”`, { taskId: id });
    toast("Task added to Tasks");
  } catch { toast("Couldn't create the task."); }
}
function viewActions(view) {
  const alive = liveCheck();
  const draw = async () => {
    const c = company(); if (!c) return;
    const ts = S.tasks.filter((t) => t.companyId === c.id);
    const open = ts.filter((t) => !t.done).sort((a, b) => (a.due || "9999") < (b.due || "9999") ? -1 : (a.due || "9999") > (b.due || "9999") ? 1 : b.createdAt - a.createdAt);
    const done = ts.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    const ps = await people(ts.flatMap((t) => [t.assigneeId, t.createdBy]));
    const tm = await teammates();
    if (!alive()) return;
    const today = new Date().toISOString().slice(0, 10);
    const nv = { title: "", assigneeId: "", due: "" };
    const row = (t) => {
      const f = S.findings.find((x) => x.id === t.findingId);
      return h("div", { class: "task" + (t.done ? " done" : "") },
        h("input", { type: "checkbox", checked: t.done, disabled: !S.can.write, "aria-label": (t.done ? "Reopen " : "Complete ") + t.title, onchange: async (e) => { try { await S.db.doc("tasks/" + t.id).update({ done: e.target.checked, doneAt: e.target.checked ? Date.now() : null, doneBy: S.uid }); logEvent(c.id, "task", `${e.target.checked ? "completed" : "reopened"} “${t.title}”`, { taskId: t.id }); } catch { toast("Couldn't update the task."); } } }),
        h("div", { style: "min-width:0" }, h("div", { class: "tt" }, t.title),
          h("small", null, f ? ["From ", h("a", { href: "#c-" + c.id + "-diagnostics", onclick: () => { S.focusFinding = f.id; } }, f.title), " · "] : null, "Added by " + (ps[t.createdBy]?.name || "a teammate") + " " + fmtWhen(t.createdAt))),
        h("span", { class: "c-as row", style: "font-size:13px;color:var(--fg-2)" }, t.assigneeId ? [avatar(ps[t.assigneeId], ps[t.assigneeId]?.name, "xs"), h("span", { style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, ps[t.assigneeId]?.name || "Teammate")] : h("span", { class: "muted" }, "Unassigned")),
        h("span", { class: "due num" + (!t.done && t.due && t.due < today ? " late" : "") }, t.due ? fmtShort(t.due) : h("span", { class: "muted" }, "No date")),
        t.memoId && memo(t.memoId) ? h("a", { class: "icon-btn sm", href: "#m-" + t.memoId, "aria-label": "Open the memo", title: memo(t.memoId).title }, svg(IC.memo)) : h("span"));
    };
    view.replaceChildren(
      pageHead("Tasks", "Follow-ups, checks and pilots for " + c.name + ". Nothing here contacts the customer or changes their systems; people do that."),
      S.can.write ? h("form", { class: "task-add", onsubmit: async (e) => { e.preventDefault(); if (!str(nv.title)) { $("#nt-title").focus(); return; } await createTask({ ...nv, companyId: c.id }); } },
        h("label", { class: "sr", for: "nt-title" }, "New task"), h("input", { id: "nt-title", class: "inp t-in", placeholder: "Add a task, e.g. Pull last month's missed-call log", oninput: (e) => (nv.title = e.target.value) }),
        h("select", { id: "nt-as", class: "inp", "aria-label": "Assign to", onchange: (e) => (nv.assigneeId = e.target.value) }, h("option", { value: "" }, "Unassigned"), tm.map((p) => h("option", { value: p.id }, p.name || "Teammate"))),
        h("input", { id: "nt-due", class: "inp", type: "date", "aria-label": "Due date", oninput: (e) => (nv.due = e.target.value) }),
        h("button", { class: "btn primary", type: "submit" }, svg(IC.plus), "Add task")) : null,
      ts.length ? [
        h("section", null, h("div", { class: "group-h" }, h("h2", null, "Open"), h("span", { class: "cnt" }, open.length)), open.length ? h("div", { class: "table" }, open.map(row)) : h("p", { class: "hint" }, "Everything's done.")),
        done.length ? h("section", { class: "sec" }, h("div", { class: "group-h" }, h("h2", null, "Completed"), h("span", { class: "cnt" }, done.length)), h("div", { class: "table" }, done.map(row))) : null]
        : emptyState(IC.actions, "No tasks yet", "Create one here, from a finding, or from an Ask Starwell answer."));
  };
  currentView.refresh = () => { if (!document.activeElement?.closest("form")) draw(); };
  draw();
}
