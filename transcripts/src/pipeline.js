// ---------- source extraction ----------
const EXT = (n) => (n.split(".").pop() || "").toLowerCase();
const AUDIO_EXT = ["m4a", "mp3", "wav", "aac", "ogg", "oga", "opus", "flac", "webm", "mp4", "mov", "m4v", "qta", "caf", "aiff", "aif", "aifc", "amr", "3gp", "3g2", "wma", "mka", "mkv", "avi", "m4b"];
// Decide from the file's first bytes; names and MIME types from phones are often missing or wrong (iOS gives .qta no type at all).
async function sniffKind(f) {
  const b = new Uint8Array(await f.slice(0, 2048).arrayBuffer());
  const asc = (o, n) => String.fromCharCode(...b.subarray(o, o + n));
  if (asc(4, 4) === "ftyp") return /^(heic|heix|hevc|mif1|msf1|avif)/.test(asc(8, 4)) ? "image" : "audio";
  if (["RIFF", "OggS", "fLaC", "caff", "FORM", "#!AM"].includes(asc(0, 4)) || asc(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) ||
      (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) || (b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2)) return asc(8, 4) === "WEBP" ? "image" : "audio";
  if (["moov", "mdat", "wide", "free"].includes(asc(4, 4))) return "audio";
  if (asc(0, 4) === "%PDF") return "pdf";
  if (asc(0, 5) === "{\\rtf") return "rtf";
  if ((b[0] === 0xff && b[1] === 0xd8) || asc(1, 3) === "PNG" || asc(0, 3) === "GIF") return "image";
  if (asc(0, 2) === "PK") return EXT(f.name) === "docx" ? "docx" : "unsupported";
  if (b.length && b.subarray(0, 1024).includes(0)) return AUDIO_EXT.includes(EXT(f.name)) ? "audio" : "unsupported";
  return kindOf(f);
}
function kindOf(f) {
  const e = EXT(f.name), t = f.type || "";
  if (t.startsWith("audio/") || t.startsWith("video/") || AUDIO_EXT.includes(e)) return "audio";
  if (t.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(e)) return "image";
  if (e === "pdf" || t === "application/pdf") return "pdf";
  if (e === "docx") return "docx";
  if (e === "rtf" || t === "text/rtf" || t === "application/rtf") return "rtf";
  if (["pages", "doc", "key", "numbers", "xls", "xlsx", "ppt", "pptx", "zip"].includes(e)) return "unsupported";
  return "text";
}
let audioChain = Promise.resolve();
async function extract(s, D, redraw) {
  const set = (o) => { Object.assign(s, o); if (!s.cancelled) redraw(); };
  try {
    const k = await sniffKind(s.file);
    if (k !== s.kind) set({ kind: k });
    if (s.kind === "audio") {
      set({ stage: "Waiting for the previous recording" });
      // one recording at a time: transcription is heavy
      const run = audioChain.then(() => s.cancelled ? null : transcribeFile(s, set, D.language));
      audioChain = run.catch(() => {});
      await run;
      return;
    }
    set({ status: "working", stage: "Reading", progress: 0.3 });
    let text = "";
    if (s.kind === "text") text = cleanCaptions(await s.file.text(), EXT(s.file.name));
    else if (s.kind === "rtf") text = rtfToText(await s.file.text());
    else if (s.kind === "docx") text = await docxText(s.file);
    else if (s.kind === "pdf") text = await pdfText(s.file, (p) => set({ progress: p }));
    else if (s.kind === "image") text = await imageText(s.file, set);
    else throw new Error("This file type can't be read here. Export it as PDF, DOCX or TXT, or paste the text.");
    text = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) throw new Error("No readable text found in this file.");
    set({ status: "ready", text, progress: 1 });
  } catch (e) {
    console.error(e);
    set({ status: "error", error: e?.message || "Couldn't read this file." });
  }
}
function cleanCaptions(t, ext) {
  if (ext !== "vtt" && ext !== "srt" && !/^WEBVTT/.test(t)) return t;
  const out = [];
  for (const block of t.replace(/\r/g, "").split(/\n\n+/)) {
    const lines = block.split("\n").filter((l) => l.trim() && !/^WEBVTT/.test(l) && !/^NOTE\b/.test(l) && !/^\d+$/.test(l.trim()));
    const ts = lines.findIndex((l) => l.includes("-->"));
    let stamp = "";
    if (ts >= 0) { const m = lines[ts].match(/(\d{1,2}:)?(\d{1,2}):(\d{2})/); if (m) stamp = "[" + (m[1] ? m[1] : "") + m[2] + ":" + m[3] + "] "; lines.splice(ts, 1); }
    if (lines.length) out.push(stamp + lines.join(" ").replace(/<[^>]+>/g, ""));
  }
  return out.join("\n");
}
function rtfToText(rtf) {
  return rtf.replace(/\\par[d]?/g, "\n").replace(/\\line/g, "\n").replace(/\\'[0-9a-f]{2}/gi, "")
    .replace(/\{\\\*[^{}]*\}/g, "").replace(/\{\\(fonttbl|colortbl|stylesheet|info)[\s\S]*?\}\}?/g, "")
    .replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "").replace(/\n[ \t]+/g, "\n");
}
const loaded = {};
function loadScript(src) {
  return loaded[src] ||= new Promise((res, rej) => { const el = document.createElement("script"); el.src = src; el.onload = res; el.onerror = () => rej(new Error("Couldn't load the file reader. Check your connection.")); document.head.append(el); });
}
async function docxText(file) {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js");
  const r = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return r.value;
}
async function pdfText(file, onP) {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"); // runs in-page (fake worker)
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    let line = "", out = [];
    for (const it of c.items) { line += it.str; if (it.hasEOL) { out.push(line); line = ""; } }
    if (line) out.push(line);
    pages.push(out.join("\n"));
    onP(i / pdf.numPages);
  }
  return pages.join("\n\n");
}
async function imageText(file, set) {
  if (!S.sample) throw new Error("Reading photos of notes needs Claude. Open this page in Claude.");
  const lim = await S.sample.limits().catch(() => null);
  if (!lim?.images) throw new Error("Photos can't be read in this view. Type or paste these notes instead.");
  let blob = file;
  if (!lim.images.mediaTypes.includes(file.type)) blob = await toJpeg(file);
  set({ stage: "Reading the note with Claude", progress: 0.5 });
  const { text } = await S.sample(
    "This image is a photo or screenshot of notes taken during a business interview (handwritten notes, a whiteboard, a printed page, or a phone screenshot). " +
    "Transcribe ALL of the text exactly as written, preserving lists, headings, arrows and numbers. Where a word is illegible write [illegible]. " +
    "If there are diagrams or sketches, describe them briefly in [brackets]. Reply with only the transcription.", { images: [blob], modelTier: "default" });
  return text;
}
async function toJpeg(file) {
  const bmp = await createImageBitmap(file).catch(() => { throw new Error("This image format can't be opened in this browser. Save it as JPG or PNG."); });
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  return await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
}

