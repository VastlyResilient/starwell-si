
// =====================================================================================
// Segments + EvidenceLink
// =====================================================================================
const refLabel = (s) => s.t != null ? fmtClock(s.t) : "¶ " + s.id;
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
  else getSegments(mid).then((ss) => { const s = ss.find((x) => x.id === ref); if (s) { if (!label) b.textContent = refLabel(s); b.title = s.text.slice(0, 280); } else { b.title = "This reference isn't in the memo's source text."; b.classList.add("c-bad"); } });
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
// Overview: what matters most, why, what supports it, what's unknown, what next
// =====================================================================================
const IMPORTANCE = { high: 0, medium: 1, low: 2 };
function rankFindings(list) {
  const rv = { accepted: 0, draft: 1, needs_evidence: 2 };
  return list.filter((f) => reviewOf(f.id) !== "rejected").sort((a, b) => (IMPORTANCE[a.importance] ?? 3) - (IMPORTANCE[b.importance] ?? 3) || (rv[reviewOf(a.id)] ?? 3) - (rv[reviewOf(b.id)] ?? 3) || b.createdAt - a.createdAt);
}
function viewOverview(view) {
  view.className = "view wide enter";
  setTimeout(() => view.classList.remove("enter"), 2400);
  let editing = false;
  const draw = async () => {
    const c = company(); if (!c) return;
    const ms = companyMemos(), fs = rankFindings(companyFindings()), top = fs.slice(0, 3);
    const tasks = S.tasks.filter((t) => t.companyId === c.id && !t.done);
    const gaps = [...new Set([...ms.flatMap((m) => arr(m.openQuestions)), ...fs.flatMap((f) => arr(f.missing))].map(str).filter(Boolean))].slice(0, 8);
    const evs = S.events.filter((e) => e.companyId === c.id).slice(0, 12);
    const ps = await people([...evs.map((e) => e.by), ...tasks.map((t) => t.assigneeId), ...ms.map((m) => m.ownerId)]);
    const P = { ...(c.profile || {}) }; if (!str(P.industry)) P.industry = c.industry || "";
    const filled = PROFILE_FIELDS.filter(([k]) => str(P[k])), blank = PROFILE_FIELDS.length - filled.length;
    const sugg = ms.find((m) => m.profileSuggestion && Object.entries(m.profileSuggestion).some(([k, v]) => str(v) && !str(P[k])));
    const processing = ms.filter((m) => m.status === "analyzing" && !isStale(m));
    const nextTask = tasks[0];
    const goFinding = (f) => (e) => { e.preventDefault(); S.focusFinding = f.id; location.hash = "#c-" + c.id + "-diagnostics"; render(true); };
    view.replaceChildren(
      h("div", { class: "page-h ov-head" }, h("div", null,
        h("div", { class: "crumb" }, "Company overview"),
        h("h1", null, c.name),
        h("p", null, [c.industry, P.size_and_team, P.locations].filter(str).join(" · ") || "Profile not filled in yet."))),
      // the cyan band with the priorities card sitting on it
      ms.length ? [h("div", { class: "band ov-band", role: "presentation" }),
        h("section", { class: "band-card", "aria-label": "What matters most" },
          h("div", { class: "bc-eyebrow" }, `# ${c.name} / ${ms.length} memo${ms.length === 1 ? "" : "s"} · ${fs.length} finding${fs.length === 1 ? "" : "s"}`),
          h("div", { class: "bc-title" }, "What matters most"),
          h("div", { class: "bc-panel" }, h("h3", null, top.length ? "Top priorities" : "No findings yet"),
            top.length ? top.map((f) => h("a", { class: "brow", href: "#c-" + c.id + "-diagnostics", onclick: goFinding(f) }, statusIcon(reviewOf(f.id)),
              h("div", { style: "min-width:0" }, h("b", null, f.title), h("small", null, f.nextAction ? "Next: " + f.nextAction : f.ownerImplication)),
              h("span", { class: "chip " + (EVID[f.evidenceStatus]?.[1] || "c-line") }, EVID[f.evidenceStatus]?.[0] || "Reported")))
              : h("p", { style: "font-size:14px;color:#6b6b6b;padding:4px 0 6px" }, "They appear here after a memo is analyzed. Ranked by business importance, then review status; evidence strength is shown on each."),
            fs.length > 3 ? h("a", { class: "btn ghost sm", href: "#c-" + c.id + "-diagnostics", style: "margin-top:8px;color:#000" }, `All ${fs.length} findings →`) : null))] : null,
      processing.length ? h("div", { class: "notice info", style: "margin-bottom:18px" }, h("span", null, `${processing.length} memo${processing.length > 1 ? "s are" : " is"} being analyzed. Findings appear here when ready.`), h("a", { class: "btn sm", href: "#m-" + processing[0].id }, "Watch progress")) : null,
      !ms.length ? h("div", { class: "empty" }, h("h3", null, "No memos for " + c.name + " yet"), h("p", null, "Upload a voice memo, a document or a pasted transcript. Starwell organizes it, annotates it and drafts findings with links to the exact passages."), S.can.write ? h("a", { class: "btn primary", href: "#new" }, "Add the first memo") : null) : null,
      ms.length ? h("div", { class: "cols", style: "margin-top:34px" },
        h("div", null,
          h("section", { class: "sec", style: "margin-top:0" }, h("h2", null, "What's still unknown"), h("p", { class: "lede" }, "Open questions and missing evidence from the memos. These are coverage gaps, not confirmed problems."),
            gaps.length ? h("ul", { class: "gaps" }, gaps.map((g) => h("li", null, g))) : h("p", { class: "muted" }, "None recorded yet.")),
          h("section", { class: "sec" }, h("h2", null, "Next recommended action"),
            nextTask ? h("div", { class: "card" }, h("b", null, nextTask.title), h("div", { class: "row-meta" }, nextTask.assigneeId ? "Assigned to " + (ps[nextTask.assigneeId]?.name || "a teammate") : "Unassigned", nextTask.due ? "Due " + fmtDate(nextTask.due) : null, h("a", { href: "#c-" + c.id + "-actions" }, "Open actions")))
              : top[0]?.nextAction ? h("div", { class: "card" }, h("p", null, top[0].nextAction), h("div", { class: "row-meta" }, "From: " + top[0].title, S.can.write ? h("button", { class: "btn sm", type: "button", onclick: () => createTask({ title: top[0].nextAction, findingId: top[0].id, memoId: top[0].memoId, companyId: c.id }) }, "Create task") : null))
              : h("p", { class: "muted" }, "Nothing yet."))),
        h("div", null,
          h("section", { class: "sec", style: "margin-top:0" }, h("div", { class: "qh" }, h("h2", null, "Company profile"), S.can.write ? h("button", { class: "btn ghost sm", type: "button", style: "margin-left:auto", onclick: () => { editing = !editing; draw(); } }, editing ? "Close" : "Edit") : null),
            editing ? profileForm(c, () => { editing = false; draw(); }) : [filled.length ? h("dl", { class: "profile" }, filled.map(([k, l]) => [h("dt", null, l), h("dd", null, str(P[k]))])) : null, blank ? h("p", { class: "hint", style: "margin-top:8px" }, filled.length ? `${blank} more field${blank > 1 ? "s" : ""} not recorded yet.` : "Nothing recorded yet. Fill it in, or apply details found in a memo.") : null],
            sugg && S.can.write && !editing ? h("div", { class: "notice info", style: "margin-top:10px" }, h("span", null, "“" + sugg.title + "” mentions profile details that aren't recorded yet."), h("button", { class: "btn sm", type: "button", onclick: () => applyProfile(c, sugg) }, "Review and apply")) : null),
          h("section", { class: "sec" }, h("h2", null, "Recent memos"), h("div", { class: "list" }, ms.slice(0, 5).map((m) => memoRow(m, ps)))),
          h("section", { class: "sec" }, h("h2", null, "Activity"),
            evs.length ? h("ul", { class: "feed" }, evs.map((e) => h("li", null, h("img", { src: ps[e.by]?.avatarUrl || "", alt: "" }), h("div", null, h("b", { style: "font-weight:500" }, ps[e.by]?.name || "Someone"), " " + e.text, h("br"), h("small", null, fmtWhen(e.at)))))) : h("p", { class: "muted" }, "No activity yet.")))) : null);
  };
  currentView.refresh = draw; draw();
}
const PROFILE_FIELDS = [["what_they_do", "What they do"], ["industry", "Industry"], ["size_and_team", "Size and team"], ["locations", "Service area"], ["offerings", "Services"], ["customers", "Customers"], ["business_model", "Business model"], ["tools_and_systems", "Software and tools"], ["goals", "Current goals"], ["constraints", "Known constraints"]];
function profileForm(c, done) {
  const v = { ...(c.profile || {}) }; if (!v.industry) v.industry = c.industry || "";
  return h("form", { class: "stack", onsubmit: async (e) => { e.preventDefault(); try { await S.db.doc("companies/" + c.id).update({ profile: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, str(x)])), industry: str(v.industry), updatedAt: Date.now() }); logEvent(c.id, "profile", "updated the company profile"); toast("Profile saved"); done(); } catch { toast("Couldn't save the profile."); } } },
    PROFILE_FIELDS.map(([k, l]) => h("div", { class: "field" }, h("label", { for: "p-" + k }, l), h("input", { id: "p-" + k, value: v[k] || "", oninput: (e) => (v[k] = e.target.value) }))),
    h("div", { class: "dactions" }, h("button", { class: "btn primary sm", type: "submit" }, "Save profile"), h("button", { class: "btn sm", type: "button", onclick: done }, "Cancel")));
}
async function applyProfile(c, m) {
  const P = { ...(c.profile || {}) }; let n = 0;
  for (const [k, v] of Object.entries(m.profileSuggestion || {})) if (str(v) && !str(P[k]) && PROFILE_FIELDS.some(([f]) => f === k)) { P[k] = str(v); n++; }
  try { await S.db.doc("companies/" + c.id).update({ profile: P, updatedAt: Date.now() }); logEvent(c.id, "profile", `filled ${n} profile field(s) from “${m.title}”`, { memoId: m.id }); toast(`Added ${n} field(s). Edit them if anything is off.`); } catch { toast("Couldn't update the profile."); }
}

