
// =====================================================================================
// MemoReader: Brief · Transcript (Organized | Original) · Findings
// =====================================================================================
const cmpRef = (a, b) => { const [x1, y1] = String(a).split(".").map(Number), [x2, y2] = String(b).split(".").map(Number); return (x1 - x2) || (y1 - y2); };
// By default the transcript shows the high-signal notes; facts, open questions and quotes are one click away.
const DEFAULT_NOTE_TYPES = ["pain_point", "bottleneck", "emotion", "decision", "opportunity"];
S.noteTypes = new Set(lsGet("noteTypes2", DEFAULT_NOTE_TYPES));
S.notesOn = lsGet("notesOn", true);
S.memoView = {};
const noteVar = (t) => NOTE_TYPES[t]?.[1] || "--fg-4";
function highlight(text, notes) {
  const marks = [];
  const low = text.toLowerCase();
  for (const n of notes) {
    const q = str(n.quote); if (q.length < 3) continue;
    const i = low.indexOf(q.toLowerCase());
    if (i >= 0 && !marks.some((m) => i < m.e && i + q.length > m.s)) marks.push({ s: i, e: i + q.length, type: n.type, note: n.note });
  }
  marks.sort((a, b) => a.s - b.s);
  const out = []; let p = 0;
  for (const m of marks) { out.push(text.slice(p, m.s), h("mark", { class: "hl t-" + m.type, style: `--nc: var(${noteVar(m.type)})`, title: (NOTE_TYPES[m.type]?.[0] || "Note") + ": " + str(m.note) }, text.slice(m.s, m.e))); p = m.e; }
  out.push(text.slice(p));
  return out;
}
// A note reads in full: colored dot, its kind, the note. Emotion notes say what they were read from.
function noteEl(n) {
  const t = NOTE_TYPES[n.type] || ["Note"];
  const label = n.type === "emotion" && n.emotion ? n.emotion[0].toUpperCase() + n.emotion.slice(1) : t[0];
  return h("div", { class: "note", style: `--nc: var(${noteVar(n.type)})` }, h("i", { class: "dot", "aria-hidden": "true" }),
    h("div", null, h("b", null, label), str(n.note),
      n.type === "emotion" ? h("small", null, "Read from " + ({ wording: "the wording", voice: "the speaker's delivery", both: "the wording and delivery" }[n.basis] || "the wording") + "; an interpretation, not a measurement.") : null));
}
function viewMemo(view, mid) {
  const alive = liveCheck();
  let parts = {}, unsub = null, tick = null, finishing = false, lastKey = "", mode = "";
  view.className = "view reading";
  if (S.db) unsub = S.db.collection(`interviews/${mid}/parts`).onSnapshot((snap) => { parts = {}; for (const d of snap.docs) parts[d.id] = d.data(); draw(); }, (e) => console.error(e));
  currentView.cleanup = () => { unsub?.(); clearInterval(tick); };
  currentView.refresh = () => draw();
  queueMicrotask(draw);

  function segs() {
    const m = memo(mid);
    const items = Object.keys(parts).filter((k) => k.startsWith("seg-")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).flatMap((k) => arr(parts[k].items));
    if (items.length && m && Object.keys(parts).filter((k) => k.startsWith("seg-")).length === (m.segParts || 0)) { const v = items.map((s) => ({ ...s, memoId: mid })); S.segCache.set(mid, v); return v; }
    if (m?.rawParts && !m.segParts) { const raw = Array.from({ length: m.rawParts }, (_, i) => parts["raw-" + i]?.text || "").join("\n\n"); if (raw.trim()) return segmentSources([{ text: raw, name: "Uploaded material" }]).map((s) => ({ ...s, memoId: mid })); }
    return items.map((s) => ({ ...s, memoId: mid }));
  }

  function frac(m) {
    if (!m || m.saving) return 0.03;
    const total = m.progressTotal || 0, done = Math.min(m.progressDone || 0, total);
    if (!total) return 0.06;
    const inFlight = Math.min(2, total - done), dt = Math.max(0, (Date.now() - (m.progressAt || Date.now())) / 1000);
    return Math.min(0.97, 0.06 + 0.91 * (done + inFlight * 0.85 * (1 - Math.exp(-dt / 70))) / total);
  }
  function paintBar(f, label) {
    const bar = $("#lbar"); if (!bar) return;
    bar.style.width = (f * 100).toFixed(1) + "%"; bar.parentElement.setAttribute("aria-valuenow", String(Math.round(f * 100)));
    $("#lpct").textContent = Math.round(f * 100) + "%"; if (label) $("#lstage").textContent = label;
  }
  function progressCard(m) {
    const st = m.stages || {};
    const notesN = m.notesParts || 0, notesD = Math.min(m.notesDone || 0, notesN);
    const cls = (s) => s === "done" ? "done" : s === "running" ? "now" : s === "failed" ? "fail" : "todo";
    let steps = m.saving ? [["now", "Saving to " + (company(m.companyId)?.name || "the company")], ["todo", "Writing the summary"], ["todo", "Finding pain points and checking quotes"], ["todo", "Organizing the transcript"]]
      : [["done", "Saved to " + (company(m.companyId)?.name || "the company")], [cls(st.summary), "Writing the summary"], [cls(st.findings), "Finding pain points and checking quotes"], [cls(st.notes), "Organizing the transcript" + (notesN > 1 ? ` (${notesD} of ${notesN})` : "")]];
    // two stages run side by side; show one spinner, on the first running step
    let seen = false; steps = steps.map(([s, t]) => { if (s === "now") { if (seen) return ["todo", t + " (queued)"]; seen = true; } return [s, t]; });
    const failed = m.status === "error" || isStale(m);
    const nowIdx = steps.findIndex(([s]) => s === "now");
    const label = failed ? (isStale(m) ? "Stopped before it finished" : "Didn't finish") : m.saving ? "Saving" : nowIdx >= 0 ? `Step ${nowIdx + 1} of ${steps.length}: ${steps[nowIdx][1].replace(/ \(queued\)$/, "")}` : "Starting";
    const here = m.saving || S.running.has(mid);
    return h("section", { class: "progress-card" + (failed ? " failed" : "") },
      h("div", { class: "pc-top" }, failed ? svg(IC.info) : h("span", { class: "spin" }), h("h2", { id: failed ? null : "lstage", "aria-live": "polite" }, failed ? "Analysis interrupted" : label), failed ? null : h("span", { class: "pct", id: "lpct" }, "0%")),
      failed ? h("p", { style: "margin-top:6px;font-size:13px" }, m.error || "The tab running the analysis was probably closed.") : h("div", { class: "lbar", role: "progressbar", "aria-label": "Analysis progress", "aria-valuemin": "0", "aria-valuemax": "100" }, h("i", { id: "lbar" })),
      failed ? h("ol", { class: "lsteps" }, steps.map(([s, t]) => h("li", { class: s }, t))) : null,
      h("div", { class: "pc-foot" },
        h("p", { class: "hint" }, failed ? "Finished steps are kept; resuming picks up where it stopped." : here ? (IS_PHONE ? "Keep this screen on" : "Keep this tab open") + " · usually 1 to 3 minutes" : "Running in a teammate's browser"),
        failed && S.sample && S.can.write ? h("button", { class: "btn primary sm", type: "button", onclick: () => runAnalysis(mid) }, "Resume analysis") : null,
        S.running.has(mid) ? h("button", { class: "btn ghost sm", type: "button", onclick: () => confirmDialog("Stop the analysis?", "Finished steps are kept, and you can resume later.", "Stop", () => S.running.get(mid)?.ctl.abort()) }, "Stop") : null));
  }

  async function draw() {
    if (!alive()) return;
    const m0 = memo(mid);
    const pend = S.pending.get(mid);
    if (m0) S.pending.delete(mid);
    const m = m0 || (pend ? { id: mid, title: pend.title, companyId: pend.companyId, saving: !pend.error, error: pend.error, status: pend.error ? "error" : "analyzing" } : null);
    if (!m) { if (S.ready) view.replaceChildren(emptyState(IC.memo, "Memo not found", "It may have been deleted.", h("a", { class: "btn", href: S.cid ? "#c-" + S.cid + "-memos" : "#" }, "Back to memos"))); return; }
    if (finishing) return;
    const analyzing = m.saving || (m.status === "analyzing" && !isStale(m));
    if (mode === "progress" && m.status === "ready" && !analyzing) {
      finishing = true; clearInterval(tick); paintBar(1, "Done");
      setTimeout(() => { if (!alive()) return; finishing = false; mode = "done"; if (!S.memoView[mid] || S.memoView[mid] === "original") S.memoView[mid] = "organized"; lastKey = ""; draw(); toast("Analysis ready"); }, 700); return;
    }
    const a = parts.analysis?.data || null;
    const notesDocs = Object.keys(parts).filter((k) => k.startsWith("notes-") || k.startsWith("organized-")).sort((x, y) => x.localeCompare(y, undefined, { numeric: true })).map((k) => parts[k]);
    const sections = notesDocs.flatMap((d) => arr(d.data?.sections));
    const notes = notesDocs.flatMap((d) => arr(d.data?.notes));
    const ss = segs();
    const fs = S.findings.filter((f) => f.memoId === mid);
    let v = S.memoView[mid] || (m.status === "ready" && sections.length ? "organized" : "original");
    if (v === "summary" && !a) v = sections.length ? "organized" : "original";
    if (v === "organized" && !sections.length) v = "original";
    const key = JSON.stringify([m, Object.keys(parts).map((k) => [k, parts[k].at]), v, S.notesOn, [...S.noteTypes], fs.map((f) => [f.id, f.rev, reviewOf(f.id), f.assigneeId]), [...openCards], S.running.has(mid), S.metrics.filter((x) => x.memoId === mid).length]);
    if (key === lastKey && !S.focus) return;
    if (document.activeElement?.closest("#view form") && !S.focus) return; // don't wipe what someone is typing; the next change redraws
    lastKey = key;
    const ps = await people([m.ownerId]);
    if (!alive()) return;
    const c = company(m.companyId);
    const center = $("#center"), y = center.scrollTop;
    mode = analyzing ? "progress" : "done";

    const setView = (nv) => { S.memoView[mid] = nv; lastKey = ""; draw(); };
    const redraw = () => { lastKey = ""; draw(); };
    const live = fs.filter((f) => reviewOf(f.id) !== "rejected");
    const visNotes = S.notesOn ? notes.filter((n) => S.noteTypes.has(n.type)) : [];
    const transcriptTab = v === "organized" || v === "original";
    const notesMenu = () => [
      h("label", { class: "chk" }, h("input", { type: "checkbox", checked: S.notesOn, onchange: (e) => { S.notesOn = e.target.checked; lsSet("notesOn", S.notesOn); redraw(); } }), h("b", { style: "font-weight:500" }, "Show notes on the transcript")),
      h("div", { class: "pop-sep" }),
      Object.entries(NOTE_TYPES).filter(([k]) => notes.some((n) => n.type === k)).map(([k, [l, cv]]) => h("label", { class: "chk", style: `--nc: var(${cv})` },
        h("input", { type: "checkbox", checked: S.noteTypes.has(k), disabled: !S.notesOn, onchange: (e) => { e.target.checked ? S.noteTypes.add(k) : S.noteTypes.delete(k); lsSet("noteTypes2", [...S.noteTypes]); redraw(); } }),
        h("i", { class: "dot", "aria-hidden": "true" }), l, h("span", { class: "muted num", style: "margin-left:auto" }, notes.filter((n) => n.type === k).length))),
      h("p", { class: "hint" }, "Emotion and tone notes are interpretations of wording or delivery, not measurements.")];
    const tab = (k, label, dis, extra) => h("button", { type: "button", role: "tab", "aria-selected": String(k === "transcript" ? transcriptTab : v === k), disabled: dis, title: dis ? "Available when the analysis finishes" : null, onclick: () => setView(k === "transcript" ? (sections.length ? (transcriptTab ? v : "organized") : "original") : k) }, label, extra);
    const viewbar = h("div", { class: "viewbar" },
      h("div", { class: "vtabs", role: "tablist", "aria-label": "Memo view" },
        tab("summary", "Brief", !a, !a && analyzing ? h("span", { class: "soon" }, "soon") : null),
        tab("transcript", "Transcript", false),
        tab("findings", "Findings", false, live.length ? h("span", { class: "cnt" }, live.length) : analyzing ? h("span", { class: "soon" }, "soon") : null)),
      transcriptTab ? h("div", { class: "vb-tools" },
        h("div", { class: "seg tmode", role: "group", "aria-label": "Transcript version" },
          h("button", { type: "button", "aria-pressed": String(v === "organized"), disabled: !sections.length, title: !sections.length ? "Available when the analysis finishes" : null, onclick: () => setView("organized") }, "Organized"),
          h("button", { type: "button", "aria-pressed": String(v === "original"), onclick: () => setView("original") }, "Original")),
        notes.length ? menuButton(h("button", { class: "btn ghost sm", type: "button" }, svg(IC.text), S.notesOn ? `Notes ${visNotes.length}/${notes.length}` : "Notes off", svg(IC.chev, 14)), () => notesMenu()) : null) : null);
    const byRef = new Map(); for (const n of visNotes) { if (!byRef.has(n.ref)) byRef.set(n.ref, []); byRef.get(n.ref).push(n); }
    const spk = (name) => str(m.speakerNames?.[name]) || name || "Speaker";

    let content;
    if (v === "summary" && a) content = summaryView(a, m, fs, (fid) => { if (fid) openCards.add(fid); setView("findings"); if (fid) requestAnimationFrame(() => $("#f-" + fid)?.scrollIntoView({ block: "start" })); });
    else if (v === "organized" && sections.length) content = h("div", { class: "doc", "data-memo": mid, style: "max-width:none" }, sections.map((s, i) => {
      const turns = arr(s.turns || s.exchanges);
      const refs = turns.map((t) => t.ref).filter(Boolean);
      const lo = refs[0], hi = refs[refs.length - 1];
      const loose = lo ? visNotes.filter((n) => !refs.includes(n.ref) && cmpRef(n.ref, lo) >= 0 && cmpRef(n.ref, hi) <= 0) : [];
      const lastTurnOf = new Map(); turns.forEach((t, k) => { if (t.ref) lastTurnOf.set(t.ref, k); }); // a paragraph's notes show once, after its last turn
      const seg0 = ss.find((x) => x.id === lo);
      const placeholder = /^what was discussed in this stretch/i.test(str(s.summary));
      return h("section", { class: "osec", id: "part-" + (i + 1) },
        h("header", null, h("span", { class: "eyebrow" }, `Part ${i + 1}` + (seg0 ? " · " + refLabel(seg0) : "")), h("h3", null, str(s.heading))),
        str(s.summary) && !placeholder ? h("p", { class: "sum" }, s.summary) : h("div", { style: "height:6px" }),
        turns.map((t, k) => {
          const cont = k > 0 && turns[k - 1].speaker === t.speaker;
          return h("div", { class: "turn" + (t.side === "interviewer" ? " interviewer" : "") + (cont ? " cont" : ""), "data-ref": t.ref || null },
            h("div", { class: "g" }, t.ref ? evLink(mid, t.ref) : null),
            h("div", { style: "min-width:0" },
              h("div", { class: "who" }, speakerLabel(m, t.speaker, spk)),
              h("div", { class: "tx" }, str(t.text)),
              t.ref && byRef.get(t.ref) && lastTurnOf.get(t.ref) === k ? h("div", { class: "notes" }, byRef.get(t.ref).map(noteEl)) : null));
        }),
        loose.length ? h("div", { class: "notes", style: "margin-left:64px" }, loose.map((n) => h("div", { class: "row", style: "align-items:flex-start" }, h("div", { class: "grow" }, noteEl(n)), evLink(mid, n.ref)))) : null,
        arr(s.key_points).length ? h("div", { class: "kp" }, h("span", { class: "label" }, "Key points"), h("ul", null, s.key_points.map((k) => h("li", null, str(k))))) : null);
    }));
    else if (v === "findings") content = findingsView(m, fs, a, analyzing);
    else {
      let lastSrc = null;
      content = ss.length ? h("div", { class: "doc", "data-memo": mid, style: "max-width:none" }, ss.map((s) => {
        const srcInfo = arr(m.sources)[s.src - 1];
        const headEl = s.src !== lastSrc ? h("div", { class: "src-h" }, h("span", { class: "label" }, `Source ${s.src}`), srcInfo ? h("b", null, srcLabel(srcInfo)) : null, srcInfo?.kind === "audio" ? h("p", { class: "hint" }, "Automatic transcript. Timestamps are from the recording. Words can be misheard; check the audio for anything important.") : null) : null;
        lastSrc = s.src;
        const ns = byRef.get(s.id) || [];
        return [headEl, h("div", { class: "srow", "data-ref": s.id }, h("div", { class: "ref" }, s.t != null ? fmtClock(s.t) : "¶" + s.id),
          h("div", { style: "min-width:0" }, h("div", null, ...highlight(s.text, ns)),
            arr(s.cues).length ? h("div", { class: "cues", "aria-label": "Delivery measured from the audio" }, s.cues.map((cf) => h("span", { class: "cue", title: "Measured from the audio, compared with the rest of this recording" }, cf))) : null,
            ns.length ? h("div", { class: "notes" }, ns.map(noteEl)) : null))];
      })) : h("p", { class: "muted" }, "The source text is loading.");
    }

    // Header: title, one quiet line of facts; everything else is behind Details and the ⋯ menu.
    const wc = arr(m.sources).reduce((n, s) => n + (s.words || 0), 0) || m.words || 0;
    const dur = arr(m.sources).reduce((n, s) => n + (s.duration || 0), 0);
    const owner = ps[m.ownerId]?.name || "a teammate";
    const metaBits = [[m.interviewee, m.role].filter(Boolean).join(", ") || (m.type ? m.type + " interview" : null), m.recordedDate ? fmtDate(m.recordedDate) : null, dur ? fmtClock(dur) + " of audio" : wc ? wc.toLocaleString() + " words" : null].filter(Boolean);
    const menuItems = () => [
      a ? menuItem("Copy as text", () => copyReport(m, a, sections, fs), { icon: IC.copy }) : null,
      a && S.downloads ? menuItem("Download .md", () => downloadReport(m, a, sections, fs), { icon: IC.download }) : null,
      S.can.write && S.sample && !analyzing && m.status !== "error" && !isStale(m) ? menuItem(a?.version === 2 ? "Re-run analysis" : "Run the full analysis", () => runAnalysis(mid, { fresh: true }), { icon: IC.refresh }) : null,
      menuItem("Details", () => detailsDialog(m, ps), { icon: IC.info }),
      S.can.write && (m.ownerId === S.uid || S.can.review) && !S.running.has(mid) ? [h("div", { class: "pop-sep" }), menuItem("Delete memo", () => confirmDialog("Delete this memo?", "Its transcript and draft findings are deleted for the whole team. Reviewed findings stay. This can't be undone.", "Delete memo", () => deleteMemo(m)), { icon: IC.trash, danger: true })] : null,
    ];
    view.replaceChildren(
      h("div", { class: "memo-h" },
        h("div", { class: "memo-top" }, h("h1", null, m.title || "Untitled memo"),
          !m.saving ? h("div", { class: "acts" }, menuButton(h("button", { class: "icon-btn", type: "button", "aria-label": "More actions" }, svg(IC.more)), menuItems)) : null),
        h("p", { class: "meta-line" }, metaBits.map((b, i) => [i ? h("span", { class: "sep-dot" }) : null, h("span", null, b)]), h("span", { class: "sep-dot" }), h("span", { class: "who" }, avatar(ps[m.ownerId], owner, "xs"), "Uploaded by " + owner),
          m.status === "ready" && !m.saving ? null : h("span", { class: "stat" }, statusState(m))),
        m.status === "ready" && a && a.version !== 2 ? h("div", { class: "notice info", style: "margin-top:12px" }, h("span", null, "This memo was analyzed by an earlier version. Run the full analysis from the ⋯ menu to get transcript notes, findings and source links.")) : null),
      analyzing || m.status === "error" || isStale(m) ? progressCard(m) : null,
      viewbar,
      content);
    center.scrollTop = y;
    if (analyzing && mode === "progress") { paintBar(frac(m)); clearInterval(tick); tick = setInterval(() => { if (!finishing && alive()) paintBar(frac(memo(mid) || m)); }, 500); }
    else clearInterval(tick);
    requestAnimationFrame(focusPassage);
  }
}
function detailsDialog(m, ps) {
  openDialog("Memo details", (close) => {
    const body = h("div");
    const show = () => body.replaceChildren(
      h("dl", { class: "profile" }, [["Title", m.title], ["Interview type", m.type], ["Interviewee", [m.interviewee, m.role].filter(Boolean).join(", ")], ["What this is", SOURCE_TYPES.find(([k]) => k === m.sourceType)?.[1]], ["Recorded", m.recordedDate ? fmtDate(m.recordedDate) : "Not given"], ["Uploaded", m.createdAt ? fmtDate(m.createdAt) + " by " + (ps[m.ownerId]?.name || "a teammate") : null], ["Starwell team", m.interviewers], ["Material", arr(m.sources).length ? arr(m.sources).map(srcLabel).join("; ") : null], ["Context", m.context]]
        .filter(([, x]) => str(x)).map(([k, x]) => [h("dt", null, k), h("dd", null, x)])),
      h("div", { class: "dlg-foot" }, S.can.write ? h("button", { class: "btn", type: "button", onclick: () => body.replaceChildren(memoEditForm(m, close, show)) }, svg(IC.edit), "Edit details") : null, h("button", { class: "btn primary", type: "button", onclick: close }, "Done")));
    show();
    return body;
  }, { wide: true });
}
function speakerLabel(m, name, spk) {
  const shown = spk(name);
  if (!S.can.write || !name || name === "Notes") return h("span", null, shown);
  return h("button", { type: "button", class: "spk", title: "Rename this speaker everywhere in the memo", onclick: async (e) => {
    e.stopPropagation();
    const b = e.currentTarget;
    const inp = h("input", { class: "inp sm", style: "width:auto;height:26px;padding:0 6px;font-size:13px", value: shown, "aria-label": "Speaker name for " + name });
    const save = async () => { const nv = str(inp.value); if (nv && nv !== shown) { try { await S.db.doc("interviews/" + m.id).update({ speakerNames: { ...(m.speakerNames || {}), [name]: nv } }); toast("Renamed everywhere in this memo"); } catch { toast("Couldn't rename."); } } else inp.replaceWith(b); };
    inp.addEventListener("keydown", (k) => { if (k.key === "Enter") { k.preventDefault(); save(); } if (k.key === "Escape") inp.replaceWith(b); });
    inp.addEventListener("blur", save);
    b.replaceWith(inp); inp.focus(); inp.select();
  } }, shown);
}
const srcLabel = (s) => [s.name, s.duration ? fmtClock(s.duration) + " of audio" : null, s.words ? s.words.toLocaleString() + " words" : null].filter(Boolean).join(", ");
// The Brief: everything someone who wasn't there needs, in reading order. Nothing is cut; secondary detail sits lower.
function summaryView(a, m, fs, openFinding) {
  const mid = m.id;
  const refs = (rs) => arr(rs).slice(0, 4).map((r) => evLink(mid, r));
  const g = a.at_a_glance || {};
  const top = dedupeFindings(rankFindings(fs));
  const nums = metricRows(m.companyId).filter((r) => r.all.some((x) => x.memoId === mid)).map((r) => ({ x: r.all.find((x) => x.memoId === mid), all: [r.all.find((x) => x.memoId === mid)] }));
  const sec = (title, lede, ...body) => h("section", { class: "sec" }, h("h2", null, title), lede ? h("p", { class: "lede" }, lede) : null, body);
  // the long tail of the brief: one tidy row each, opened on demand, nothing left out
  const fold = (title, n, lede, ...body) => h("details", { class: "fold" }, h("summary", null, h("span", null, title), n ? h("span", { class: "cnt" }, n) : null), h("div", { class: "fold-b" }, lede ? h("p", { class: "lede" }, lede) : null, body));
  return h("div", { class: "brief", "data-memo": mid },
    h("section", { class: "doc" }, str(m.headline) ? h("p", { class: "headline", style: "margin-bottom:14px" }, m.headline) : null, str(a.executive_summary).split(/\n\n+/).map((p) => h("p", null, p))),
    h("div", { class: "glance" }, [["Purpose", g.purpose], ["Outcome", g.outcome], ["Interest level", g.interest_level], ["Next step", g.next_step]].filter(([, x]) => str(x)).map(([k, x]) => h("div", null, h("span", { class: "label" }, k), h("b", null, str(x))))),
    top.length ? sec("Top findings", null, h("div", { class: "flist" }, top.slice(0, 3).map((f) => h("button", { type: "button", onclick: () => openFinding(f.id) }, statusIcon(reviewOf(f.id)), h("span", { style: "min-width:0" }, h("b", null, f.title), h("small", null, f.ownerImplication || "")), h("span", { class: "row" }, kindTag(f.kind))))), top.length > 3 ? h("button", { class: "linkish", type: "button", style: "margin-top:10px;font-size:13px", onclick: () => openFinding(null) }, "All " + top.length + " findings") : null) : null,
    arr(a.action_items).length ? sec("Agreed next steps", null, arr(a.action_items).length ? h("ul", { class: "plain steps" }, a.action_items.map((t) => h("li", null, h("span", null, str(t.task)), h("span", { class: "muted", style: "font-size:13px" }, [str(t.owner), str(t.due) && "due " + str(t.due)].filter(Boolean).join(" · ")), refs([t.ref]),
      S.can.write ? h("button", { class: "btn ghost sm", type: "button", onclick: () => createTask({ title: str(t.task), memoId: mid, companyId: m.companyId }) }, svg(IC.plus), "Task") : null))) : null) : null,
    h("div", { class: "folds" },
    nums.length ? fold("Key numbers", nums.length, null, metricsTable(nums, { inMemo: true })) : null,
    arr(a.open_questions).length ? fold("Open questions", a.open_questions.length, null, h("ul", { class: "plain" }, a.open_questions.map((q) => h("li", null, str(q))))) : null,
    a.tone && (str(a.tone.overall) || arr(a.tone.moments).length) ? fold("Tone and delivery", arr(a.tone.moments).length, "Read from the wording and, for recordings, measured delivery (volume, pace, pauses). These are cues to read with the passage, not measurements of how anyone felt.",
      str(a.tone.overall) ? h("p", { class: "doc" }, a.tone.overall) : null,
      h("ul", { class: "tone-list" }, arr(a.tone.moments).map((t) => h("li", null, h("span", { class: "tag", style: "--nc: var(--emo)" }, h("i", { class: "dot" }), str(t.emotion) || "Tone"), h("span", null, str(t.note), " ", refs([t.ref])))))) : null,
    arr(a.meeting_flow).length ? fold("How the meeting went", a.meeting_flow.length, null, h("ol", { class: "flow" }, a.meeting_flow.map((f) => h("li", null, h("h4", null, str(f.phase)), h("p", null, str(f.summary), " ", refs(f.refs)))))) : null,
    arr(a.topics).length ? fold("Everything covered", a.topics.length, null, a.topics.map((t) => h("div", { class: "topic" }, h("h4", null, str(t.topic)), h("ul", null, arr(t.details).map((d) => h("li", null, str(d.text ?? d), " ", refs(d.refs))))))) : null,
    arr(a.quotes).length ? fold("In their words", a.quotes.length, null, a.quotes.map((q) => h("blockquote", { class: "quote" }, h("p", null, "“" + str(q.quote).replace(/^["“]|["”]$/g, "") + "”"), h("footer", null, h("b", null, str(q.speaker) || "Speaker"), str(q.why) ? " · " + str(q.why) : "", " ", refs([q.ref]))))) : null,
    arr(a.participants).length || arr(a.people_mentioned).length ? fold("People", arr(a.participants).length + arr(a.people_mentioned).length, null, h("div", { class: "tbl-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, "Name"), h("th", null, "Role"), h("th", null, "Notes"))),
      h("tbody", null, [...arr(a.participants).map((p) => [p.name, [p.role, p.side].filter(str).join(" · "), p.notes, "In the meeting"]), ...arr(a.people_mentioned).map((p) => [p.name, p.role, p.context, "Mentioned"])].map(([n, r, x, k]) => h("tr", null, h("td", null, h("b", { style: "font-weight:500" }, str(n) || "Unnamed"), h("small", null, k)), h("td", null, str(r)), h("td", null, str(x)))))))) : null));
}
function findingsView(m, fs, a, analyzing) {
  const ranked = rankFindings(fs).concat(fs.filter((f) => reviewOf(f.id) === "rejected"));
  return fs.length ? h("div", { class: "dlist" }, ranked.map((f) => DiagnosticCard(f, { memoId: m.id })))
    : a?.version === 2 ? emptyState(IC.diag, "No actionable issue established", "The analysis didn't find a problem supported by this memo. That's a valid result, not a missing one.")
    : emptyState(IC.diag, analyzing ? "Findings are on the way" : "No findings yet", analyzing ? "They appear here as soon as the analysis finishes this step." : "Findings appear when the analysis finishes.");
}
function memoEditForm(m, close, back) {
  const v = { title: m.title, interviewee: m.interviewee, role: m.role, type: m.type, recordedDate: m.recordedDate, interviewers: m.interviewers, context: m.context };
  const inp = (k, l, type = "text") => h("div", { class: "field" }, h("label", { for: "me-" + k }, l), h("input", { id: "me-" + k, type, value: v[k] || "", oninput: (e) => (v[k] = e.target.value) }));
  return h("form", { class: "stack memo-edit", style: "gap:14px", onsubmit: async (e) => { e.preventDefault(); if (!str(v.title)) return toast("The title can't be empty."); try { await S.db.doc("interviews/" + m.id).update({ ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, str(x)])), updatedAt: Date.now() }); toast("Details saved"); close(); } catch { toast("Couldn't save."); } } },
    h("div", { class: "grid2" }, h("div", { class: "full" }, inp("title", "Title")), inp("interviewee", "Interviewee"), inp("role", "Their role"), h("div", { class: "field" }, h("label", { for: "me-type" }, "Interview type"), h("select", { id: "me-type", onchange: (e) => (v.type = e.target.value) }, TYPES.map((t) => h("option", { selected: v.type === t }, t)))),
      inp("recordedDate", "Recorded on", "date"), h("div", { class: "full" }, inp("interviewers", "Starwell team present")), h("div", { class: "field full" }, h("label", { for: "me-context" }, "Context"), h("textarea", { id: "me-context", rows: "2", oninput: (e) => (v.context = e.target.value) }, v.context || ""))),
    h("p", { class: "hint" }, "Changing names or context doesn't change existing notes. Re-run the analysis if it should."),
    h("div", { class: "dlg-foot", style: "margin-top:0" }, h("button", { class: "btn", type: "button", onclick: back }, "Cancel"), h("button", { class: "btn primary", type: "submit" }, "Save details")));
}
async function deleteMemo(m) {
  try {
    const snap = await S.db.collection(`interviews/${m.id}/parts`).get();
    for (const d of snap.docs) await S.db.doc(`interviews/${m.id}/parts/${d.id}`).delete();
    for (const f of S.findings.filter((f) => f.memoId === m.id && !S.reviews[f.id])) await S.db.doc("findings/" + f.id).delete();
    for (const x of S.metrics.filter((x) => x.memoId === m.id)) await S.db.doc("metrics/" + x.id).delete();
    await S.db.doc("interviews/" + m.id).delete();
    S.segCache.delete(m.id);
    if (m.companyId) logEvent(m.companyId, "delete", `deleted the memo “${m.title}”`);
    toast("Memo deleted");
    location.hash = m.companyId ? "#c-" + m.companyId + "-memos" : "#unassigned";
  } catch (e) { console.error(e); toast("Couldn't delete the memo."); }
}

