
// =====================================================================================
// MemoReader
// =====================================================================================
const cmpRef = (a, b) => { const [x1, y1] = String(a).split(".").map(Number), [x2, y2] = String(b).split(".").map(Number); return (x1 - x2) || (y1 - y2); };
// By default the transcript shows the high-signal notes; facts, open questions and quotes are one click away.
const DEFAULT_NOTE_TYPES = ["pain_point", "bottleneck", "emotion", "decision", "opportunity"];
const NOTE_VAR = { pain_point: "--pain", bottleneck: "--neck", emotion: "--emo", fact: "--fact", decision: "--dec", question: "--q", opportunity: "--opp", quote: "--quote" };
S.noteTypes = new Set(lsGet("noteTypes2", DEFAULT_NOTE_TYPES));
S.notesOn = lsGet("notesOn", true);
S.memoView = {};
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
  for (const m of marks) { out.push(text.slice(p, m.s), h("mark", { class: "hl t-" + m.type, title: (NOTE_TYPES[m.type]?.[0] || "Note") + ": " + str(m.note) }, text.slice(m.s, m.e))); p = m.e; }
  out.push(text.slice(p));
  return out;
}
// One quiet line per note; open it to read the whole thing.
function noteEl(n, mid) {
  const t = NOTE_TYPES[n.type] || ["Note"];
  const label = n.type === "emotion" && n.emotion ? n.emotion[0].toUpperCase() + n.emotion.slice(1) : t[0];
  return h("details", { class: "note", style: `--nc: var(${NOTE_VAR[n.type] || "--muted"})` },
    h("summary", null, h("i", { "aria-hidden": "true" }), h("b", null, label), h("span", { class: "t" }, str(n.note))),
    n.type === "emotion" ? h("small", null, "Read from " + ({ wording: "the wording", voice: "the speaker's delivery", both: "the wording and delivery" }[n.basis] || "the wording") + "; an interpretation, not a measurement.") : null);
}
function viewMemo(view, mid) {
  let parts = {}, unsub = null, tick = null, finishing = false, lastKey = "", confirmDel = false, editing = false, mode = "", showDetails = false;
  openTab(mid);
  if (S.db) unsub = S.db.collection(`interviews/${mid}/parts`).onSnapshot((snap) => { parts = {}; for (const d of snap.docs) parts[d.id] = d.data(); draw(); }, (e) => console.error(e));
  currentView.cleanup = () => { unsub?.(); clearInterval(tick); };
  currentView.refresh = () => draw();
  queueMicrotask(draw);

  function segs() {
    const m = memo(mid);
    const items = Object.keys(parts).filter((k) => k.startsWith("seg-")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).flatMap((k) => arr(parts[k].items));
    if (items.length && m && items.length >= 1 && Object.keys(parts).filter((k) => k.startsWith("seg-")).length === (m.segParts || 0)) { const v = items.map((s) => ({ ...s, memoId: mid })); S.segCache.set(mid, v); return v; }
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
    const steps = m.saving ? [["now", "Saving the memo to " + (company(m.companyId)?.name || "the company")], ["todo", "Writing the summary"], ["todo", "Finding pain points, bottlenecks and figures, and checking every quote against the source"], ["todo", "Organizing and annotating the transcript"]]
      : [["done", "Saved to " + (company(m.companyId)?.name || "the company")], [cls(st.summary), "Writing the summary"], [cls(st.findings), "Finding pain points, bottlenecks and figures, and checking every quote against the source"], [cls(st.notes), "Organizing and annotating the transcript" + (notesN > 1 ? ` · ${notesD} of ${notesN} parts` : "")]];
    const failed = m.status === "error" || isStale(m);
    const label = m.error && m.saving === undefined ? m.error : failed ? (isStale(m) ? "Stopped before it finished" : "Didn't finish") : m.saving ? "Saving" : steps.find(([s]) => s === "now")?.[1] || "Starting";
    const here = m.saving || S.running.has(mid);
    return h("section", { class: "progress-card", "aria-live": "polite" },
      h("span", { class: "label" }, failed ? "Analysis interrupted" : "Building the breakdown"),
      h("h2", null, failed ? (m.error || "The tab running the analysis was probably closed.") : "Starwell is reading this memo"),
      failed ? null : [h("div", { class: "lbar", role: "progressbar", "aria-label": "Analysis progress", "aria-valuemin": "0", "aria-valuemax": "100" }, h("i", { id: "lbar" })), h("div", { class: "lmeta" }, h("b", { id: "lpct" }, "0%"), h("span", { id: "lstage" }, label))],
      h("ol", { class: "lsteps" }, steps.map(([s, t]) => h("li", { class: s }, t))),
      failed ? h("p", { class: "hint", style: "margin-top:12px" }, "Finished steps are kept. Running it again resumes from the step that failed; you don't need to upload anything again.")
        : h("p", { class: "hint", style: "margin-top:12px" }, here ? "Most memos take one to three minutes. Keep this tab open; the original transcript below is readable now." : "A teammate's browser is running this analysis. The results appear here on their own."),
      h("div", { class: "dactions" }, failed && S.sample && S.can.write ? h("button", { class: "btn primary sm", type: "button", onclick: () => runAnalysis(mid) }, "Resume analysis") : null,
        S.running.has(mid) ? h("button", { class: "btn sm", type: "button", onclick: () => S.running.get(mid)?.ctl.abort() }, "Stop") : null));
  }

  async function draw() {
    const m0 = memo(mid);
    const pend = S.pending.get(mid);
    if (m0) S.pending.delete(mid);
    const m = m0 || (pend ? { id: mid, title: pend.title, companyId: pend.companyId, saving: !pend.error, error: pend.error, status: pend.error ? "error" : "analyzing" } : null);
    if (!m) { if (S.ready) view.replaceChildren(h("div", { class: "empty" }, h("h3", null, "Memo not found"), h("p", null, "It may have been deleted."))); return; }
    if (finishing) return;
    const analyzing = m.saving || (m.status === "analyzing" && !isStale(m));
    if (mode === "progress" && m.status === "ready" && !analyzing) { finishing = true; clearInterval(tick); paintBar(1, "Done"); setTimeout(() => { finishing = false; mode = "done"; S.memoView[mid] = "organized"; lastKey = ""; draw(); }, 700); return; }
    const a = parts.analysis?.data || null;
    const notesDocs = Object.keys(parts).filter((k) => k.startsWith("notes-") || k.startsWith("organized-")).sort((x, y) => x.localeCompare(y, undefined, { numeric: true })).map((k) => parts[k]);
    const sections = notesDocs.flatMap((d) => arr(d.data?.sections));
    const notes = notesDocs.flatMap((d) => arr(d.data?.notes));
    const ss = segs();
    const fs = S.findings.filter((f) => f.memoId === mid);
    let v = S.memoView[mid] || (m.status === "ready" && sections.length ? "organized" : "original");
    if (v !== "original" && v !== "findings" && !a && !sections.length) v = "original";
    const key = JSON.stringify([m, Object.keys(parts).map((k) => [k, parts[k].at]), v, confirmDel, editing, showDetails, S.notesOn, [...S.noteTypes], fs.map((f) => [f.id, f.rev, reviewOf(f.id), f.assigneeId]), S.running.has(mid)]);
    if (key === lastKey && !S.focus) return;
    if (document.activeElement?.closest("#view form") && !S.focus) return; // don't wipe what someone is typing; the next change redraws
    lastKey = key;
    const ps = await people([m.ownerId]);
    const c = company(m.companyId);
    const center = $("#center"), y = center.scrollTop;
    mode = analyzing ? "progress" : "done";

    const setView = (nv) => { S.memoView[mid] = nv; lastKey = ""; draw(); };
    const counts = { findings: fs.filter((f) => reviewOf(f.id) !== "rejected").length };
    const visNotes = S.notesOn ? notes.filter((n) => S.noteTypes.has(n.type)) : [];
    const redraw = () => { lastKey = ""; draw(); };
    const notesMenu = () => h("div", { class: "pop pop-r", role: "dialog", "aria-label": "Notes on the transcript", onclick: (e) => e.stopPropagation() },
      h("label", { class: "chk" }, h("input", { type: "checkbox", checked: S.notesOn, onchange: (e) => { S.notesOn = e.target.checked; lsSet("notesOn", S.notesOn); redraw(); } }), h("b", null, "Show notes on the transcript")),
      h("div", { class: "pop-sep" }),
      Object.entries(NOTE_TYPES).filter(([k]) => notes.some((n) => n.type === k)).map(([k, [l]]) => h("label", { class: "chk", style: `--nc: var(${NOTE_VAR[k]})` },
        h("input", { type: "checkbox", checked: S.noteTypes.has(k), disabled: !S.notesOn, onchange: (e) => { e.target.checked ? S.noteTypes.add(k) : S.noteTypes.delete(k); lsSet("noteTypes2", [...S.noteTypes]); redraw(); } }),
        h("i", { class: "dot", "aria-hidden": "true" }), l, h("span", { class: "muted num", style: "margin-left:auto" }, notes.filter((n) => n.type === k).length))),
      h("p", { class: "hint", style: "padding:6px 10px 4px" }, "Emotion and tone notes are interpretations of wording or delivery, not measurements."));
    const viewbar = h("div", { class: "viewbar" },
      h("div", { class: "vtabs", role: "tablist", "aria-label": "Memo view" }, [["summary", "Summary", !a], ["organized", "Organized", !sections.length], ["original", "Original", false], ["findings", "Findings", false]].map(([k, l, dis]) =>
        h("button", { type: "button", role: "tab", "aria-selected": String(v === k), "aria-pressed": String(v === k), disabled: dis, title: dis ? "Available when the analysis finishes" : null, onclick: () => setView(k) }, l, k === "findings" && counts.findings ? h("span", { class: "cnt" }, counts.findings) : null))),
      (v === "organized" || v === "original") && notes.length ? h("div", { class: "menu-wrap" },
        h("button", { class: "btn ghost sm", type: "button", "aria-haspopup": "dialog", onclick: (e) => { e.stopPropagation(); const w = e.currentTarget.parentElement; const open = w.querySelector(".pop"); closePops(); if (!open) w.append(notesMenu()); } },
          S.notesOn ? `Notes · ${visNotes.length} of ${notes.length}` : "Notes off", svg(IC.chev, 14))) : null);
    const byRef = new Map(); for (const n of visNotes) { if (!byRef.has(n.ref)) byRef.set(n.ref, []); byRef.get(n.ref).push(n); }
    const spk = (name) => str(m.speakerNames?.[name]) || name || "Speaker";

    let content;
    if (v === "summary" && a) content = summaryView(a, m);
    else if (v === "organized" && sections.length) content = h("div", { class: "doc", "data-memo": mid }, sections.map((s, i) => {
      const refs = arr(s.turns).map((t) => t.ref).filter(Boolean);
      const lo = refs[0], hi = refs[refs.length - 1];
      const loose = lo ? visNotes.filter((n) => !refs.includes(n.ref) && cmpRef(n.ref, lo) >= 0 && cmpRef(n.ref, hi) <= 0) : [];
      const lastTurnOf = new Map(); arr(s.turns || s.exchanges).forEach((t, k) => { if (t.ref) lastTurnOf.set(t.ref, k); }); // a paragraph's notes show once, after its last turn
      const seg0 = ss.find((x) => x.id === lo);
      return h("section", { class: "osec" },
        h("header", null, h("span", { class: "label" }, `Part ${i + 1}` + (seg0 ? " · " + refLabel(seg0) : "")), h("h3", null, str(s.heading))),
        str(s.summary) ? h("p", { class: "sum" }, s.summary) : null,
        arr(s.turns || s.exchanges).map((t, k) => h("div", { class: "turn" + (t.side === "interviewer" ? " interviewer" : ""), "data-ref": t.ref || null },
          h("div", { class: "who" }, speakerLabel(m, t.speaker, spk), t.ref ? evLink(mid, t.ref) : null),
          h("div", { class: "tx" }, str(t.text)),
          t.ref && byRef.get(t.ref) && lastTurnOf.get(t.ref) === k ? h("div", { class: "notes" }, byRef.get(t.ref).map((n) => noteEl(n, mid))) : null)),
        loose.length ? h("div", { class: "notes" }, loose.map((n) => h("div", null, noteEl(n, mid), h("div", { style: "padding-left:10px" }, evLink(mid, n.ref))))) : null,
        arr(s.key_points).length ? h("div", { class: "kp" }, h("span", { class: "label" }, "Key points"), h("ul", null, s.key_points.map((k) => h("li", null, str(k))))) : null);
    }));
    else if (v === "findings") content = findingsView(m, fs, a);
    else {
      let lastSrc = null;
      content = ss.length ? h("div", { class: "doc", "data-memo": mid }, ss.map((s) => {
        const srcInfo = arr(m.sources)[s.src - 1];
        const headEl = s.src !== lastSrc ? h("div", { class: "src-h" }, h("span", { class: "label" }, `Source ${s.src}` + (srcInfo ? " · " + srcLabel(srcInfo) : "")), srcInfo?.kind === "audio" ? h("p", { class: "hint" }, "Automatic transcript. Timestamps are from the recording. Words can be misheard; check the audio for anything important.") : null) : null;
        lastSrc = s.src;
        const ns = byRef.get(s.id) || [];
        return [headEl, h("div", { class: "srow", "data-ref": s.id }, h("div", { class: "ref" }, s.t != null ? fmtClock(s.t) : "¶" + s.id),
          h("div", { style: "min-width:0" }, h("div", null, ...highlight(s.text, ns)),
            arr(s.cues).length ? h("div", { class: "cues", "aria-label": "Delivery measured from the audio" }, s.cues.map((cf) => h("span", { class: "cue", title: "Measured from the audio, compared with the rest of this recording" }, cf))) : null,
            ns.length ? h("div", { class: "notes" }, ns.map((n) => noteEl(n, mid))) : null))];
      })) : h("p", { class: "muted" }, "The source text is loading.");
    }

    // Header: title, one quiet line of details, and everything else behind "Details" and the ⋯ menu.
    const wc = arr(m.sources).reduce((n, s) => n + (s.words || 0), 0) || m.words || 0;
    const dur = arr(m.sources).reduce((n, s) => n + (s.duration || 0), 0);
    const metaLine = [[m.interviewee, m.role].filter(Boolean).join(", ") || m.type + " interview", m.recordedDate ? "Recorded " + fmtDate(m.recordedDate) : null,
      "Uploaded by " + (ps[m.ownerId]?.name || "a teammate"), dur ? fmtClock(dur) + " of audio" : wc ? wc.toLocaleString() + " words" : null].filter(Boolean).join(" · ");
    const menuItems = [
      a ? ["Copy as text", () => copyReport(m, a, sections, fs)] : null,
      a && S.downloads ? ["Download .md", () => downloadReport(m, a, sections, fs)] : null,
      S.can.write ? ["Edit details", () => { editing = true; showDetails = true; redraw(); }] : null,
      S.can.write && S.sample && !analyzing && m.status !== "error" && !isStale(m) ? [a?.version === 2 ? "Re-run analysis" : "Run the full analysis", () => runAnalysis(mid, { fresh: true })] : null,
      S.can.write && (m.ownerId === S.uid || S.can.review) && !S.running.has(mid) ? ["Delete memo", () => { confirmDel = true; redraw(); }, true] : null,
    ].filter(Boolean);
    const menu = !m.saving && menuItems.length ? h("div", { class: "menu-wrap" },
      h("button", { class: "icon-btn", type: "button", "aria-label": "More actions", "aria-haspopup": "menu", onclick: (e) => { e.stopPropagation(); const w = e.currentTarget.parentElement; const open = w.querySelector(".pop"); closePops(); if (!open) w.append(h("div", { class: "pop pop-r", role: "menu" }, menuItems.map(([l, fn, danger]) => h("button", { class: "pop-item" + (danger ? " danger" : ""), type: "button", role: "menuitem", onclick: () => { closePops(); fn(); } }, l)))); } },
        h("span", { "aria-hidden": "true", style: "font-size:20px;line-height:1;letter-spacing:1px" }, "⋯"))) : null;
    view.replaceChildren(
      h("div", { class: "memo-h" },
        h("div", { class: "memo-top" }, h("div", { class: "crumb", style: "margin:0" }, c ? h("a", { href: "#c-" + c.id }, c.name) : h("span", null, "Unassigned"), "›", c ? h("a", { href: "#c-" + c.id + "-memos" }, "Memos") : null, m.status === "ready" && !m.saving ? null : statusChip(m)), menu),
        h("h1", null, m.title || "Untitled memo"),
        h("p", { class: "meta-line" }, metaLine, " · ", h("button", { class: "linkish", type: "button", "aria-expanded": String(showDetails), onclick: () => { showDetails = !showDetails; redraw(); } }, showDetails ? "Hide details" : "Details")),
        showDetails ? h("dl", { class: "profile", style: "margin-top:12px;max-width:640px" }, [["Interview type", m.type], ["What this is", SOURCE_TYPES.find(([k]) => k === m.sourceType)?.[1]], ["Recorded", m.recordedDate ? fmtDate(m.recordedDate) : "Not given"], ["Uploaded", m.createdAt ? fmtDate(m.createdAt) + " by " + (ps[m.ownerId]?.name || "a teammate") : null], ["Starwell team", m.interviewers], ["Material", arr(m.sources).length ? arr(m.sources).map(srcLabel).join("; ") : null], ["Context", m.context]]
          .filter(([, x]) => str(x)).map(([k, x]) => [h("dt", null, k), h("dd", null, x)])) : null,
        str(m.headline) && v !== "summary" ? h("p", { class: "headline clamp" }, m.headline) : null,
        confirmDel ? h("div", { class: "notice bad", role: "alert", style: "margin-top:12px" }, h("span", null, "Delete this memo, its transcript and its draft findings for the whole team? Reviewed findings stay. This can't be undone."),
          h("button", { class: "btn sm danger", type: "button", onclick: () => deleteMemo(m) }, "Delete memo"), h("button", { class: "btn sm", type: "button", onclick: () => { confirmDel = false; lastKey = ""; draw(); } }, "Keep it")) : null,
        editing ? memoEditForm(m, () => { editing = false; lastKey = ""; draw(); }) : null,
        m.status === "ready" && a && a.version !== 2 ? h("div", { class: "notice info", style: "margin-top:12px" }, h("span", null, "This memo was analyzed by an earlier version. Run the full analysis to get transcript notes, findings and source links.")) : null),
      analyzing || m.status === "error" || isStale(m) ? progressCard(m) : null,
      viewbar,
      content);
    center.scrollTop = y;
    if (analyzing && mode === "progress") { paintBar(frac(m)); clearInterval(tick); tick = setInterval(() => { if (!finishing) paintBar(frac(memo(mid) || m)); }, 500); }
    else clearInterval(tick);
    requestAnimationFrame(focusPassage);
  }
}
function speakerLabel(m, name, spk) {
  const shown = spk(name);
  if (!S.can.write || !name || name === "Notes") return h("span", null, shown);
  return h("button", { type: "button", class: "spk", title: "Rename this speaker everywhere in the memo", onclick: async (e) => {
    e.stopPropagation();
    const b = e.currentTarget;
    const inp = h("input", { class: "inp", style: "width:auto;padding:2px 6px;font-size:13px", value: shown, "aria-label": "Speaker name for " + name });
    const save = async () => { const nv = str(inp.value); if (nv && nv !== shown) { try { await S.db.doc("interviews/" + m.id).update({ speakerNames: { ...(m.speakerNames || {}), [name]: nv } }); toast("Renamed in every part of this memo"); } catch { toast("Couldn't rename."); } } else inp.replaceWith(b); };
    inp.addEventListener("keydown", (k) => { if (k.key === "Enter") { k.preventDefault(); save(); } if (k.key === "Escape") inp.replaceWith(b); });
    inp.addEventListener("blur", save);
    b.replaceWith(inp); inp.focus(); inp.select();
  } }, shown);
}
const srcLabel = (s) => [s.name, s.duration ? fmtClock(s.duration) + " of audio" : null, s.words ? s.words.toLocaleString() + " words" : null].filter(Boolean).join(", ");
function summaryView(a, m) {
  const mid = m.id;
  const refs = (rs) => arr(rs).slice(0, 4).map((r) => evLink(mid, r));
  const g = a.at_a_glance || {};
  return h("div", { class: "doc", "data-memo": mid, style: "max-width:74ch" },
    h("section", null, str(m.headline) ? h("p", { style: "font-size:18px;font-weight:500;line-height:1.45;margin-bottom:14px" }, m.headline) : null, str(a.executive_summary).split(/\n\n+/).map((p) => h("p", { style: "margin-bottom:10px" }, p)),
      h("div", { class: "glance" }, [["Purpose", g.purpose], ["Outcome", g.outcome], ["Interest level", g.interest_level], ["Next step", g.next_step]].filter(([, x]) => str(x)).map(([k, x]) => h("div", null, h("span", { class: "label" }, k), h("b", null, str(x)))))),
    a.tone && (str(a.tone.overall) || arr(a.tone.moments).length) ? h("section", { class: "sec" }, h("h2", null, "Tone and delivery"),
      h("p", { class: "lede" }, "Interpretations from the wording and, for recordings, measured delivery (volume, pace, pauses). They are cues to read with the passage, not measurements of how anyone felt."),
      str(a.tone.overall) ? h("p", null, a.tone.overall) : null,
      h("ul", { class: "plain", style: "margin-top:10px" }, arr(a.tone.moments).map((t) => h("li", null, h("span", { class: "chip c-emo", style: "margin-right:6px" }, str(t.emotion) || "Tone"), str(t.note), " ", refs([t.ref]))))) : null,
    arr(a.meeting_flow).length ? h("section", { class: "sec" }, h("h2", null, "How the meeting went"), h("ol", { class: "flow", style: "margin-top:10px" }, a.meeting_flow.map((f) => h("li", null, h("h4", null, str(f.phase)), h("p", null, str(f.summary), " ", refs(f.refs)))))) : null,
    arr(a.topics).length ? h("section", { class: "sec" }, h("h2", null, "Everything covered"), h("p", { class: "lede" }, "Every topic, with each point made and where it was said."),
      a.topics.map((t) => h("div", { class: "topic" }, h("h4", null, str(t.topic)), h("ul", null, arr(t.details).map((d) => h("li", null, str(d.text ?? d), " ", refs(d.refs))))))) : null,
    arr(a.quotes).length ? h("section", { class: "sec" }, h("h2", null, "In their words"), a.quotes.map((q) => h("blockquote", { class: "quote" }, h("p", null, "“" + str(q.quote).replace(/^["“]|["”]$/g, "") + "”"), h("footer", null, h("b", null, str(q.speaker) || "Speaker"), str(q.why) ? " · " + str(q.why) : "", " ", refs([q.ref]))))) : null,
    arr(a.participants).length || arr(a.people_mentioned).length ? h("section", { class: "sec" }, h("h2", null, "People"), h("div", { class: "tbl-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, "Name"), h("th", null, "Role"), h("th", null, "Notes"))),
      h("tbody", null, [...arr(a.participants).map((p) => [p.name, [p.role, p.side].filter(str).join(" · "), p.notes, "In the meeting"]), ...arr(a.people_mentioned).map((p) => [p.name, p.role, p.context, "Mentioned"])].map(([n, r, x, k]) => h("tr", null, h("td", null, h("b", { style: "font-weight:500" }, str(n) || "Unnamed"), h("div", { class: "muted", style: "font-size:12px" }, k)), h("td", null, str(r)), h("td", null, str(x)))))))) : null,
    h("section", { class: "sec" }, h("h2", null, "Agreed next steps"), arr(a.action_items).length ? h("ul", { class: "plain" }, a.action_items.map((t) => h("li", null, str(t.task), h("span", { class: "muted" }, [str(t.owner) && " · " + str(t.owner), str(t.due) && " · due " + str(t.due)].filter(Boolean).join("")), " ", refs([t.ref]),
      S.can.write ? h("button", { class: "btn ghost sm", type: "button", style: "margin-left:4px", onclick: () => createTask({ title: str(t.task), memoId: mid, companyId: m.companyId }) }, "Add to Actions") : null))) : h("p", { class: "muted" }, "None were agreed in this memo.")),
    h("section", { class: "sec" }, h("h2", null, "Open questions"), arr(a.open_questions).length ? h("ul", { class: "plain" }, a.open_questions.map((q) => h("li", null, str(q)))) : h("p", { class: "muted" }, "None recorded.")));
}
function findingsView(m, fs, a) {
  const xs = S.metrics.filter((x) => x.memoId === m.id);
  const cards = fs.length
    ? h("div", { class: "stack" }, rankFindings(fs).concat(fs.filter((f) => reviewOf(f.id) === "rejected")).map((f) => DiagnosticCard(f, { memoId: m.id })))
    : h("div", { class: "empty" }, a?.version === 2
      ? [h("h3", null, "No actionable issue established"), h("p", null, "The analysis didn't find a problem supported by this memo. That's a valid result, not a missing one.")]
      : [h("h3", null, "No findings yet"), h("p", null, "Findings appear when the analysis finishes.")]);
  const vals = xs.filter((x) => str(x.value));
  const table = vals.length ? h("section", { class: "sec" }, h("h2", null, "Key numbers in this memo"), h("div", { class: "mgrid", style: "margin-top:10px" }, vals.map((x) => MetricCard(x, { inMemo: true })))) : null;
  return h("div", null, cards, table);
}
function memoEditForm(m, done) {
  const v = { title: m.title, interviewee: m.interviewee, role: m.role, type: m.type, recordedDate: m.recordedDate, interviewers: m.interviewers, context: m.context };
  const inp = (k, l, type = "text") => h("div", { class: "field" }, h("label", { for: "me-" + k }, l), h("input", { id: "me-" + k, type, value: v[k] || "", oninput: (e) => (v[k] = e.target.value) }));
  return h("form", { class: "card stack memo-edit", style: "margin-top:14px", onsubmit: async (e) => { e.preventDefault(); if (!str(v.title)) return toast("The title can't be empty."); try { await S.db.doc("interviews/" + m.id).update({ ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, str(x)])), updatedAt: Date.now() }); toast("Details saved"); done(); } catch { toast("Couldn't save."); } } },
    h("div", { class: "grid2" }, inp("title", "Title"), inp("interviewee", "Interviewee"), inp("role", "Their role"), h("div", { class: "field" }, h("label", { for: "me-type" }, "Interview type"), h("select", { id: "me-type", onchange: (e) => (v.type = e.target.value) }, TYPES.map((t) => h("option", { selected: v.type === t }, t)))),
      inp("recordedDate", "Recorded on", "date"), inp("interviewers", "Starwell team present"), h("div", { class: "field full" }, h("label", { for: "me-context" }, "Context"), h("textarea", { id: "me-context", rows: "2", oninput: (e) => (v.context = e.target.value) }, v.context || ""))),
    h("p", { class: "hint" }, "Changing names or context doesn't change existing notes. Re-run the analysis if it should."),
    h("div", { class: "dactions" }, h("button", { class: "btn primary sm", type: "submit" }, "Save details"), h("button", { class: "btn sm", type: "button", onclick: done }, "Cancel")));
}
async function deleteMemo(m) {
  try {
    const snap = await S.db.collection(`interviews/${m.id}/parts`).get();
    for (const d of snap.docs) await S.db.doc(`interviews/${m.id}/parts/${d.id}`).delete();
    for (const f of S.findings.filter((f) => f.memoId === m.id && !S.reviews[f.id])) await S.db.doc("findings/" + f.id).delete();
    for (const x of S.metrics.filter((x) => x.memoId === m.id)) await S.db.doc("metrics/" + x.id).delete();
    await S.db.doc("interviews/" + m.id).delete();
    S.segCache.delete(m.id);
    if (m.companyId) { S.tabs[m.companyId] = (S.tabs[m.companyId] || []).filter((x) => x !== m.id); lsSet("tabs", S.tabs); logEvent(m.companyId, "delete", `deleted the memo “${m.title}”`); }
    toast("Memo deleted");
    location.hash = m.companyId ? "#c-" + m.companyId + "-memos" : "#unassigned";
  } catch (e) { console.error(e); toast("Couldn't delete the memo."); }
}