// =====================================================================================
// Memos list + Unassigned queue
// =====================================================================================
function statusChip(m) {
  if (S.pending.has(m.id)) return h("span", { class: "chip c-info" }, h("i"), "Saving");
  if (m.status === "ready") return h("span", { class: "chip c-ok" }, h("i"), "Ready");
  if (m.status === "error") return h("span", { class: "chip c-bad" }, h("i"), "Needs attention");
  if (isStale(m)) return h("span", { class: "chip c-warn" }, h("i"), "Paused");
  return h("span", { class: "chip c-info" }, h("i"), "Analyzing");
}
function memoRow(m, ps) {
  return h("a", { class: "lrow", href: "#m-" + m.id },
    h("div", { style: "min-width:0" }, h("h3", null, m.title || "Untitled memo"), h("small", null, [m.interviewee && m.interviewee + (m.role ? ", " + m.role : ""), m.type, m.recordedDate ? "Recorded " + fmtDate(m.recordedDate) : null].filter(Boolean).join(" · "))),
    h("div", { class: "who muted", style: "font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, ps[m.ownerId]?.name || ""),
    h("div", null, statusChip(m)));
}
let uploaderFilter = "";
function viewMemos(view) {
  const draw = async () => {
    const c = company(); if (!c) return;
    const all = companyMemos();
    const ups = [...new Set(all.map((m) => m.ownerId).filter(Boolean))];
    const ms = uploaderFilter ? all.filter((m) => m.ownerId === uploaderFilter) : all;
    const pu = await people(ups);
    const ps = await people(ms.map((m) => m.ownerId));
    view.replaceChildren(h("div", { class: "page-h" }, h("div", null, h("div", { class: "crumb" }, c.name), h("h1", null, "Memos"), h("p", null, "Voice memos, transcripts and notes for " + c.name + ". Each keeps its original wording alongside the organized version.")),
      S.can.write ? h("a", { class: "btn primary", href: "#new" }, svg(IC.plus), "New memo") : null),
      ups.length > 1 ? h("div", { class: "seg uploader", role: "group", "aria-label": "Uploaded by" }, [["", "Everyone"], ...ups.map((u) => [u, pu[u]?.name || "Teammate"])].map(([u, l]) => h("button", { type: "button", "aria-pressed": String(uploaderFilter === u), onclick: () => { uploaderFilter = u; draw(); } }, l))) : null,
      ms.length ? h("div", { class: "list" }, ms.map((m) => memoRow(m, ps))) : h("div", { class: "empty" }, h("h3", null, "No memos yet"), S.can.write ? h("a", { class: "btn primary", href: "#new" }, "Add a memo") : null));
  };
  currentView.refresh = draw; draw();
}
function viewUnassigned(view) {
  const draw = () => {
    const ms = unassignedMemos();
    view.replaceChildren(h("div", { class: "page-h" }, h("div", null, h("h1", null, "Unassigned memos"), h("p", null, "These memos aren't linked to a company, so they're left out of every company's diagnostics until someone assigns them."))),
      ms.length ? h("div", { class: "list" }, ms.map((m) => h("div", { class: "lrow", style: "grid-template-columns:minmax(0,1fr) auto" },
        h("div", { style: "min-width:0" }, h("h3", null, h("a", { href: "#m-" + m.id }, m.title || "Untitled memo")), h("small", null, [m.company && "Company field: " + m.company, fmtDate(m.createdAt)].filter(Boolean).join(" · "))),
        S.can.write && S.companies.length ? h("select", { class: "inp", "aria-label": "Assign " + (m.title || "memo") + " to a company", style: "width:auto", onchange: async (e) => { const cid = e.target.value; if (!cid) return; await S.db.doc("interviews/" + m.id).update({ companyId: cid, updatedAt: Date.now() }); logEvent(cid, "assign", `assigned “${m.title}” to this company`, { memoId: m.id }); toast("Assigned to " + company(cid).name); } },
          h("option", { value: "" }, "Assign to…"), S.companies.map((c) => h("option", { value: c.id }, c.name))) : null))) : h("div", { class: "empty" }, "Nothing to assign."));
  };
  currentView.refresh = draw; draw();
}

// =====================================================================================
// ReviewStatus + DiagnosticCard
// =====================================================================================
// Small status circles, as in the reference rows: accepted ✓, needs evidence ?, rejected ×, draft ○.
function statusIcon(st) {
  const d = {
    accepted: '<circle cx="7" cy="7" r="7" fill="#2a9a30"/><path d="M4.1 7.15 6.05 9.05 9.9 5.2" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    needs_evidence: '<circle cx="7" cy="7" r="7" fill="#f6a825"/><path d="M5.35 5.5a1.7 1.7 0 1 1 2.45 1.52c-.52.26-.83.63-.83 1.2v.3" stroke="#fff" stroke-width="1.25" fill="none" stroke-linecap="round"/><circle cx="6.97" cy="10.05" r=".78" fill="#fff"/>',
    rejected: '<circle cx="7" cy="7" r="7" fill="#b8b8b8"/><path d="m4.9 4.9 4.2 4.2m0-4.2-4.2 4.2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>',
    draft: '<circle cx="7" cy="7" r="6.2" fill="none" stroke="#b8b8b8" stroke-width="1.4" stroke-dasharray="2.2 1.8"/>',
  }[st] || "";
  return h("span", { class: "stat-ic", role: "img", "aria-label": REVIEW[st]?.[0] || "Draft", html: `<svg width="16" height="16" viewBox="0 0 14 14">${d}</svg>` });
}
function reviewChip(f) {
  const r = S.reviews[f.id], st = reviewOf(f.id);
  const c = chipOf(REVIEW, st);
  if (r) c.title = `${REVIEW[st]?.[0]} ${fmtWhen(r.at)}`;
  return c;
}
async function setReview(f, status) {
  try {
    await S.db.doc("reviews/" + f.id).set({ companyId: f.companyId, findingId: f.id, status, by: S.uid, at: Date.now() });
    logEvent(f.companyId, "review", `marked “${f.title}” as ${REVIEW[status][0].toLowerCase()}`, { findingId: f.id });
    toast("Review saved");
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
  const el = h("article", { class: "dcard", id: "f-" + f.id });
  const open = openCards.has(f.id);
  const st = reviewOf(f.id);
  const head = h("button", { class: "dhead", type: "button", "aria-expanded": String(open), onclick: () => { if (openCards.has(f.id)) openCards.delete(f.id); else openCards.add(f.id); el.replaceWith(DiagnosticCard(f, opts)); } },
    h("div", { class: "dtop" }, statusIcon(st), chipOf(KIND, f.kind), chipOf(EVID, f.evidenceStatus), reviewChip(f), f.importance ? h("span", { class: "chip c-line" }, "Importance: " + f.importance) : null, f.origin === "assistant" ? h("span", { class: "chip c-line" }, "From Ask Starwell") : null),
    h("h3", null, f.title),
    f.ownerImplication ? h("p", { class: "impl" }, f.ownerImplication) : null,
    f.priorityReason ? h("p", { class: "why" }, "Why it's ranked here: " + f.priorityReason) : null,
    f.nextAction ? h("p", { class: "next" }, h("b", null, "Next: "), f.nextAction) : null);
  el.append(head);
  if (!open) return el;
  const body = h("div", { class: "dbody" });
  const ev = arr(f.evidence);
  body.append(h("h4", null, "Supporting passages"), ev.length ? ev.map((e) => h("div", { class: "evq" }, "“" + str(e.quote) + "”",
    h("footer", null, evLink(e.memoId || f.memoId, e.ref), e.check === "exact" ? h("span", { class: "chip c-ok" }, "Exact quote") : e.check === "paraphrase" ? h("span", { class: "chip c-warn" }, "Paraphrase") : e.check ? h("span", { class: "chip c-bad" }, "Not found in source") : null,
      memo(e.memoId || f.memoId) && (e.memoId || f.memoId) !== opts.memoId ? h("span", { class: "muted", style: "font-size:12.5px" }, memo(e.memoId || f.memoId).title) : null))) : h("p", { class: "muted" }, "No passage is linked. Treat this as unsupported until evidence is added."));
  if (f.symptom) body.append(h("h4", null, "What was observed"), h("p", null, f.symptom));
  if (arr(f.hypotheses).length) body.append(h("h4", null, "Possible causes (hypotheses)"), h("ul", { class: "plain" }, f.hypotheses.map((x) => h("li", null, str(x.claim), x.validation_needed ? h("div", { class: "muted", style: "font-size:13.5px" }, "To check: " + x.validation_needed) : null))));
  if (arr(f.alternatives).length) body.append(h("h4", null, "Other explanations"), h("ul", { class: "plain" }, f.alternatives.map((x) => h("li", null, str(x)))));
  if (arr(f.missing).length) body.append(h("h4", null, "Missing information"), h("ul", { class: "plain" }, f.missing.map((x) => h("li", null, str(x)))));
  if (f.solutionClass) body.append(h("h4", null, "Recommended approach"), h("p", null, SOLUTION[f.solutionClass] || f.solutionClass));
  const related = S.findings.filter((o) => o.id !== f.id && o.companyId === f.companyId && (o.id === f.relatedTo?.id || f.id === o.relatedTo?.id || (o.process && o.process === f.process && o.memoId !== f.memoId)));
  if (related.length) body.append(h("h4", null, "Connected findings"), h("ul", { class: "plain" }, related.slice(0, 5).map((o) => h("li", null, h("a", { href: "#f-" + o.id, onclick: (e) => { e.preventDefault(); S.focusFinding = o.id; location.hash = "#c-" + o.companyId + "-diagnostics"; render(true); } }, o.title), h("span", { class: "muted" }, " · " + (memo(o.memoId)?.title || "")), f.relatedTo?.id === o.id ? h("span", { class: "chip c-line", style: "margin-left:6px" }, f.relatedTo.relation) : null))));
  const meta = h("p", { class: "muted", style: "font-size:12.5px;margin-top:14px" });
  people([f.createdBy, f.editedBy, S.reviews[f.id]?.by, f.assigneeId]).then((ps) => {
    meta.textContent = [f.origin === "ai" ? "Drafted by the analysis of " + (memo(f.memoId)?.title || "a memo") : "Added by " + (ps[f.createdBy]?.name || "a teammate"), fmtDate(f.createdAt),
      f.editedBy ? "edited by " + (ps[f.editedBy]?.name || "a teammate") + " " + fmtWhen(f.editedAt) : null, S.reviews[f.id] ? REVIEW[st][0].toLowerCase() + " by " + (ps[S.reviews[f.id].by]?.name || "a reviewer") : "not reviewed"].filter(Boolean).join(" · ");
  });
  body.append(meta);
  // assignee
  const asg = h("div", { class: "field", style: "max-width:280px;margin-top:12px" }, h("label", { for: "as-" + f.id }, "Owner of this finding"));
  const sel = h("select", { id: "as-" + f.id, disabled: !S.can.write, onchange: async (e) => { try { await S.db.doc("findings/" + f.id).update({ assigneeId: e.target.value || null, updatedAt: Date.now() }); logEvent(f.companyId, "assign", `assigned “${f.title}”`, { findingId: f.id }); } catch { toast("Couldn't save the owner."); } } }, h("option", { value: "" }, "Unassigned"));
  teammates().then(async (tm) => { const ids = new Set(tm.map((p) => p.id)); if (f.assigneeId && !ids.has(f.assigneeId)) { const ps = await people([f.assigneeId]); tm = [...tm, ps[f.assigneeId] || { id: f.assigneeId, name: "Teammate" }]; } for (const p of tm) sel.append(h("option", { value: p.id, selected: p.id === f.assigneeId }, p.name || "Teammate")); });
  asg.append(sel); body.append(asg);
  // actions
  const acts = h("div", { class: "dactions" });
  if (S.can.review) acts.append(...[["accepted", "Accept"], ["needs_evidence", "Needs evidence"], ["rejected", "Reject"]].map(([k, l]) => h("button", { class: "btn sm" + (st === k ? " primary" : ""), type: "button", "aria-pressed": String(st === k), onclick: () => setReview(f, k) }, l)));
  if (S.can.write) acts.append(h("button", { class: "btn sm", type: "button", onclick: () => createTask({ title: f.nextAction || "Follow up: " + f.title, findingId: f.id, memoId: f.memoId, companyId: f.companyId }) }, "Create task"),
    h("button", { class: "btn sm", type: "button", onclick: () => body.replaceWith(findingEditor(f, () => el.replaceWith(DiagnosticCard(f, opts)))) }, "Edit"));
  acts.append(h("button", { class: "btn sm ghost", type: "button", onclick: () => { attachToChat({ companyId: f.companyId, memoId: f.memoId, ref: arr(f.evidence)[0]?.ref || null, text: f.title + ". " + (f.ownerImplication || ""), label: "Finding" }); openAssistant(); } }, "Ask about this"));
  body.append(acts);
  // comments
  const cbox = h("div", { style: "margin-top:16px" }, h("h4", null, "Comments"));
  const clist = h("div"); cbox.append(clist);
  const loadComments = async () => {
    try {
      const snap = await S.db.collection("comments").where("findingId", "==", f.id).get();
      const cs = snap.docs.map((d) => d.data()).sort((a, b) => a.at - b.at);
      const ps = await people(cs.map((x) => x.by));
      clist.replaceChildren(...(cs.length ? cs.map((x) => h("div", { class: "comment" }, h("b", { style: "font-weight:500" }, ps[x.by]?.name || "Someone"), h("small", null, " · " + fmtWhen(x.at)), h("p", null, x.text))) : [h("p", { class: "muted", style: "font-size:13.5px" }, "No comments yet.")]));
    } catch { clist.replaceChildren(h("p", { class: "muted" }, "Comments couldn't be loaded.")); }
  };
  loadComments();
  if (S.can.write) { const ta = h("textarea", { class: "inp", rows: "2", placeholder: "Add a comment for the team", "aria-label": "Comment" });
    cbox.append(h("form", { class: "stack", style: "margin-top:8px", onsubmit: async (e) => { e.preventDefault(); const t = str(ta.value); if (!t) return; try { await S.db.collection("comments").doc(newId("cm")).set({ companyId: f.companyId, findingId: f.id, by: S.uid, at: Date.now(), text: t }); ta.value = ""; logEvent(f.companyId, "comment", `commented on “${f.title}”`, { findingId: f.id }); loadComments(); } catch { toast("Couldn't post the comment."); } } }, ta, h("div", null, h("button", { class: "btn sm", type: "submit" }, "Comment")))); }
  body.append(cbox);
  el.append(body);
  return el;
}
const SOLUTION = { process_clarification: "Clarify the process and who owns it", conventional_automation: "Conventional automation or a software rule", ai_assistance: "AI assistance", human_escalation: "Human escalation", additional_measurement: "Measure first before changing anything", investigate_before_automation: "Investigate before automating", no_change: "No change recommended" };
function findingEditor(f, done) {
  const v = { title: f.title, ownerImplication: f.ownerImplication, nextAction: f.nextAction, queue: f.queue, importance: f.importance, evidenceStatus: f.evidenceStatus };
  const startRev = f.rev || 1;
  const err = h("div", { class: "err", hidden: true });
  const inp = (k, l, el) => h("div", { class: "field" }, h("label", { for: "fe-" + k + f.id }, l), el);
  return h("form", { class: "dbody stack", style: "padding-top:14px", onsubmit: async (e) => {
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
      inp("queue", "Queue", h("select", { id: "fe-queue" + f.id, onchange: (e) => (v.queue = e.target.value) }, [["investigate_next", "Investigate next"], ["ready_to_test", "Ready to test"]].map(([k, l]) => h("option", { value: k, selected: v.queue === k }, l)))),
      inp("imp", "Business importance", h("select", { id: "fe-imp" + f.id, onchange: (e) => (v.importance = e.target.value) }, ["high", "medium", "low"].map((k) => h("option", { value: k, selected: v.importance === k }, k)))),
      inp("ev", "Evidence status", h("select", { id: "fe-ev" + f.id, onchange: (e) => (v.evidenceStatus = e.target.value) }, Object.entries(EVID).map(([k, [l]]) => h("option", { value: k, selected: v.evidenceStatus === k }, l))))),
    err, h("div", { class: "dactions" }, h("button", { class: "btn primary sm", type: "submit" }, "Save finding"), h("button", { class: "btn sm", type: "button", onclick: done }, "Cancel")));
}

// =====================================================================================
// Diagnostics: two queues, never a score
// =====================================================================================
function viewDiagnostics(view) {
  view.className = "view wide";
  let kind = "all";
  const draw = () => {
    const c = company(); if (!c) return;
    const all = companyFindings().filter((f) => kind === "all" || f.kind === kind);
    const live = rankFindings(all);
    const rejected = all.filter((f) => reviewOf(f.id) === "rejected");
    const q = (k) => live.filter((f) => (f.queue || "investigate_next") === k);
    view.replaceChildren(
      h("div", { class: "page-h" }, h("div", null, h("div", { class: "crumb" }, c.name), h("h1", null, "Diagnostics"),
        h("p", null, "Draft findings come from the analysis of each memo and stay drafts until a reviewer accepts them. Importance and evidence strength are separate: a costly-sounding problem isn't verified just because it was mentioned."))),
      h("div", { class: "seg", role: "group", "aria-label": "Filter findings", style: "margin-bottom:18px" }, [["all", "All"], ["pain_point", "Pain points"], ["bottleneck", "Bottlenecks"], ["risk", "Risks"], ["opportunity", "Opportunities"]].map(([k, l]) => h("button", { type: "button", "aria-pressed": String(kind === k), onclick: () => { kind = k; draw(); } }, l))),
      !companyFindings().length ? h("div", { class: "empty" }, h("h3", null, "No findings yet"), h("p", null, "Findings appear after a memo is analyzed. A memo can also produce none, if nothing actionable was said.")) :
      h("div", { class: "queues" },
        h("section", null, h("div", { class: "qh" }, h("h2", null, "Investigate next"), h("span", { class: "muted num" }, q("investigate_next").length)), h("p", { class: "lede muted", style: "font-size:13.5px;margin-bottom:10px" }, "Potentially important, but needs more evidence before acting."),
          h("div", { class: "stack" }, q("investigate_next").map((f) => DiagnosticCard(f)), q("investigate_next").length ? null : h("p", { class: "muted" }, "Nothing here."))),
        h("section", null, h("div", { class: "qh" }, h("h2", null, "Ready to test"), h("span", { class: "muted num" }, q("ready_to_test").length)), h("p", { class: "lede muted", style: "font-size:13.5px;margin-bottom:10px" }, "Supported well enough to try a practical, reversible improvement."),
          h("div", { class: "stack" }, q("ready_to_test").map((f) => DiagnosticCard(f)), q("ready_to_test").length ? null : h("p", { class: "muted" }, "Nothing here.")))),
      rejected.length ? h("details", { style: "margin-top:24px" }, h("summary", { class: "muted" }, `Rejected (${rejected.length})`), h("div", { class: "stack", style: "margin-top:10px" }, rejected.map((f) => DiagnosticCard(f)))) : null);
    if (S.focusFinding) { const id = S.focusFinding; S.focusFinding = null; openCards.add(id); const el = $("#f-" + id); if (el) { el.replaceWith(DiagnosticCard(S.findings.find((x) => x.id === id))); $("#f-" + id)?.scrollIntoView({ block: "center" }); } }
  };
  currentView.refresh = () => { if (!document.querySelector(".dbody form, .dbody textarea:focus, .dbody select:focus")) draw(); };
  draw();
}

// =====================================================================================
// Key numbers (MetricCard): each figure as a card a person can read at a glance.
// Big value, what it is, who said it and where, and a plain warning when it's uncertain.
// =====================================================================================
const SOURCE_PLAIN = { reported: "Said in conversation", measured: "From a record", calculated: "Calculated", scenario: "What-if estimate", external: "Outside benchmark" };
function valueWithPeriod(x) {
  const v = str(x.value), p = str(x.period).toLowerCase();
  if (!v || !p || v.toLowerCase().includes(p) || /\b(a|per|each|every)\s+(month|week|year|day)/i.test(v)) return v;
  return v + " / " + p.replace(/^per\s+/, "");
}
function MetricCard(x, opts = {}) {
  const m = memo(x.memoId);
  const cav = str(x.caveat);
  const shaky = /not reconciled|unclear|conflict|contradict|inconsistent|estimate|approximate|guess|aspiration|not verified/i.test(cav);
  return h("article", { class: "mcard" },
    h("div", { class: "mval num" }, valueWithPeriod(x)),
    h("h3", null, str(x.label)),
    str(x.definition) ? h("p", { class: "mdef" }, x.definition) : null,
    cav ? h("p", { class: "mwarn" + (shaky ? " shaky" : "") }, h("b", null, shaky ? "Check: " : "Note: "), cav) : null,
    h("div", { class: "mfoot" },
      h("span", null, SOURCE_PLAIN[x.classification] || "Said in conversation"),
      !opts.inMemo && m ? h("span", null, "· " + m.title) : null,
      x.ref ? evLink(x.memoId, x.ref, "See where") : null));
}
function viewMetrics(view) {
  view.className = "view wide";
  const draw = () => {
    const c = company(); if (!c) return;
    const xs = S.metrics.filter((x) => x.companyId === c.id);
    const withValue = xs.filter((x) => str(x.value)), noValue = xs.filter((x) => !str(x.value));
    // newest memo first, then in the order they were said
    const order = new Map(companyMemos().map((m, i) => [m.id, i]));
    withValue.sort((a, b) => (order.get(a.memoId) ?? 99) - (order.get(b.memoId) ?? 99) || cmpRef(a.ref || "0.0", b.ref || "0.0"));
    view.replaceChildren(
      h("div", { class: "page-h" }, h("div", null, h("div", { class: "crumb" }, c.name), h("h1", null, "Key numbers"),
        h("p", null, "Every figure someone mentioned in " + c.name + "'s memos. Most were said out loud, not checked against records, so treat them as a starting point."))),
      withValue.length ? h("div", { class: "mgrid" }, withValue.map((x) => MetricCard(x))) : null,
      noValue.length ? h("section", { class: "sec" }, h("h2", null, "Mentioned without a number"), h("p", { class: "lede" }, "These came up, but nobody gave a figure. Worth asking about next time."),
        h("ul", { class: "plain" }, noValue.map((x) => h("li", null, str(x.label), str(x.caveat) ? h("span", { class: "muted" }, " · " + x.caveat) : null, " ", x.ref ? evLink(x.memoId, x.ref, "See where") : null)))) : null,
      !xs.length ? h("div", { class: "empty" }, h("h3", null, "No numbers yet"), h("p", null, "Figures people mention in memos (revenue, payments, team size, call volumes) show up here with where they were said.")) : null);
  };
  currentView.refresh = draw; draw();
}

// =====================================================================================
// Actions
// =====================================================================================
async function createTask(t) {
  if (!S.db || !t.companyId) return;
  try {
    const id = newId("tk");
    await S.db.doc("tasks/" + id).set({ companyId: t.companyId, title: str(t.title), findingId: t.findingId || null, memoId: t.memoId || null, assigneeId: t.assigneeId || null, due: t.due || "", done: false, createdAt: Date.now(), createdBy: S.uid });
    logEvent(t.companyId, "task", `created the task “${str(t.title)}”`, { taskId: id });
    toast("Task created in Actions");
  } catch { toast("Couldn't create the task."); }
}
function viewActions(view) {
  const draw = async () => {
    const c = company(); if (!c) return;
    const ts = S.tasks.filter((t) => t.companyId === c.id).sort((a, b) => a.done - b.done || b.createdAt - a.createdAt);
    const ps = await people(ts.flatMap((t) => [t.assigneeId, t.createdBy]));
    const tm = await teammates();
    const nv = { title: "", assigneeId: "", due: "" };
    view.replaceChildren(
      h("div", { class: "page-h" }, h("div", null, h("div", { class: "crumb" }, c.name), h("h1", null, "Actions"), h("p", null, "Follow-ups, checks and pilots for " + c.name + ". Nothing here contacts the customer or changes their systems; people do that."))),
      S.can.write ? h("form", { class: "card grid2", style: "margin-bottom:18px", onsubmit: async (e) => { e.preventDefault(); if (!str(nv.title)) return; await createTask({ ...nv, companyId: c.id }); } },
        h("div", { class: "field full" }, h("label", { for: "nt-title" }, "New task"), h("input", { id: "nt-title", placeholder: "e.g. Pull last month's missed-call log", oninput: (e) => (nv.title = e.target.value) })),
        h("div", { class: "field" }, h("label", { for: "nt-as" }, "Assign to"), h("select", { id: "nt-as", onchange: (e) => (nv.assigneeId = e.target.value) }, h("option", { value: "" }, "Unassigned"), tm.map((p) => h("option", { value: p.id }, p.name || "Teammate")))),
        h("div", { class: "field" }, h("label", { for: "nt-due" }, "Due"), h("input", { id: "nt-due", type: "date", oninput: (e) => (nv.due = e.target.value) })),
        h("div", null, h("button", { class: "btn primary", type: "submit" }, "Add task"))) : null,
      ts.length ? h("div", { class: "list" }, ts.map((t) => {
        const f = S.findings.find((x) => x.id === t.findingId);
        return h("div", { class: "task" + (t.done ? " done" : "") },
          h("input", { type: "checkbox", checked: t.done, disabled: !S.can.write, "aria-label": (t.done ? "Reopen " : "Complete ") + t.title, onchange: async (e) => { try { await S.db.doc("tasks/" + t.id).update({ done: e.target.checked, doneAt: e.target.checked ? Date.now() : null, doneBy: S.uid }); logEvent(c.id, "task", `${e.target.checked ? "completed" : "reopened"} “${t.title}”`, { taskId: t.id }); } catch { toast("Couldn't update the task."); } } }),
          h("div", { style: "min-width:0" }, h("div", { class: "tt" }, t.title), h("small", null, [t.assigneeId ? "Owner: " + (ps[t.assigneeId]?.name || "Teammate") : "Unassigned", t.due ? "Due " + fmtDate(t.due) : null, "Created by " + (ps[t.createdBy]?.name || "a teammate") + " " + fmtWhen(t.createdAt)].filter(Boolean).join(" · ")),
            f ? h("small", null, "Finding: ", h("a", { href: "#c-" + c.id + "-diagnostics", onclick: () => { S.focusFinding = f.id; } }, f.title)) : null),
          t.memoId && memo(t.memoId) ? h("a", { class: "btn ghost sm", href: "#m-" + t.memoId }, "Memo") : h("span"));
      })) : h("div", { class: "empty" }, "No actions yet. Create one here, from a finding, or from an Ask Starwell answer."));
  };
  currentView.refresh = () => { if (!document.activeElement?.closest("form")) draw(); };
  draw();
}
