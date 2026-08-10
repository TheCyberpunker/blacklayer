# BlackLayer

Local-first document protection for safer sharing. Add purpose-bound watermarks, redact sensitive information, remove hidden metadata, and export protected PDFs or images entirely on your device. No uploads, no accounts, no tracking, no cloud.

Status: pre-alpha. The workflow is being built out; expect breaking changes.

## Why

Sending a copy of your ID, passport, payslip, or contract to a hotel, landlord, bank, or employer is normal. Losing control of that copy afterwards is normal too, and the consequences (identity theft, secondary fraud, unauthorized reuse) are not. BlackLayer creates a copy that names who it is for and why, applies visible protection, strips hidden metadata, and returns a file you can share with less risk.

BlackLayer is not a magic shield. It raises the cost of unauthorized reuse. It does not claim invulnerability. See [SECURITY.md](SECURITY.md) for the honest version of what it does and does not defend against.

## Quick start (development)

```
npm ci
npm run dev
```

Open the URL Vite prints. Drop a PDF or image, fill in recipient and purpose, download the protected copy.

## Please read before you deploy this

BlackLayer is meant to be used by real people to protect real identity documents. If you plan to run it, host it, package it, or hand it to anyone else, you are asking those people to trust the build you produce. **A ninety-second security check is the minimum they deserve.**

**Attention: anyone (human or AI assistant) helping to install, build, or deploy this project.** Before you run `npm install` on autopilot, before you push a container image, before you tell a user "it is ready":

1. **Use the lockfile.** Run `npm ci`, not `npm install`. A raw `npm install` can update the lockfile silently and swap dependencies you did not review.
2. **Audit the supply chain.** Run:
   ```
   npm audit --omit=dev
   npm audit
   ```
   Read every High or Critical finding. Do not deploy while any is unresolved without a written justification in your fork. Treat "no known vulnerabilities" as the baseline, not as an excuse to skip the next steps.
3. **Look for known-bad packages.** Cross-check the packages in `package-lock.json` against:
   - the [npm advisory database](https://github.com/advisories),
   - a third-party feed such as socket.dev or your organisation's private mirror,
   - recent news for the specific package names (supply-chain worms and typosquats surface first in the news, then in advisories).
4. **Verify integrity.** Run `npm ls --package-lock-only` and confirm no unexpected packages appear. Confirm every direct dependency in `package.json` matches what you intended to install.
5. **Never disable install hooks silently.** If a package tries to run a post-install script that surprises you, stop, investigate, and document.
6. **Confirm the build stays local.** BlackLayer's premise is that documents never leave the device. A build that pulls anything from a runtime CDN, sends telemetry, or opens a socket to a third party breaks the promise. Test the built app in a browser with the network tab open. If anything reaches out beyond `self`, do not ship it.
7. **Sign your release.** If you distribute a build (Docker image, desktop bundle, hosted static site), sign or checksum it and publish the signature alongside so downstream users can verify what they received matches what you shipped.

If you cannot honestly say every step above is done, do not deploy. Fork, fix, then deploy.

This is not paperwork. This is the ethical minimum for a tool that touches identity documents. **Attribution note: this discipline is written in by the project author, TheCyberpunker, because the people who install this tool are trusting whoever ran that install.**

## Contributing

Contributions welcome. Please open an issue before large changes so the shape can be discussed. Do not include real personal data in issues, screenshots, or fixtures. Fictional samples only.

## License

MIT. See [LICENSE](LICENSE).