// =====================================================================================
// New memo: the recording first, details second; save is never blocked by transcription
// =====================================================================================
function blankDraft() { return { companyId: S.cid, title: "", sourceType: "conversation", type: "Owner", interviewee: "", role: "", recordedDate: new Date().toISOString().slice(0, 10), interviewers: myName() || "", context: "", language: "english", sources: [], autoSubmit: false }; }
const draftBusy = () => !!S.draft?.sources.some((s) => s.status === "working" || s.status === "queued");
window.addEventListener("beforeunload", (e) => { if (draftBusy()) { e.preventDefault(); e.returnValue = ""; } });
function viewNewMemo(view) {
  if (S.offline || !S.can.write) { location.hash = ""; return; }
  view.className = "view narrow";
  if (!S.companies.length) { view.replaceChildren(emptyState(IC.building, "Add a company first", "Every memo belongs to a company.", h("button", { class: "btn primary", type: "button", onclick: newCompanyDialog }, svg(IC.plus), "New company"))); return; }
  if (!S.draft || !company(S.draft.companyId)) S.draft = { ...(S.draft || blankDraft()), companyId: S.draft?.companyId && company(S.draft.companyId) ? S.draft.companyId : S.cid };
  const D = S.draft;
  const bind = (k) => (e) => { D[k] = e.target.value; if (k === "title") titleErr.hidden = true; };
  const inp = (k, l, ph, type = "text") => h("div", { class: "field" }, h("label", { for: "n-" + k }, l), h("input", { id: "n-" + k, type, value: D[k], placeholder: ph, oninput: bind(k) }));
  const titleErr = h("div", { class: "err", hidden: true }, "Give the memo a title.");
  const srcErr = h("div", { class: "err", hidden: true, style: "margin-top:8px" }, "Add at least one recording, file or pasted transcript.");
  const srcList = h("div", { class: "srcs" });
  const paste = h("textarea", { id: "n-paste", rows: "4", placeholder: "Paste a Voice Memos or Notes transcript, an email, or typed notes." });
  const drop = h("div", { class: "drop", tabindex: "0", role: "button", "aria-label": "Add recordings or files", onclick: () => $("#filePick").click(), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#filePick").click(); } },
    ondragover: (e) => { e.preventDefault(); drop.classList.add("over"); }, ondragleave: () => drop.classList.remove("over"), ondrop: (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); } },
    h("span", { class: "d-ic" }, svg(IS_PHONE ? IC.mic : IC.upload, 18)),
    h("b", null, IS_PHONE ? "Choose a recording or file" : "Drop the recording or notes here"), h("p", null, IS_PHONE ? "Voice memos, notes, PDFs or photos" : "or click to choose · audio, video, documents or photos"));
  const goBtn = h("button", { class: "btn primary lg", type: "button", onclick: submit }, "Save and analyze");
  const status = h("span", { class: "st", "aria-live": "polite" });
  const destSel = h("select", { id: "n-company", class: "inp", onchange: (e) => { D.companyId = e.target.value; } }, S.companies.map((c) => h("option", { value: c.id, selected: c.id === D.companyId }, c.name)));
  const lang = h("label", { class: "lang" }, h("span", { class: "sr" }, "Language spoken"), h("select", { id: "n-language", class: "inp sm", onchange: bind("language") }, [["english", "English"], ["spanish", "Spanish"], ["portuguese", "Portuguese"], ["french", "French"], ["vietnamese", "Vietnamese"], ["chinese", "Chinese"], ["korean", "Korean"], ["tagalog", "Tagalog"], ["arabic", "Arabic"]].map(([k, l]) => h("option", { value: k, selected: D.language === k }, l === "English" ? "Spoken in English" : "Spoken in " + l))));
  const crew = roster();
  const pasteBox = h("div", { class: "field", hidden: !D.pasteOpen, style: "margin-top:12px" }, h("label", { class: "sr", for: "n-paste" }, "Paste text"), paste,
    h("div", { style: "display:flex;justify-content:flex-end;margin-top:8px" }, h("button", { class: "btn sm", type: "button", onclick: () => { const t = paste.value.trim(); if (!t) return; addSource({ kind: "paste", name: "Pasted text " + (D.sources.filter((s) => s.kind === "paste").length + 1), size: t.length, status: "ready", text: t }); paste.value = ""; } }, "Add pasted text")));
  view.replaceChildren(
    h("div", { class: "page-h" }, h("div", null, h("h1", null, "New memo"), h("label", { class: "dest-inline", for: "n-company" }, "for", destSel))),
    !S.sample ? h("div", { class: "notice warn", style: "margin-bottom:16px" }, h("span", null, "Open this page in Claude to analyze memos.")) : null,
    h("section", { class: "card" }, h("div", { class: "card-b" }, drop, srcErr, srcList,
      h("div", { class: "nm-tools" },
        h("button", { class: "btn ghost sm", type: "button", "aria-expanded": String(!!D.pasteOpen), onclick: (e) => { D.pasteOpen = !D.pasteOpen; pasteBox.hidden = !D.pasteOpen; e.currentTarget.setAttribute("aria-expanded", String(D.pasteOpen)); if (D.pasteOpen) paste.focus(); } }, svg(IC.text), "Paste text"),
        lang,
        h("details", { class: "howto" }, h("summary", null, "From iPhone Voice Memos"), h("ul", null, h("li", null, "In Voice Memos, tap the recording, then ••• › Share › Save to Files. Then tap the box above and pick it from Recents."), h("li", null, "Or copy Apple's transcript (iOS 18 and later) and paste it. Fastest for long memos."), h("li", null, "Audio is transcribed on this device and isn't uploaded anywhere. It takes about half the recording's length.")))),
      pasteBox)),
    h("section", { class: "card", style: "margin-top:12px" }, h("div", { class: "card-b" }, h("div", { class: "grid3" },
        h("div", { class: "field" }, h("label", { for: "n-title" }, "Title"), h("input", { id: "n-title", value: D.title, placeholder: "Optional", oninput: bind("title") }), titleErr),
        inp("interviewee", "Interviewee", "Name"), inp("role", "Their role", "e.g. Dispatcher")),
      h("details", { class: "fold flat", open: D.moreOpen || null, ontoggle: (e) => { D.moreOpen = e.target.open; } }, h("summary", null, h("span", null, "More details")),
        h("div", { class: "grid2", style: "padding-top:12px" },
          h("div", { class: "field" }, h("label", { for: "n-type" }, "Who was interviewed"), h("select", { id: "n-type", onchange: bind("type") }, TYPES.map((t) => h("option", { value: t, selected: D.type === t }, t === "Owner" ? "Owner / founder" : t === "Staff" ? "Staff / employee" : t)))),
          inp("recordedDate", "Recorded on", "", "date"),
          h("div", { class: "field" }, h("label", { for: "n-sourceType" }, "What this is"), h("select", { id: "n-sourceType", onchange: bind("sourceType") }, SOURCE_TYPES.map(([k, l]) => h("option", { value: k, selected: D.sourceType === k }, l)))),
          h("div", { class: "field" }, h("label", { for: "n-interviewers" }, "Starwell team present"), h("input", { id: "n-interviewers", value: D.interviewers, placeholder: crew.join(", "), list: "crew-list", oninput: bind("interviewers") }), h("datalist", { id: "crew-list" }, crew.map((n) => h("option", { value: n })))),
          h("div", { class: "field full" }, h("label", { for: "n-context" }, "Context for the analysis"), h("textarea", { id: "n-context", rows: "2", placeholder: "Why this meeting happened and what you wanted to learn.", oninput: bind("context") }, D.context)))))),
    h("div", { class: "actionbar" }, status, h("a", { class: "btn ghost lg", href: "#c-" + D.companyId }, "Cancel"), goBtn));
  function srcIcon(s) { return svg(s.kind === "audio" ? IC.mic : s.kind === "image" ? IC.image : s.kind === "paste" ? IC.text : IC.file); }
  function drawSources() {
    srcList.replaceChildren(...D.sources.map((s) => h("div", { class: "src" },
      h("span", { class: "s-ic" }, srcIcon(s)),
      h("div", { style: "min-width:0" }, h("div", { class: "nm" }, s.name), h("div", { class: "st" + (s.status === "error" ? " bad" : "") }, s.status === "ready" ? `${words(s.text).toLocaleString()} words ready` + (s.duration ? ` · ${fmtClock(s.duration)} of audio` : "") : s.status === "error" ? s.error : (s.stage || "Waiting") + (s.status === "working" && s.progress ? ` · ${Math.round(s.progress * 100)}%` : ""))),
      h("button", { class: "icon-btn sm", type: "button", "aria-label": "Remove " + s.name, onclick: () => { s.cancelled = true; D.sources = D.sources.filter((x) => x !== s); drawSources(); } }, svg(IC.close)),
      s.status === "working" ? h("div", { class: "bar2" }, h("i", { style: `width:${Math.round((s.progress || 0) * 100)}%` })) : null,
      s.status === "ready" ? h("details", null, h("summary", null, "Preview"), h("pre", null, s.text.slice(0, 6000) + (s.text.length > 6000 ? "\n… (preview only; the full text is kept)" : ""))) : null)));
    const busy = D.sources.filter((s) => s.status === "working" || s.status === "queued");
    const ready = D.sources.filter((s) => s.status === "ready");
    goBtn.disabled = !S.sample;
    goBtn.textContent = busy.length && D.autoSubmit ? "Will analyze when ready" : busy.length ? "Analyze when ready" : "Save and analyze";
    const pct = busy.length ? Math.round(busy.reduce((n, s) => n + (s.progress || 0), 0) / busy.length * 100) : 0;
    status.textContent = !S.sample ? "" : busy.length ? `Transcribing ${pct}%` + (IS_PHONE ? " · keep this screen on" : "") + (D.autoSubmit ? " · then analyzing" : "") : ready.length ? plural(ready.length, "file") + " ready" : "";
    document.title = busy.length ? `Transcribing ${pct}% · Starwell` : "Starwell SI Transcripts";
    if (D.sources.length) srcErr.hidden = true;
    if (D.autoSubmit && !busy.length && ready.length && currentView.isNew) { D.autoSubmit = false; submit(); }
  }
  function addSource(s) { s.uid = Math.random().toString(36).slice(2); D.sources.push(s); drawSources(); return s; }
  function addFiles(files) { for (const f of files) { const s = addSource({ kind: kindOf(f), name: f.name, size: f.size, status: "queued", stage: "Queued", text: "", file: f }); extract(s, D, drawSources); } }
  $("#filePick").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
  currentView.isNew = true;
  currentView.cleanup = () => { $("#filePick").onchange = null; document.title = "Starwell SI Transcripts"; };
  currentView.refresh = () => { if (destSel.options.length !== S.companies.length) { destSel.replaceChildren(...S.companies.map((c) => h("option", { value: c.id, selected: c.id === D.companyId }, c.name))); } };
  drawSources();
  async function submit() {
    const busy = D.sources.some((s) => s.status === "working" || s.status === "queued");
    const ready = D.sources.filter((s) => s.status === "ready" && s.text.trim());
    srcErr.hidden = ready.length > 0 || busy;
    if (!D.sources.length) { srcErr.hidden = false; drop.focus(); return; }
    if (busy) { D.autoSubmit = !D.autoSubmit; drawSources(); if (D.autoSubmit) toast("Analysis will start as soon as transcription finishes. Keep this tab open."); return; }
    if (!str(D.title)) D.title = [D.interviewee, D.role].map(str).filter(Boolean).join(", ") || ready.find((s) => s.kind !== "paste")?.name.replace(/\.[a-z0-9]+$/i, "") || "";
    titleErr.hidden = !!str(D.title);
    if (!str(D.title)) D.title = "Interview " + fmtShort(D.recordedDate || Date.now());
    if (!str(D.title)) { $("#n-title").focus(); return; }
    if (!ready.length || !company(D.companyId)) return;
    const id = newId("m"), cid = D.companyId; // the company is fixed now, even if someone switches company mid-save
    S.pending.set(id, { title: D.title.trim(), companyId: cid, error: "" });
    location.hash = "#m-" + id;
    try { await createMemo(D, ready, id, cid); if (S.draft === D) S.draft = null; }
    catch (e) { console.error(e); S.pending.set(id, { title: D.title.trim(), companyId: cid, error: e?.code === "quota_exceeded" ? "Storage is full. Delete old memos, then try again." : "Couldn't save the memo. Check your connection and try again." }); scheduleRender(); }
  }
}

