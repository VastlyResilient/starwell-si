# Third-party software and models

These are bundled in `app/` (or loaded from cdnjs at runtime) and keep their own licenses.

| Component | Version | Where | License |
|---|---|---|---|
| Transformers.js (`@huggingface/transformers`) | 3.7.5 | `app/vendor/transformers.min.js` | Apache-2.0 |
| ONNX Runtime Web | 1.22.0-dev.20250409 | `app/vendor/ort-wasm*` | MIT |
| ffmpeg.wasm core (`@ffmpeg/core`) | 0.12.10 | `app/vendor/ffmpeg-core*` | GPL-2.0-or-later |
| Whisper base, quantized ONNX (`onnx-community/whisper-base`) | | `app/models/whisper-base/` | Converted from `openai/whisper-base` (Apache-2.0). The ONNX conversion page states no separate license. |
| mammoth | 1.6.0 | loaded from cdnjs (copy in `test/cdn/`) | BSD-2-Clause |
| PDF.js (`pdfjs-dist`) | 3.11.174 | loaded from cdnjs (copy in `test/cdn/`) | Apache-2.0 |
| IBM Plex Sans / Plex Mono | | loaded from Google Fonts | SIL Open Font License 1.1 |

The ffmpeg core is GPL-2.0-or-later. Distributing this repository or the published page includes it, so its GPL terms apply to that component.

One deliberate change: in `transformers.min.js`, three literal U+FFFD characters inside string constants are written as the escape `�`, because the artifact host rejects raw replacement characters. The code behaves identically.
