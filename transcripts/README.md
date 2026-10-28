# Starwell SI Transcripts

Starwell SI's interview workspace. The team uploads voice memos, notes and transcripts from conversations with business owners and staff. Each upload becomes an organized, annotated transcript with draft findings, key numbers and a source-citing assistant, filed under the client company it belongs to.

It runs as a [claude.ai artifact](https://claude.ai/artifact/8sr2RVsgg8pFsvVbBV42hm). Sign-in, shared storage and the AI analysis are provided by claude.ai, so there is no server to host.

## What it does

- **Companies.** Every memo, finding, number and task belongs to one client company. A switcher at the top left changes the active company.
- **Accounts.** Teammates (Bobby, Dan, RJ by default) sign in with their own Claude account and link it to their name once. The server only lets each person claim their own seat.
- **Upload anything.** Voice memos (M4A, iOS `.qta`, Lossless/ALAC, CAF, MP3, WAV, WebM/Opus, MOV/MP4), PDF, DOCX, RTF, TXT, VTT/SRT, photos of notes, or pasted text such as Apple's Voice Memos transcript.
- **In-browser transcription.** Audio is transcribed on the device with Whisper (base, quantized) through transformers.js and ONNX Runtime. Recordings are never uploaded. Formats the browser can't decode go through ffmpeg (wasm). Each paragraph gets measured delivery cues (louder, quieter, faster, slower, long pause), and very quiet stretches are flagged as "check audio".
- **Memo reader** with four tabs:
  - **Summary:** in-depth summary, how the meeting went, every topic, tone, people, next steps and open questions.
  - **Organized:** the cleaned transcript grouped by topic, with AI notes on the transcript (pain points, bottlenecks, emotion and tone, decisions, opportunities, facts, questions, quotes).
  - **Original:** the unchanged source text, with the notes' quotes underlined.
  - **Findings.**
- **Traceable findings.** Every quote a finding relies on is checked against the source text. A missing quote is flagged, and the finding is downgraded to "Unknown". Findings are drafts until an Editor accepts, rejects or asks for evidence (enforced by the server).
- **Ask Starwell.** A contextual assistant scoped to one memo or the whole company. Highlight text to get Ask · Explain · Owner impact. Answers are split into What this means / Why it matters / What may be missing / Next step, with each claim labeled reported, verified, hypothesis or unknown, and linked to its source passage. Retrieval is keyword-based (BM25) over the company's own transcripts only.
- **Key numbers, Diagnostics (Investigate next / Ready to test), Actions (tasks), comments and an activity feed.**
- **Look and feel.** Figtree variable font with tight tracking, a black pill top bar, white and #f2f2f2 surfaces, one cyan accent (#38c6ec), and a cyan band with a card on it for the sign-in screen and company overview. Light and dark themes.

## Repository layout

```
src/            page source, concatenated in this order by build.sh
  head.html       title, styles, app shell, helpers, state, routing, sidebar, search, tabs
  pipeline.js     file reading, audio decoding, ffmpeg fallback, Whisper worker, wake lock
  views.js        overview, memos, diagnostics, key numbers, actions
  reader.js       memo reader, new-memo flow, selection toolbar, Ask Starwell panel
  accounts.js     sign-in, team page, my memos
  tail.js         segmentation, analysis pipeline and prompts, quote checks, retrieval, export
app/            what gets published
  index.html      built page (run ./build.sh)
  vendor/         transformers.js, ONNX Runtime and ffmpeg core (wasm split into <12 MB parts)
  models/         Whisper base (quantized ONNX, split into <12 MB parts) and tokenizer files
test/
  e2e.test.js     end-to-end test in Chromium (about 60 checks)
  mock-runtime.js stand-in for the claude.ai runtime (db, user, sample, downloads)
  fixtures/       synthetic interview audio and notes (fictional company)
  cdn/            local copies of mammoth and pdf.js used by the test
artifact.json   the artifact URL and its declared capabilities and database rules
```

Large binaries are split because artifacts serve files of at most 15 MB each. The page stitches the parts back together in the browser.

## Build, test, publish

```bash
./build.sh                       # writes app/index.html and syntax-checks it
npm install && npm test          # runs the end-to-end test (needs Playwright's Chromium)
```

The test serves `app/` under a content security policy like the artifact's, swaps in `test/mock-runtime.js` for the claude.ai runtime, uploads real audio, PDF and text, and checks the full workflow. That covers sign-in, companies, the progress screen, notes, findings and quote checks, evidence links, the assistant, search, company isolation, reviews, tasks, errors and resume, a second teammate's upload, roles, and layouts at 1440, 1280, 768 and 390 px in light and dark.

The test's AI answers come from the stand-in, built from the actual transcript lines, so they don't measure real model quality.

To publish, publish `app/index.html` with its `app/vendor` and `app/models` files to the artifact URL in `artifact.json`, declaring the capabilities listed there. The Claude Code session that built it used the Artifact tool for this.

## Data model (artifact database)

| Collection | One document per | Notes |
|---|---|---|
| `companies` | client company | name, industry, profile |
| `interviews` | memo | `companyId`, uploader, dates, pipeline stages and progress |
| `interviews/{id}/parts` | memo part | `seg-*` source paragraphs, `notes-*` organized transcript and notes, `analysis` summary |
| `findings` | finding | evidence with quote-check result, hypotheses, queue, importance |
| `reviews` | finding review | Editors only (server rule) |
| `metrics` | stated figure | value, period, how it's known, source paragraph |
| `tasks`, `comments`, `events` | task, comment, activity entry | |
| `team` | linked account | each person can only write their own (server rule) |
| `settings/team` | team list | Editors only |

## Known limits

- **One access level per page.** Access is per artifact (Viewer, Contributor or Editor). Everyone with access sees every company, so company separation is a display boundary, not a security one.
- **No audio playback or speaker separation.** Recordings stay on the device that transcribed them.
- **Analysis runs in the uploader's browser** and uses their Claude account. Keep the tab open; a stopped run can be resumed without re-uploading.
- **Logo.** No logo asset was supplied, so the wordmark is plain text.
- **Speed.** Whisper base transcribes at roughly half real time on a typical laptop.

See `THIRD_PARTY_NOTICES.md` for bundled libraries and model weights.