// =====================================================================================
// SelectionToolbar: highlight text in a memo → Ask Starwell · Explain · Impact on owner
// =====================================================================================
let selCtx = null;
function hideSelbar() { $("#selbar").hidden = true; selCtx = null; }
function wireSelection() {
  const bar = $("#selbar");
  const check = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { if (!bar.matches(":hover")) hideSelbar(); return; }
    const text = sel.toString().trim();
    const node = (n) => n?.nodeType === 1 ? n : n?.parentElement;
    const a = node(sel.anchorNode), f = node(sel.focusNode);
    const doc = a?.closest("[data-memo]");
    if (!doc || !doc.contains(f) || text.length < 3) { hideSelbar(); return; }
    const refs = [...new Set([a.closest("[data-ref]")?.dataset.ref, f.closest("[data-ref]")?.dataset.ref].filter(Boolean))];
    const mid = doc.dataset.memo;
    selCtx = { companyId: memo(mid)?.companyId, memoId: mid, ref: refs[0] || null, refs, text: text.slice(0, 1500) };
    const r = sel.getRangeAt(0).getBoundingClientRect();
    bar.hidden = false;
    const w = bar.offsetWidth;
    bar.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
    bar.style.top = Math.max(8, r.top - 46) + "px";
  };
  let t; document.addEventListener("selectionchange", () => { clearTimeout(t); t = setTimeout(check, 160); });
  bar.addEventListener("mousedown", (e) => e.preventDefault());
  bar.addEventListener("click", (e) => {
    const act = e.target.closest("button")?.dataset.act; if (!act || !selCtx) return;
    const ctx = { ...selCtx, label: "Selected passage" };
    attachToChat(ctx);
    window.getSelection()?.removeAllRanges(); hideSelbar();
    if (act === "ask") openAssistant();
    else askStarwell(act === "explain" ? "Explain this passage in plain English." : "What does this passage mean for the owner: money, cash timing, capacity, customers or their own workload?", { scope: "memo", memoId: ctx.memoId });
  });
}

