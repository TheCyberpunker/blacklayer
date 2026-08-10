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

## What BlackLayer actually does

- Adds a repeated, purpose-bound watermark ("COPY FOR X · FOR Y ONLY · date") over the document.
- Uses a per-document cryptographic random seed to vary watermark position, rotation, size, and opacity across tiles. Two exported copies of the same document look subtly different, so tools that expect a regular grid have less to lock onto.
- Optionally adds a crosshatch security pattern and a border frame at higher protection levels.
- Rasterizes any PDF page that has manual redactions. Redacted regions are destroyed at the pixel level rather than covered by an overlay that could be lifted.
- Neutralizes PDF metadata (author, subject, keywords, creation and modification dates), and strips image metadata by canvas re-encode.
- Detects a digital signature in the source PDF and warns before creating a copy that would invalidate it.

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

The static build works from any HTTP server. A minimal setup:

```
npm ci
npm run build
```

Serve the `dist/` folder with a static container of your choice (nginx alpine, caddy, httpd). A ready-made Dockerfile is on the roadmap; contributions welcome.

## Contributing

Contributions welcome. Please open an issue before large changes so the shape can be discussed. Do not include real personal data in issues, screenshots, or fixtures. Fictional samples only.

## License

MIT. See [LICENSE](LICENSE).