// =====================================================================================
// New memo: destination company first; only inputs that work
// =====================================================================================
function blankDraft() { return { companyId: S.cid, title: "", sourceType: "conversation", type: "Owner", interviewee: "", role: "", recordedDate: new Date().toISOString().slice(0, 10), interviewers: "", context: "", language: "english", sources: [] }; }
function viewNewMemo(view) {
  if (S.offline || !S.can.write) { location.hash = ""; return; }
  if (!S.companies.length) { view.replaceChildren(h("div", { class: "empty" }, h("h3", null, "Add a company first"), h("p", null, "Every memo belongs to a company. Use the company switcher at the top left to add one."))); return; }
  if (!S.draft || !company(S.draft.companyId)) S.draft = { ...(S.draft || blankDraft()), companyId: S.draft?.companyId && company(S.draft.companyId) ? S.draft.companyId : S.cid };
  const D = S.draft;
  const bind = (k) => (e) => { D[k] = e.target.value; if (k === "title") titleErr.hidden = true; };
  const inp = (k, l, ph, type = "text") => h("div", { class: "field" }, h("label", { for: "n-" + k }, l), h("input", { id: "n-" + k, type, value: D[k], placeholder: ph, oninput: bind(k) }));
  const titleErr = h("div", { class: "err", hidden: true }, "Give the memo a title so the team can find it.");
  const srcErr = h("div", { class: "err", hidden: true }, "Add at least one recording, file or pasted transcript.");
  const srcList = h("div", { class: "srcs" });
  const paste = h("textarea", { id: "n-paste", rows: "5", placeholder: "Paste a Voice Memos or Notes transcript, an email, or typed notes." });
  const drop = h("div", { class: "drop", tabindex: "0", role: "button", "aria-label": "Add files", onclick: () => $("#filePick").click(), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#filePick").click(); } },
    ondragover: (e) => { e.preventDefault(); drop.classList.add("over"); }, ondragleave: () => drop.classList.remove("over"), ondrop: (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); } },
    h("b", null, IS_PHONE ? "Tap to add a recording or file" : "Drop recordings, notes and documents here"), h("p", null, IS_PHONE ? "Voice memos, notes exports, PDFs or photos of notes." : "or click to choose. Add everything from the interview: the voice memo, typed notes, a photo of handwritten notes."),
    h("div", { class: "fmt" }, ["M4A", "QTA", "MP3", "WAV", "CAF", "MP4", "MOV", "TXT", "DOCX", "PDF", "RTF", "VTT", "JPG", "PNG"].map((f) => h("span", null, f))));
  const goBtn = h("button", { class: "btn primary", type: "button", onclick: submit }, "Save and analyze");
  const goNote = h("p", { class: "hint" });
  const destSel = h("select", { id: "n-company", class: "inp", style: "width:auto;min-width:200px;font-weight:600", onchange: (e) => { D.companyId = e.target.value; } }, S.companies.map((c) => h("option", { value: c.id, selected: c.id === D.companyId }, c.name)));
  view.replaceChildren(
    h("div", { class: "page-h" }, h("div", null, h("h1", null, "New memo"), h("p", null, "Starwell keeps the original wording, writes an organized version with notes on it, and drafts findings that link to the exact passages."))),
    h("div", { class: "dest" }, h("label", { for: "n-company" }, "Saving to"), destSel, h("span", { class: "muted", style: "font-size:13px" }, "Only this company's team view will include it.")),
    h("section", { class: "card" }, h("h2", { style: "font-size:16px;font-weight:600;margin-bottom:12px" }, "About the conversation"),
      h("div", { class: "grid2" },
        h("div", { class: "field full" }, h("label", { for: "n-title" }, "Title ", h("em", null, "*")), h("input", { id: "n-title", value: D.title, placeholder: "e.g. Dispatcher walkthrough with Maria", oninput: bind("title") }), titleErr),
        h("div", { class: "field" }, h("label", { for: "n-sourceType" }, "What this is"), h("select", { id: "n-sourceType", onchange: bind("sourceType") }, SOURCE_TYPES.map(([k, l]) => h("option", { value: k, selected: D.sourceType === k }, l)))),
        h("div", { class: "field" }, h("label", { for: "n-type" }, "Who was interviewed"), h("select", { id: "n-type", onchange: bind("type") }, TYPES.map((t) => h("option", { value: t, selected: D.type === t }, t === "Owner" ? "Owner / founder" : t === "Staff" ? "Staff / employee" : t)))),
        inp("interviewee", "Their name", "Who you spoke with"), inp("role", "Their role", "e.g. Dispatcher"),
        inp("recordedDate", "Recorded on", "", "date"), inp("interviewers", "Starwell team present", "Names"),
        h("div", { class: "field full" }, h("label", { for: "n-context" }, "Context for the analysis"), h("textarea", { id: "n-context", rows: "2", placeholder: "Why this meeting happened and what you wanted to learn.", oninput: bind("context") }, D.context)))),
    h("section", { class: "card", style: "margin-top:14px" }, h("h2", { style: "font-size:16px;font-weight:600" }, "Recordings and notes"),
      h("p", { class: "hint", style: "margin-bottom:12px" }, "Audio is transcribed in your browser; recordings aren't uploaded anywhere. Expect about half the recording's length."),
      drop,
      h("div", { class: "ios" }, h("b", null, "From iPhone Voice Memos"), h("ul", null, h("li", null, "Send the recording: in Voice Memos tap the memo, then ••• › Share › Save to Files. Then tap the box above and pick it from Recents."), h("li", null, "Or copy Apple's transcript (iOS 18 and later) and paste it below. Fastest for long memos."))),
      h("div", { class: "field", style: "margin-top:14px" }, h("label", { for: "n-paste" }, "Paste text"), paste,
        h("div", { style: "display:flex;justify-content:flex-end;margin-top:6px" }, h("button", { class: "btn sm", type: "button", onclick: () => { const t = paste.value.trim(); if (!t) return; addSource({ kind: "paste", name: "Pasted text " + (D.sources.filter((s) => s.kind === "paste").length + 1), size: t.length, status: "ready", text: t }); paste.value = ""; } }, "Add pasted text"))),
      h("div", { class: "field", style: "max-width:260px" }, h("label", { for: "n-language" }, "Language spoken in recordings"), h("select", { id: "n-language", onchange: bind("language") }, [["english", "English"], ["spanish", "Spanish"], ["portuguese", "Portuguese"], ["french", "French"], ["vietnamese", "Vietnamese"], ["chinese", "Chinese"], ["korean", "Korean"], ["tagalog", "Tagalog"], ["arabic", "Arabic"]].map(([k, l]) => h("option", { value: k, selected: D.language === k }, l)))),
      srcErr, srcList, IS_PHONE ? h("p", { class: "notice", style: "margin-top:12px" }, h("span", null, "Keep this screen open while recordings transcribe. Your phone pauses the work when it locks or you switch apps.")) : null),
    h("div", { class: "dactions", style: "margin-top:18px;align-items:center" }, goBtn, h("a", { class: "btn ghost", href: "#c-" + D.companyId }, "Cancel")), goNote);
  function drawSources() {
    srcList.replaceChildren(...D.sources.map((s) => h("div", { class: "src" },
      h("div", { style: "min-width:0" }, h("div", { class: "nm" }, s.name), h("div", { class: "st" + (s.status === "error" ? " bad" : "") }, s.status === "ready" ? `${words(s.text).toLocaleString()} words ready` + (s.duration ? ` · ${fmtClock(s.duration)} of audio` : "") : s.status === "error" ? s.error : s.stage || "Waiting")),
      h("button", { class: "btn ghost sm", type: "button", "aria-label": "Remove " + s.name, onclick: () => { s.cancelled = true; D.sources = D.sources.filter((x) => x !== s); drawSources(); } }, "Remove"),
      s.status === "working" ? h("div", { class: "bar2" }, h("i", { style: `width:${Math.round((s.progress || 0) * 100)}%` })) : null,
      s.status === "ready" ? h("details", null, h("summary", null, "Preview"), h("pre", null, s.text.slice(0, 6000) + (s.text.length > 6000 ? "\n… (preview only; the full text is kept)" : ""))) : null)));
    const busy = D.sources.some((s) => s.status === "working" || s.status === "queued");
    goBtn.disabled = busy || !S.sample;
    goNote.textContent = !S.sample ? "AI analysis isn't available in this view. Open the page in Claude." : busy ? "Waiting for files to finish…" : "Uses your Claude account. You'll be asked to allow it the first time.";
    if (D.sources.length) srcErr.hidden = true;
  }
  function addSource(s) { s.uid = Math.random().toString(36).slice(2); D.sources.push(s); drawSources(); return s; }
  function addFiles(files) { for (const f of files) { const s = addSource({ kind: kindOf(f), name: f.name, size: f.size, status: "queued", stage: "Queued", text: "", file: f }); extract(s, D, drawSources); } }
  $("#filePick").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
  currentView.cleanup = () => { $("#filePick").onchange = null; };
  currentView.refresh = () => { if (destSel.options.length !== S.companies.length) { destSel.replaceChildren(...S.companies.map((c) => h("option", { value: c.id, selected: c.id === D.companyId }, c.name))); } };
  drawSources();
  async function submit() {
    const ready = D.sources.filter((s) => s.status === "ready" && s.text.trim());
    titleErr.hidden = !!D.title.trim(); srcErr.hidden = ready.length > 0;
    if (!D.title.trim()) { $("#n-title").focus(); return; }
    if (!ready.length || !company(D.companyId)) return;
    const id = newId("m"), cid = D.companyId; // the company is fixed now, even if someone switches company mid-save
    S.pending.set(id, { title: D.title.trim(), companyId: cid, error: "" });
    location.hash = "#m-" + id;
    try { await createMemo(D, ready, id, cid); if (S.draft === D) S.draft = null; }
    catch (e) { console.error(e); S.pending.set(id, { title: D.title.trim(), companyId: cid, error: e?.code === "quota_exceeded" ? "Storage is full. Delete old memos, then try again." : "Couldn't save the memo. Check your connection and try again." }); scheduleRender(); }
  }
}