// =====================================================================================
// StarwellAssistant: follows what you're reading. On a memo it looks at that memo; elsewhere, the company.
// =====================================================================================
function chatFor(cid) { return S.chats[cid] ||= { scope: "company", memoId: null, messages: [], attach: null }; }
function attachToChat(ctx) { if (!ctx.companyId) return; const ch = chatFor(ctx.companyId); ch.attach = ctx; if (ctx.memoId) { ch.scope = "memo"; ch.memoId = ctx.memoId; } renderAssistant(true); }
const STARTERS_MEMO = [["Break this down", "Walk me through what's going on in this memo, step by step."], ["Find bottlenecks", "Where does work get stuck, and what's the evidence?"], ["What am I missing?", "What's unclear, contradictory or unasked so far?"]];
const STARTERS_CO = [["Owner's perspective", "What would the owner care about most across these memos, and why?"], ["Find bottlenecks", "Where does work get stuck, and what's the evidence?"], ["Estimate impact", "Estimate the business impact, but only from figures that were actually stated."], ["What am I missing?", "What's unclear, contradictory or unasked so far?"]];
let assistKey = "";
function renderAssistant(force) {
  const pane = $("#assist");
  const c = company();
  const r = parseRoute();
  const activeMemo = r.name === "memo" ? memo(r.id) : null;
  const chat = c ? chatFor(c.id) : null;
  if (chat) {
    // scope follows the page: opening a different memo points Ask at it; leaving memos points it at the company
    if (activeMemo && chat.memoId !== activeMemo.id && !chat.attach) { chat.memoId = activeMemo.id; chat.scope = "memo"; }
    if (!activeMemo && !chat.attach) { chat.scope = "company"; chat.memoId = null; }
  }
  const key = JSON.stringify([S.cid, c?.name, activeMemo?.id, activeMemo?.title, chat?.scope, chat?.memoId, chat?.attach, chat?.messages.map((m) => [m.status, m.text?.length, m.saved, m.stage]), S.can, !!S.sample, needsSignIn()]);
  if (key === assistKey && !force) return; assistKey = key;
  const prevInput = $("#a-input")?.value || "";
  const msgsScroll = $(".a-msgs")?.scrollTop;
  const head = (...extra) => h("div", { class: "a-head" }, h("h2", null, h("span", { class: "spark ic" }, svg(IC.spark).firstChild), "Ask Starwell"), extra, h("button", { class: "icon-btn sm", type: "button", "aria-label": "Close Ask Starwell", onclick: closeAssistant }, svg(IC.close)));
  if (needsSignIn() || !c) { pane.replaceChildren(h("div", { class: "apanel" }, head(), h("p", { class: "a-scope" }, needsSignIn() ? "Pick your name to start." : "Pick a company to ask questions about its memos."))); return; }
  const scopeMemo = chat.scope === "memo" ? memo(chat.attach?.memoId || chat.memoId) : null;
  const ta = h("textarea", { id: "a-input", rows: "1", placeholder: scopeMemo ? "Ask about this memo…" : `Ask about ${c.name}…`, "aria-label": "Ask Starwell" });
  ta.value = prevInput;
  const send = h("button", { class: "send", type: "submit", "aria-label": "Send", disabled: !S.sample }, svg(IC.send));
  const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight) + "px"; };
  ta.addEventListener("input", grow);
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  const ask = (q) => askStarwell(q, { scope: chat.scope, memoId: scopeMemo?.id });
  const form = h("form", { class: "a-comp", onsubmit: (e) => { e.preventDefault(); const q = ta.value.trim(); if (!q) return; ta.value = ""; ask(q); } },
    h("div", { class: "a-box" },
      chat.attach ? h("div", { class: "a-chip" }, h("span", null, h("b", null, (chat.attach.label || "Passage") + ": "), "“" + chat.attach.text + "”"),
        h("button", { class: "icon-btn sm", type: "button", style: "width:22px;height:22px", "aria-label": "Remove the attached passage", onclick: () => { chat.attach = null; renderAssistant(true); } }, svg(IC.x, 12))) : null,
      h("div", { class: "a-row" }, ta, send)),
    h("p", { class: "a-foot" }, S.sample ? "Answers can be wrong. Check the linked lines." : "Open this page in Claude to ask questions."));
  const msgs = h("div", { class: "a-msgs", "aria-live": "polite" });
  if (!chat.messages.length) msgs.append(h("p", { class: "a-intro" }, scopeMemo ? "Ask about this memo, or select any words in the transcript." : "Ask about anything in " + c.name + "'s memos."),
    h("div", { class: "a-start" }, (scopeMemo ? STARTERS_MEMO : STARTERS_CO).map(([l, d]) => h("button", { type: "button", disabled: !S.sample, title: d, onclick: () => ask(l + ". " + d) }, svg(IC.spark, 13), l))));
  for (const m of chat.messages) msgs.append(m.role === "user" ? h("div", { class: "u-msg" }, m.attach ? h("blockquote", null, "“" + m.attach.text.slice(0, 220) + (m.attach.text.length > 220 ? "…" : "") + "”") : null, m.text) : answerEl(m, chat, c));
  pane.replaceChildren(h("div", { class: "apanel" },
    head(chat.messages.length ? h("button", { class: "btn ghost sm", type: "button", onclick: () => { chat.messages.forEach((x) => x.ctl?.abort()); chat.messages = []; renderAssistant(true); } }, "New chat") : null),
    h("div", { class: "a-scope" },
      h("div", { class: "seg", role: "group", "aria-label": "What Ask Starwell looks at" },
        h("button", { type: "button", "aria-pressed": String(chat.scope === "memo"), disabled: !activeMemo && !chat.attach?.memoId && !chat.memoId, title: !activeMemo ? "Open a memo to ask about it alone" : null, onclick: () => { chat.scope = "memo"; if (activeMemo) chat.memoId = activeMemo.id; renderAssistant(true); } }, "This memo"),
        h("button", { type: "button", "aria-pressed": String(chat.scope === "company"), onclick: () => { chat.scope = "company"; renderAssistant(true); } }, "Whole company")),
      null),
    msgs, form));
  grow();
  if (msgsScroll != null && !force) msgs.scrollTop = msgsScroll; else msgs.scrollTop = msgs.scrollHeight;
}
const CLAIM = { reported: ["Reported", ""], verified: ["Verified in a record", "ok"], hypothesis: ["Hypothesis", "warn"], unknown: ["Unknown", ""] };
function answerEl(m, chat, c) {
  if (m.status === "loading") return h("div", { class: "a-msg" }, h("div", { class: "a-think" }, h("span", { class: "spin" }), m.stage || "Reading the evidence…"), h("button", { class: "btn ghost sm", type: "button", style: "margin-top:6px", onclick: () => m.ctl?.abort() }, "Stop"));
  if (m.status === "error") return h("div", { class: "a-msg" }, h("p", { class: "notice bad" }, h("span", null, m.error)), m.retry ? h("button", { class: "btn sm", type: "button", style: "margin-top:8px", onclick: m.retry }, "Try again") : null);
  const d = m.data || {};
  const link = (r) => { const res = m.refMap?.[r]; return res ? evLink(res.memoId, res.ref) : null; };
  const refs = (rs) => arr(rs).map(link).filter(Boolean);
  const sec = (t, x, rs) => str(x) ? [h("h4", null, t), h("p", null, str(x), " ", refs(rs))] : null;
  const claims = arr(d.claims);
  return h("div", { class: "a-msg" },
    sec("What this means", d.what_it_means, d.what_it_means_refs), sec("Why it matters", d.why_it_matters, d.why_it_matters_refs), sec("What may be missing", d.what_may_be_missing), sec("Next step", d.next_step),
    claims.length || str(d.deeper) ? h("details", null, h("summary", null, "Show reasoning"),
      claims.length ? h("ul", { class: "claims" }, claims.map((cl) => h("li", null, h("span", null, h("span", { class: "badge " + (CLAIM[cl.kind]?.[1] || "") }, CLAIM[cl.kind]?.[0] || str(cl.kind) || "Claim")), h("span", null, str(cl.text), " ", refs(cl.refs))))) : null,
      str(d.deeper) ? str(d.deeper).split(/\n\n+/).map((p) => h("p", { style: "margin-top:8px" }, p)) : null) : null,
    h("div", { class: "a-acts" },
      S.can.write && d.finding_draft && str(d.finding_draft.title) ? h("button", { class: "btn sm", type: "button", disabled: m.saved, onclick: async () => { await saveDraftFinding(m, c.id); m.saved = true; renderAssistant(true); } }, svg(IC.diag), m.saved ? "Saved as finding" : "Save as finding") : null,
      S.can.write && str(d.next_step) ? h("button", { class: "btn sm", type: "button", onclick: () => createTask({ title: str(d.next_step), companyId: c.id, memoId: m.memoId || null }) }, svg(IC.plus), "Task") : null,
      h("button", { class: "icon-btn sm", type: "button", onclick: async () => { const t = [["What this means", d.what_it_means], ["Why it matters", d.why_it_matters], ["What may be missing", d.what_may_be_missing], ["Next step", d.next_step]].filter(([, x]) => str(x)).map(([k, x]) => k + ": " + x).join("\n\n"); try { await navigator.clipboard.writeText(t); toast("Copied"); } catch { toast("Copy isn't available here."); } }, "aria-label": "Copy answer", title: "Copy" }, svg(IC.copy))));
}
async function saveDraftFinding(m, cid) {
  const d = m.data.finding_draft;
  const ev = arr(d.refs || m.data.why_it_matters_refs || m.data.what_it_means_refs).map((r) => m.refMap?.[r]).filter(Boolean);
  const evidence = await Promise.all(ev.slice(0, 4).map(async (x) => { const s = (await getSegments(x.memoId)).find((y) => y.id === x.ref); return { memoId: x.memoId, ref: x.ref, quote: s ? s.text.slice(0, 240) : "", check: s ? "exact" : "not_found" }; }));
  const id = newId("f");
  try {
    await S.db.doc("findings/" + id).set({ companyId: cid, memoId: ev[0]?.memoId || m.memoId || null, kind: d.kind || "pain_point", title: str(d.title), ownerImplication: str(d.owner_implication || m.data.why_it_matters), symptom: "", evidenceStatus: d.evidence_status || "reported",
      evidence, hypotheses: [], alternatives: [], missing: str(m.data.what_may_be_missing) ? [str(m.data.what_may_be_missing)] : [], nextAction: str(d.next_action || m.data.next_step), solutionClass: "", queue: "investigate_next", importance: d.importance || "medium",
      priorityReason: "", relatedTo: null, origin: "assistant", createdAt: Date.now(), createdBy: S.uid, editedBy: null, assigneeId: null, rev: 1 });
    logEvent(cid, "finding", `saved “${str(d.title)}” from Ask Starwell as a draft finding`, { findingId: id });
    toast("Saved to Findings as a draft");
  } catch { toast("Couldn't save the finding."); }
}
