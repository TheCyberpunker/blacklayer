# BlackLayer

Local-first document protection for safer sharing. Add purpose-bound watermarks, redact sensitive areas, remove hidden metadata, and export protected PDFs or images entirely on your device. No uploads, no accounts, no cloud.

Status: pre-alpha. The workflow is being built out and things will change.

## Why this exists

I regularly need to send copies of my ID, passport, payslip, or a contract to a hotel, landlord, bank, or employer. Once the copy is out of my hands I have no control over how long it lives on someone else's server or what it gets reused for. There are good open-source tools for pieces of this problem, but I wanted one local tool that puts the whole workflow together on my own machine, in a shape I can maintain and trust.

## Credits and inspiration

BlackLayer is a fresh implementation, not a fork. It builds on ideas explored by these open-source projects; each is worth a look on its own:

- [PDF-Protect](https://github.com/ToritoIO/PDF-Protect) — client-side PDF watermarking with a clean, focused UI.
- [SafeID / datosargentinos.com](https://github.com/Xyborg/datosargentinos.com) — local Argentine DNI redaction, three-step workflow, sensible service-worker posture.
- [Firemark](https://github.com/Vitruves/firemark) — a rich native watermark engine with security patterns.
- [SaferLayer](https://saferlayer.com) — the general idea of "layered, contextual document protection" as a category.

None of the code in this repository is copied from those projects. Where a technique or UX pattern was directly informed by one of them, it's noted in the source. This is not an attempt to reproduce any of them; it's my own local-first take on the same problem.

## How this is built

BlackLayer is developed with the help of AI models. I use them as a fast, unopinionated pair for the surface-level scaffolding — file layout, boilerplate, string plumbing, config wiring — so I can spend my own attention on the ideas that actually matter for a privacy tool: what the workflow should feel like, what threat model to defend against, what claims we can honestly make, and what to explicitly refuse to promise. Every design decision, every threat-model call, every "no, we won't ship that" is a human one. AI helps me get to a working iteration faster; it does not decide what BlackLayer is.

## What BlackLayer actually does

- Adds a repeated, purpose-bound watermark ("COPY FOR X · FOR Y ONLY · date") over the document.
- Uses a per-document cryptographic random seed to vary watermark position, rotation, size, and opacity across tiles. Two exported copies of the same document look subtly different, so tools that expect a regular grid have less to lock onto.
- Optionally adds a crosshatch security pattern and a border frame at higher protection levels.
- Rasterizes any PDF page that has manual redactions. Redacted regions are destroyed at the pixel level rather than covered by an overlay that could be lifted. Redactions can be solid, blur, or pixelate (solid is safest).
- Neutralizes PDF metadata (author, subject, keywords, creation and modification dates), drops the XMP metadata stream so edit history, application traces, and stable document IDs do not survive, and strips image metadata by canvas re-encode.
- Detects a digital signature in the source PDF and warns before creating a copy that would invalidate it.
- Auto-detects common document types (DNI, passport, contract, payslip, invoice, financial) from filename, PDF text, and page dimensions, then recommends a protection level and suggests context-appropriate purposes.
- Saves the recipient + purpose + level combos you use often as local presets. Nothing leaves the browser. A "Delete all local settings" action wipes them along with your theme and language preferences.

## What BlackLayer explicitly does not promise

- **It is not "unremovable".** A determined attacker with modern AI-driven inpainting, careful manual editing, or unlimited time can remove or reconstruct protected content. BlackLayer raises the cost; it does not make the cost infinite.
- **It cannot stop recapture.** Screenshots, photos of the screen, or a camera pointed at a printed copy will always work.
- **It cannot control what the recipient does.** Once you hand a copy to someone, its downstream use is out of scope.
- **It is an open-source tool provided as-is.** See the [MIT LICENSE](LICENSE). If you deploy or redistribute a build, that build is your responsibility.

## Quick start (development)

```
npm ci
npm run dev
```

Then open the URL Vite prints. Drop a PDF or image, fill in recipient and purpose, download the protected copy.

## Docker

A `Dockerfile` and a `compose.yaml` are included. The image is a multi-stage build: `node:20-alpine` builds the static assets, then `nginx:1.27-alpine` serves them as a non-root user on port 8080. The runtime container is read-only with dropped capabilities.

```
docker compose up -d --build
```

Then open http://localhost:8080.

To stop and remove:

```
docker compose down
```

The nginx config in [nginx.conf](nginx.conf) enforces the same Content-Security-Policy as the app's `<meta>` tag, sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and a `Permissions-Policy` that disables camera, microphone, geolocation, and interest-cohort. If you host BlackLayer behind a proxy that rewrites headers, verify the CSP still reaches the browser.

## Roadmap

Rough shape of what is planned. Nothing here is a commitment; priorities move as the tool gets used against real documents.

**Near term**

- Local OCR for image documents so photos of IDs, passports, and driving licences get the same content-based detection PDFs already do. First pass will target Spanish and English via a bundled, offline engine.
- First-run onboarding for people who land on the app cold.
- Batch protection of multiple files with a single recipient / purpose combo.

**Later research**

- Broader-language, higher-accuracy local OCR and vision models running entirely on the user's hardware to preserve document privacy. Candidates I want to evaluate:
  - PaddleOCR by Baidu, an open-source OCR that handles Chinese text well.
  - Lightweight document parsers along the lines of Unlimited-OCR / Qianfan-OCR (baidu/Qianfan-OCR).
  - Vision-language models such as Qwen2-VL for local extraction and layout understanding.

  Anything integrated here must run fully offline and never send document contents to a third-party service. The goal is stronger detection and, eventually, safer field-level auto-hiding without weakening the local-first guarantee.

- Tauri desktop packaging so the app installs as a native application on Windows, Linux, and macOS.

**Not on the roadmap**

- Server-side processing.
- Any feature that requires a user account.
- Any feature that transmits document contents to a third party.

## Contributing

Contributions welcome. Please open an issue before large changes so the shape can be discussed. Do not include real personal data in issues, screenshots, or fixtures. Fictional samples only.

## License and attributions

MIT. See [LICENSE](LICENSE).

Third-party runtime libraries and bundled fonts are attributed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