// =====================================================================================
// SelectionToolbar: highlight text in a memo → Ask Starwell · Explain · Owner impact
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
// StarwellAssistant
// =====================================================================================
function chatFor(cid) { return S.chats[cid] ||= { scope: "memo", messages: [], attach: null }; }
function attachToChat(ctx) { if (!ctx.companyId) return; chatFor(ctx.companyId).attach = ctx; renderAssistant(true); }
const STARTERS = [["Break this down", "Walk me through what's going on here, step by step."], ["Find bottlenecks", "Where does work get stuck, and what's the evidence?"], ["Owner's perspective", "What would the owner care about most here, and why?"], ["What am I missing?", "What's unclear, contradictory or unasked so far?"], ["Estimate impact", "Estimate the business impact, but only from figures that were actually stated."]];
let assistKey = "";
function renderAssistant(force) {
  const pane = $("#assist");
  const c = company();
  const r = parseRoute();
  const activeMemo = r.name === "memo" ? memo(r.id) : null;
  const chat = c ? chatFor(c.id) : null;
  if (chat && !activeMemo && chat.scope === "memo" && !chat.attach) chat.scope = "company";
  const key = JSON.stringify([S.cid, c?.name, activeMemo?.id, activeMemo?.title, chat?.scope, chat?.attach, chat?.messages.map((m) => [m.status, m.text?.length, m.saved]), S.can, !!S.sample]);
  if (key === assistKey && !force) return; assistKey = key;
  const prevInput = $("#a-input")?.value || "";
  const msgsScroll = $(".a-msgs")?.scrollTop;
  if (needsSignIn()) { pane.replaceChildren(h("div", { class: "apanel" }, h("div", { class: "a-head" }, h("h2", null, h("span", { class: "a-mark" }, "S"), "Ask Starwell"), closeBtn()), h("p", { class: "a-scope" }, "Pick your name to start."))); return; }
  if (!c) { pane.replaceChildren(h("div", { class: "apanel" }, h("div", { class: "a-head" }, h("h2", null, h("span", { class: "a-mark" }, "S"), "Ask Starwell"), closeBtn()), h("p", { class: "a-scope" }, "Pick a company to ask questions about its memos."))); return; }
  const scopeMemo = chat.scope === "memo" && (chat.attach?.memoId || activeMemo?.id);
  const ta = h("textarea", { id: "a-input", rows: "1", placeholder: scopeMemo ? "Ask about this memo…" : `Ask about ${c.name}…`, "aria-label": "Ask Starwell" });
  ta.value = prevInput;
  const send = h("button", { class: "send", type: "submit", "aria-label": "Send", disabled: !S.sample }, svg(IC.send));
  const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight) + "px"; };
  ta.addEventListener("input", grow);
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  const form = h("form", { class: "a-comp", onsubmit: (e) => { e.preventDefault(); const q = ta.value.trim(); if (!q) return; ta.value = ""; askStarwell(q, { scope: chat.scope, memoId: activeMemo?.id }); } },
    h("div", { class: "a-box" },
      chat.attach ? h("div", { class: "a-chip" }, h("span", null, h("b", null, (chat.attach.label || "Passage") + (chat.attach.ref ? " · " + chat.attach.ref : "") + ": "), "“" + chat.attach.text + "”"),
        h("button", { class: "icon-btn", type: "button", style: "width:24px;height:24px", "aria-label": "Remove the attached passage", onclick: () => { chat.attach = null; renderAssistant(true); } }, svg(IC.x, 12))) : null,
      h("div", { class: "a-row" }, ta, send)),
    h("p", { class: "a-foot" }, S.sample ? "Answers use only " + c.name + "'s memos and can be wrong. Check the linked passages." : "Open this page in Claude to ask questions."));
  const msgs = h("div", { class: "a-msgs", "aria-live": "polite" });
  if (!chat.messages.length) msgs.append(h("p", { class: "muted", style: "font-size:14px" }, scopeMemo ? "Ask about " + (memo(scopeMemo)?.title || "this memo") + ", or highlight a passage in the transcript." : "Ask anything about " + c.name + ". Answers cite the passages they rely on."),
    h("div", { class: "a-start" }, STARTERS.map(([l, d]) => h("button", { type: "button", disabled: !S.sample, onclick: () => askStarwell(l + ". " + d, { scope: chat.scope, memoId: activeMemo?.id }) }, l, h("small", null, d)))));
  for (const m of chat.messages) msgs.append(m.role === "user" ? h("div", { class: "u-msg" }, m.attach ? h("blockquote", null, "“" + m.attach.text.slice(0, 220) + (m.attach.text.length > 220 ? "…" : "") + "”") : null, m.text) : answerEl(m, chat, c));
  pane.replaceChildren(h("div", { class: "apanel" },
    h("div", { class: "a-head" }, h("h2", null, h("span", { class: "a-mark", "aria-hidden": "true" }, "S"), "Ask Starwell"),
      chat.messages.length ? h("button", { class: "btn ghost sm", type: "button", onclick: () => { chat.messages.forEach((x) => x.ctl?.abort()); chat.messages = []; renderAssistant(true); } }, "New chat") : null, closeBtn()),
    h("div", { class: "a-scope" },
      h("div", { class: "seg", role: "group", "aria-label": "What Ask Starwell looks at" },
        h("button", { type: "button", "aria-pressed": String(chat.scope === "memo"), disabled: !activeMemo && !chat.attach?.memoId, title: !activeMemo ? "Open a memo to ask about it alone" : null, onclick: () => { chat.scope = "memo"; renderAssistant(true); } }, "This memo"),
        h("button", { type: "button", "aria-pressed": String(chat.scope === "company"), onclick: () => { chat.scope = "company"; renderAssistant(true); } }, "Company evidence")),
      h("span", null, chat.scope === "memo" && scopeMemo ? "Looking at: " + (memo(scopeMemo)?.title || "this memo") : "Looking at: every memo and finding for " + c.name)),
    msgs, form));
  grow();
  if (msgsScroll != null && !force) msgs.scrollTop = msgsScroll; else msgs.scrollTop = msgs.scrollHeight;
  function closeBtn() { return h("button", { class: "icon-btn", type: "button", "aria-label": "Close Ask Starwell", onclick: closeAssistant }, svg(IC.collapse)); }
}
const CLAIM = { reported: ["Reported", "c-info"], verified: ["Verified in a record", "c-ok"], hypothesis: ["Hypothesis", "c-warn"], unknown: ["Unknown", "c-q"] };
function answerEl(m, chat, c) {
  if (m.status === "loading") return h("div", { class: "a-msg" }, h("div", { class: "a-think" }, h("span", { class: "spin" }), m.stage || "Reading the evidence…"), h("button", { class: "btn ghost sm", type: "button", style: "margin-top:6px", onclick: () => m.ctl?.abort() }, "Stop"));
  if (m.status === "error") return h("div", { class: "a-msg" }, h("p", { class: "notice bad" }, h("span", null, m.error)), m.retry ? h("button", { class: "btn sm", type: "button", style: "margin-top:8px", onclick: m.retry }, "Try again") : null);
  const d = m.data || {};
  const link = (r) => { const res = m.refMap?.[r]; return res ? evLink(res.memoId, res.ref) : null; };
  const refs = (rs) => arr(rs).map(link).filter(Boolean);
  const sec = (t, x, rs) => str(x) ? [h("h4", null, t), h("p", null, str(x), " ", refs(rs))] : null;
  return h("div", { class: "a-msg" },
    sec("What this means", d.what_it_means, d.what_it_means_refs), sec("Why it matters", d.why_it_matters, d.why_it_matters_refs), sec("What may be missing", d.what_may_be_missing), sec("Next step", d.next_step),
    arr(d.claims).length ? [h("h4", null, "Claims and their support"), h("ul", { class: "claims" }, d.claims.map((cl) => h("li", null, h("span", null, chipOf(CLAIM, cl.kind)), h("span", null, str(cl.text), " ", refs(cl.refs)))))] : null,
    str(d.deeper) ? h("details", null, h("summary", null, "Deeper analysis"), str(d.deeper).split(/\n\n+/).map((p) => h("p", { style: "margin-top:8px" }, p))) : null,
    h("div", { class: "a-acts" },
      S.can.write && d.finding_draft && str(d.finding_draft.title) ? h("button", { class: "btn sm", type: "button", disabled: m.saved, onclick: async () => { await saveDraftFinding(m, c.id); m.saved = true; renderAssistant(true); } }, m.saved ? "Saved as draft finding" : "Save as draft finding") : null,
      S.can.write && str(d.next_step) ? h("button", { class: "btn sm", type: "button", onclick: () => createTask({ title: str(d.next_step), companyId: c.id, memoId: m.memoId || null }) }, "Create task") : null,
      h("button", { class: "btn ghost sm", type: "button", onclick: async () => { const t = [["What this means", d.what_it_means], ["Why it matters", d.why_it_matters], ["What may be missing", d.what_may_be_missing], ["Next step", d.next_step]].filter(([, x]) => str(x)).map(([k, x]) => k + ": " + x).join("\n\n"); try { await navigator.clipboard.writeText(t); toast("Copied"); } catch { toast("Copy isn't available here."); } } }, "Copy")));
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
    toast("Saved to Diagnostics as a draft");
  } catch { toast("Couldn't save the finding."); }
}