// ---------- audio transcription (Whisper, in-browser) ----------
// Browser decoder first (fast, handles AAC voice memos everywhere); anything it rejects, such as
// Lossless (ALAC) memos in Chrome, CAF or AMR, goes through ffmpeg in a throwaway worker.
async function decodeAudio(file, onConvert) {
  let ab = null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx;
    try { ctx = new AC({ sampleRate: 16000 }); } catch { ctx = new AC(); }
    try { ab = await ctx.decodeAudioData(await file.arrayBuffer()); } finally { ctx.close?.(); }
  } catch { ab = null; }
  if (!ab || !ab.length) return convertWithFfmpeg(file, onConvert);
  let mono = ab.getChannelData(0);
  if (ab.numberOfChannels > 1) {
    const out = new Float32Array(ab.length);
    for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / ab.numberOfChannels; }
    mono = out;
  }
  if (ab.sampleRate !== 16000) {
    const off = new OfflineAudioContext(1, Math.ceil(ab.duration * 16000), 16000);
    const b = off.createBuffer(1, mono.length, ab.sampleRate); b.copyToChannel(mono, 0);
    const src = off.createBufferSource(); src.buffer = b; src.connect(off.destination); src.start();
    mono = (await off.startRendering()).getChannelData(0);
  }
  return mono;
}
const BASE = new URL(".", location.href).href;
const FFMPEG_SRC = `
const BASE = ${JSON.stringify(BASE)};
const PARTS = [0, 1, 2].map((i) => BASE + "vendor/ffmpeg-core.part" + i + ".wasm"), SIZE = 32232419;
onmessage = async ({ data: { buf } }) => {
  try {
    const wasm = new Uint8Array(SIZE); let off = 0;
    for (const u of PARTS) {
      const r = await fetch(u); if (!r.ok) throw new Error("Missing converter file (" + r.status + ")");
      const rd = r.body.getReader();
      for (;;) { const { done, value } = await rd.read(); if (done) break; wasm.set(value, off); off += value.length; postMessage({ type: "loading", loaded: off, total: SIZE }); }
    }
    const { default: createFFmpegCore } = await import(BASE + "vendor/ffmpeg-core.js");
    const core = await createFFmpegCore({ wasmBinary: wasm.buffer });
    let duration = 0;
    core.setLogger(({ message }) => { const m = /Duration: (\\d+):(\\d+):([\\d.]+)/.exec(message); if (m) duration = +m[1] * 3600 + +m[2] * 60 + +m[3]; });
    core.setProgress(({ time }) => { if (duration) postMessage({ type: "progress", p: Math.min(1, time / 1e6 / duration) }); });
    core.FS.writeFile("in", new Uint8Array(buf)); buf = null;
    const ret = core.exec("-i", "in", "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "out.raw");
    if (ret !== 0) throw new Error("unreadable");
    const raw = core.FS.readFile("out.raw");
    const out = new Float32Array(raw.byteLength / 4); new Uint8Array(out.buffer).set(raw);
    postMessage({ type: "done", audio: out }, [out.buffer]);
  } catch (e) { postMessage({ type: "error", message: String(e && e.message || e) }); }
};
`;
async function convertWithFfmpeg(file, onConvert) {
  const buf = await file.arrayBuffer();
  const url = URL.createObjectURL(new Blob([FFMPEG_SRC], { type: "text/javascript" }));
  const w = new Worker(url, { type: "module" });
  try {
    return await new Promise((resolve, reject) => {
      w.onmessage = ({ data: m }) => {
        if (m.type === "loading") onConvert?.(`Loading the audio converter · ${Math.round(m.loaded / 1e6)} of ${Math.round(m.total / 1e6)} MB`, 0.1 * m.loaded / m.total);
        else if (m.type === "progress") onConvert?.(`Converting audio · ${Math.round(m.p * 100)}%`, 0.1 + 0.05 * m.p);
        else if (m.type === "done") resolve(m.audio);
        else reject(new Error(m.message));
      };
      w.onerror = () => reject(new Error("converter failed to start"));
      onConvert?.("Converting audio format", 0.03);
      w.postMessage({ buf }, [buf]);
    });
  } catch (e) {
    console.error("ffmpeg", e);
    throw new Error("This file has no audio this page can read. Re-save it as M4A or MP3, or paste the transcript.");
  } finally { w.terminate(); URL.revokeObjectURL(url); }
}
const WORKER_SRC = `
const BASE = ${JSON.stringify(BASE)};
const HF = "https://huggingface.co/onnx-community/whisper-base/resolve/main/";
const M = BASE + "models/whisper-base/";
const BIG = {
  "onnx/encoder_model_quantized.onnx": { parts: ["encoder.part0.wasm", "encoder.part1.wasm"].map((p) => M + p), size: 23201314 },
  "onnx/decoder_model_merged_quantized.onnx": { parts: [0, 1, 2, 3, 4].map((i) => M + "decoder.part" + i + ".wasm"), size: 53693315 },
};
const SMALL = new Set(["config.json", "generation_config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json"]);
const WASM = BASE + "vendor/ort-wasm-simd-threaded.jsep.wasm";
const WASM_PARTS = { parts: [BASE + "vendor/ort-wasm.part0.wasm", BASE + "vendor/ort-wasm.part1.wasm"], size: 21596019 };
const realFetch = self.fetch.bind(self);
function stitched(spec, type) {
  const body = new ReadableStream({ async start(c) {
    try {
      for (const u of spec.parts) {
        const r = await realFetch(u);
        if (!r.ok) throw new Error("Missing model file " + u + " (" + r.status + ")");
        const rd = r.body.getReader();
        for (;;) { const { done, value } = await rd.read(); if (done) break; c.enqueue(value); }
      }
      c.close();
    } catch (e) { c.error(e); }
  } });
  return new Response(body, { status: 200, headers: { "content-type": type, "content-length": String(spec.size) } });
}
self.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(HF)) {
    const f = url.slice(HF.length).split("?")[0];
    if (BIG[f]) return stitched(BIG[f], "application/octet-stream");
    if (SMALL.has(f)) return realFetch(M + f);
    return new Response("", { status: 404 });
  }
  if (url.split("?")[0] === WASM) return stitched(WASM_PARTS, "application/wasm");
  return realFetch(input, init);
};
let asr = null;
async function load() {
  if (asr) return asr;
  const T = await import(BASE + "vendor/transformers.min.js");
  T.env.allowLocalModels = false;
  T.env.backends.onnx.wasm.wasmPaths = { mjs: BASE + "vendor/ort-wasm-simd-threaded.jsep.mjs", wasm: WASM };
  T.env.backends.onnx.wasm.numThreads = 1;
  T.env.backends.onnx.wasm.proxy = false;
  const seen = {};
  asr = await T.pipeline("automatic-speech-recognition", "onnx-community/whisper-base", {
    device: "wasm", dtype: "q8",
    progress_callback: (p) => {
      if (p.status === "progress" && p.total) { seen[p.file] = [p.loaded, p.total]; }
      if (p.status === "done" && seen[p.file]) seen[p.file][0] = seen[p.file][1];
      let l = 0, t = 0; for (const [a, b] of Object.values(seen)) { l += a; t += b; }
      if (t) postMessage({ type: "loading", loaded: l, total: Math.max(t, 77e6) });
    },
  });
  return asr;
}
const SR = 16000;
function cuts(a, block) {
  // split long audio at the quietest moment near each block boundary so words aren't cut in half
  const out = [0];
  let pos = 0;
  while (a.length - pos > block * 1.25) {
    const target = pos + block, lo = target - 6 * SR, hi = Math.min(a.length, target + 6 * SR), win = SR / 20;
    let best = target, bestE = Infinity;
    for (let s = lo; s + win < hi; s += win) { let e = 0; for (let i = s; i < s + win; i += 4) e += a[i] * a[i]; if (e < bestE) { bestE = e; best = s + win / 2; } }
    out.push(best); pos = best;
  }
  out.push(a.length);
  return out;
}
const clock = (s) => { s = Math.floor(s); const m = Math.floor(s / 60); return (m >= 60 ? Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0") : m) + ":" + String(s % 60).padStart(2, "0"); };
onmessage = async (ev) => {
  const { id, audio, language } = ev.data;
  try {
    const run = await load();
    postMessage({ type: "ready", id });
    const bounds = cuts(audio, 90 * SR);
    const paras = []; let cur = null;
    for (let b = 0; b + 1 < bounds.length; b++) {
      const start = bounds[b], piece = audio.subarray(start, bounds[b + 1]);
      const res = await run(piece, { language, task: "transcribe", chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
      const chunks = res.chunks && res.chunks.length ? res.chunks : [{ text: res.text, timestamp: [0, piece.length / SR] }];
      for (const c of chunks) {
        const t = (c.text || "").trim(); if (!t) continue;
        const at = start / SR + (c.timestamp?.[0] ?? 0);
        const end = start / SR + (c.timestamp?.[1] ?? (c.timestamp?.[0] ?? 0) + 4);
        if (!cur || at - cur.at > 30 || cur.text.length > 600) { cur = { at, end, text: t, gap: cur ? Math.max(0, at - cur.end) : 0 }; paras.push(cur); }
        else { cur.text += " " + t; cur.end = end; }
      }
      postMessage({ type: "progress", id, done: bounds[b + 1], total: audio.length });
    }
    // Vocal cues per paragraph, measured from the audio itself and compared with this recording's own median.
    // They describe delivery (volume, pace, pauses), not emotions; the analysis decides what they might mean.
    for (const p of paras) {
      const a = Math.floor(p.at * SR), z = Math.min(audio.length, Math.max(a + SR / 2, Math.floor(p.end * SR)));
      let e = 0, n = 0; for (let i = a; i < z; i += 8) { e += audio[i] * audio[i]; n++; }
      p.db = 10 * Math.log10(e / Math.max(1, n) + 1e-10);
      p.wpm = (p.text.split(/\s+/).length) / Math.max(1, (z - a) / SR) * 60;
    }
    const med = (k) => { const v = paras.map((p) => p[k]).sort((x, y) => x - y); return v[Math.floor(v.length / 2)] || 0; };
    const mDb = med("db"), mWpm = med("wpm");
    const cues = paras.map((p) => {
      const f = [];
      if (paras.length > 3) {
        if (p.db - mDb >= 4) f.push("louder"); else if (p.db - mDb <= -5) f.push("quieter");
        if (p.wpm >= mWpm * 1.25) f.push("faster"); else if (p.wpm <= mWpm * 0.75) f.push("slower");
      }
      if (p.gap >= 2.5) f.push("long pause before");
      return { at: Math.round(p.at), flags: f, db: Math.round((p.db - mDb) * 10) / 10, wpm: Math.round(p.wpm) };
    });
    postMessage({ type: "result", id, text: paras.map((p) => "[" + clock(p.at) + "] " + p.text).join("\\n\\n"), cues });
  } catch (e) {
    postMessage({ type: "error", id, message: String(e && e.message || e) });
  }
};
`;
const Whisper = {
  worker: null, jobs: new Map(), loadState: null,
  get() {
    if (this.worker) return this.worker;
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
    this.worker = new Worker(url, { type: "module" });
    this.worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === "loading") { this.loadState = m; for (const j of this.jobs.values()) j.onLoad?.(m); return; }
      const j = this.jobs.get(m.id); if (!j) return;
      if (m.type === "ready") j.onReady?.();
      else if (m.type === "progress") j.onProgress?.(m.done / m.total);
      else if (m.type === "result") { this.jobs.delete(m.id); j.resolve({ text: m.text, cues: m.cues || [] }); }
      else if (m.type === "error") { this.jobs.delete(m.id); j.reject(new Error(m.message)); }
    };
    this.worker.onerror = (e) => { console.error("worker", e); for (const j of this.jobs.values()) j.reject(new Error("The transcription engine couldn't start in this browser.")); this.jobs.clear(); this.worker = null; };
    return this.worker;
  },
  run(audio, language, hooks) {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      this.jobs.set(id, { resolve, reject, ...hooks });
      this.get().postMessage({ id, audio, language }, [audio.buffer]);
    });
  },
};
async function transcribeFile(s, set, language) {
  set({ status: "working", stage: "Decoding audio", progress: 0.02 });
  Awake.hold("t-" + s.uid);
  try { await transcribeAudio(s, set, language); } finally { Awake.release("t-" + s.uid); }
}
async function transcribeAudio(s, set, language) {
  const audio = await decodeAudio(s.file, (stage, progress) => set({ stage, progress }));
  const duration = audio.length / 16000;
  if (duration < 0.5) throw new Error("This recording is empty.");
  set({ duration, stage: Whisper.loadState ? "Starting transcription" : "Loading the transcription engine (first time only, about 100 MB)" });
  const t0 = performance.now();
  try {
    const { text, cues } = await Whisper.run(audio, language, {
      onLoad: (m) => set({ stage: `Loading the transcription engine · ${Math.round(m.loaded / 1e6)} of ${Math.round(m.total / 1e6)} MB`, progress: 0.05 + 0.15 * (m.loaded / m.total) }),
      onReady: () => set({ stage: `Transcribing ${fmtClock(duration)} of audio`, progress: 0.2 }),
      onProgress: (p) => {
        const el = (performance.now() - t0) / 1000, left = p > 0.02 ? el / p * (1 - p) : 0;
        set({ stage: `Transcribing · ${Math.round(p * 100)}%` + (left > 20 ? ` · about ${Math.ceil(left / 60)} min left` : ""), progress: 0.2 + 0.8 * p });
      },
    });
    if (!text.trim()) throw new Error("No speech was detected in this recording.");
    set({ status: "ready", text, cues, progress: 1 });
  } catch (e) {
    throw new Error(/couldn't start|WebAssembly|wasm|Worker|CompileError/i.test(e.message)
      ? "This browser couldn't run the transcription engine. Paste the iPhone transcript instead (Voice Memos › ••• › Copy Transcript)."
      : "Transcription failed: " + e.message);
  }
}

// Keep the phone screen on while audio is transcribed or Claude writes the report: iOS pauses a page
// (and its transcription) when the screen locks or the app goes to the background.
const Awake = {
  keys: new Set(), lock: null,
  async sync() {
    const want = this.keys.size > 0 && document.visibilityState === "visible";
    try {
      if (want && !this.lock && navigator.wakeLock) { this.lock = await navigator.wakeLock.request("screen"); this.lock.addEventListener?.("release", () => { this.lock = null; }); }
      else if (!want && this.lock) { const l = this.lock; this.lock = null; await l.release(); }
    } catch { this.lock = null; }
  },
  hold(k) { this.keys.add(k); this.sync(); },
  release(k) { this.keys.delete(k); this.sync(); },
};
document.addEventListener("visibilitychange", () => Awake.sync());
const IS_PHONE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

