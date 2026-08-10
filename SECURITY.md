# Security Policy

BlackLayer processes personal identity documents. Security and privacy are the point of the project, not a checkbox at the end.

## Supported versions

Pre-alpha. No release line is supported yet. Once a v0.1 exists, this section will list the versions receiving security updates.

## Reporting a vulnerability

If you believe you have found a security issue, please report it privately. Preferred channel: open a private security advisory on the repository's GitHub Security tab. Please do not open a public issue for security matters.

Include, if you can:

- affected version or commit,
- reproduction steps,
- observed behaviour,
- expected behaviour,
- impact you believe the issue has.

We aim to acknowledge reports within seven days. Fix timelines depend on severity and complexity.

## What BlackLayer defends against, and what it does not

BlackLayer aims to make unauthorized reuse of shared documents harder and to prevent the application itself from becoming a leakage channel. It does not claim to make protected content impossible to remove.

**Reduced by BlackLayer:**

- Silent reuse of a shared copy for a different purpose. Watermarks bind the copy to a stated recipient and purpose, so reuse becomes visibly suspicious.
- Casual watermark removal. Recommended and Maximum protection levels flatten the output; there is no annotation layer to delete.
- Hidden metadata leakage. Author, GPS, device model, and similar fields are stripped or neutralized by default at higher protection levels.
- Redaction that only visually covers underlying PDF text. Redacted regions rasterize the affected page before export.
- Network egress by the application. There is no server side. The runtime CSP restricts network access, and a network-audit test in CI (planned) will fail the build on regressions.

**Explicitly not defended against:**

- Screenshots, photographs, and recaptures of visible content.
- AI-driven inpainting or manual retouching that reconstructs covered regions given sufficient effort.
- Reuse by the intended recipient after the copy is in their hands.
- Malware, keyloggers, or a compromised operating system on the user's device.
- Compromised hosting or distribution of the BlackLayer build itself. See "Supply-chain hygiene" below.

## Supply-chain hygiene (please read before deploying)

BlackLayer is only as safe as the build the user runs. The safest source code in the world is unsafe if it ships with a compromised dependency. Anyone preparing a build, image, or hosted deploy of this project is asked to observe the following minimum.

Order matters. Do these before running the app anywhere users will see it.

1. **Lockfile-only install.** Use `npm ci` for any build you plan to distribute. `npm install` can silently mutate the lockfile.
2. **Audit for known vulnerabilities.** Run:
   ```
   npm audit --omit=dev
   npm audit
   ```
   Any High or Critical finding blocks release unless you have a written justification in your fork.
3. **Verify what you resolved.** Run `npm ls --package-lock-only` and confirm the tree matches what you reviewed.
4. **Cross-check against advisories.** Compare direct and notable transitive dependency names against:
   - the npm advisory database (https://github.com/advisories),
   - a third-party feed such as socket.dev,
   - recent news for the specific package names (supply-chain worms usually break in news before the advisories catch up).
5. **Install-script review.** If any dependency wants to run a post-install script that surprises you, stop and investigate. Do not silence the warning; understand it.
6. **Runtime egress check.** Open the built app in a browser (or in the Docker image) with the network tab visible. Load a document. Trigger the whole workflow. If a request escapes `self` at any moment after the initial asset load, the build is not shippable.
7. **Sign or checksum the release.** Publish a signature or SHA-256 alongside any binary, container image, or bundle you distribute so downstream users can verify integrity.

If you cannot check every item, do not ship. Fork, fix, then ship.

This applies to human operators and to AI assistants running deployment steps on someone's behalf. The above list is written to be actionable by both. If an AI assistant is preparing a deploy and does not run these steps, ask it to. If it refuses or cannot, do not proceed.

## Privacy claims we make

- Documents are processed locally in your browser or on your device.
- No documents are uploaded to any server operated by this project.
- No analytics, telemetry, or third-party trackers are included.
- No account, login, or personal information is required to use BlackLayer.

These claims are technical, not marketing. If you find a code path that breaks any of them, please report it via the process above.

## Privacy claims we do not make

- We do not claim protection is impossible to remove.
- We do not claim your original document is safer than any other file on your device.
- We do not claim the recipient of a shared copy will honour its stated purpose.
- We do not claim to detect every hidden metadata field in every document format. Where a format's metadata cannot be reliably scrubbed, that limitation will be documented per format.

## Cryptographic material

BlackLayer does not manage keys, does not sign documents, and does not encrypt user documents at rest. Any randomness used internally (for example, per-document seeds for watermark layout) is generated using the platform's secure random source (`crypto.getRandomValues`) and never leaves the device.

## Contact

For non-security questions, please open a regular issue on the repository.
