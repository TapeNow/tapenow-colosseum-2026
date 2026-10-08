# TapeNow — curated competition review copy

Prepared **2026-10-08**, review-package **revision 2**, from TapeNow **0.9.16**, source snapshot `07eefe8828e3215ea53694feff854c1ac9c66c4d` (reviewed product base `4fb1603124bdba4a0edc53a63f555e559390af55`). This curated review copy was published with owner approval on **2026-10-08**. It contains actual React workbench and Express implementation source, not just a tools SDK. It is **not the complete hosted service**, a production deployment kit, or a newly licensed open-source release.

[中文说明](README.zh-CN.md) · [Scope and exclusions](SCOPE.md) · [Contribution dates](CONTRIBUTIONS.md) · [Demo](DEMO.md) · [Validation](VALIDATION.md) · [Rights and attribution](NOTICE.md)

## Run locally

Use Node.js 22.12+ and npm. Install dependencies from the committed lockfile; no production credentials, email account, wallet, Docker or Cloudflare account is required for this local path.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run build
npm test
npm run test:demo
npm start
```

Open `http://127.0.0.1:4311`. Local mode has no cloud login. The server binds to loopback and enforces its existing Host, Origin and session-token checks. Do not expose it as an internet service. `npm run dev` runs the development UI instead. Stop with Ctrl+C.

The app creates local `.data/` state and local-only signing/encryption keys on first run; none is included in this export. Tests create ephemeral local fixture keys and synthetic wallets. `DEWEB_DATA_DIR` can select another local data directory; `PORT` and `PREVIEW_PORT` default to 4311 and 4312. Do not add provider credentials for this rehearsal. Dependencies need registry access at installation; the sample/recovery/export demonstration uses only loopback afterward.

## What you can inspect and reproduce

| Capability | Included evidence and boundary |
|---|---|
| Approachable release workflow | Actual bilingual React UI and Express routes: create a sample project, import built static files, inspect manifest/SHA-256, preview locally, retain versions and review a release. |
| Recovery and portability | Restore an old release into a new candidate, leaving publication separate. Download the ZIP with `site/`, `release.json` and `keys.json`. `test:demo` checks both a valid archive and rejection after tampering. Restoring files does not restore database rows. |
| Private cloud preview | Actual `cloud/private-preview.mjs` and dependency modules; automated in-memory tests for password, expiry, headers and quota. The local UI offers loopback preview, **not the cloud password-preview panel**. |
| Chain/gateway integration | Source adapters, readback/release-policy tests and Gateway SDK tests. Public contract addresses and upstream source references are retained for review. These tests do not make real transactions or establish current chain ownership. |
| Hosted integrations | UI and required modules remain to keep local code authentic and runnable. Cloud sign-in, mail delivery, OAuth, public hosting and real provider calls are not configured or demonstrated by this export. |

The included public manual keeps the focused version/admission/troubleshooting translations, with a review-copy notice and historical screenshots omitted. Its hosted-service instructions and quotas describe the full product; the example admission policy is documentation data, not deployment configuration or proof of available seats. Legal pages are hosted-product reference material, not a new license grant for this source.

## Ownership, retrieval and verification

TapeOut supplies the upstream protocol/contracts, DeWeb containers and chip-based write authority. TapeKit supplies native retrieval. TapeNow contributes the creator-facing import, preview, release review, orchestration, recovery and export workflow. Upstream container ownership is not ownership of TapeNow's hosted infrastructure. Gateway serves conventional cloud snapshots; chain updates spanning transactions are not atomic.

Use `scripts/verify-release.mjs` with an independently trusted signing-key fingerprint to verify an archive's signature and file hashes. A key bundled with an archive cannot establish trust by itself. Archive verification is not proof of the bytes currently served by a live site. Independent live verification needs retrieval of every target file and comparison against a trusted manifest, with the chain/container/entry and time recorded.

## Provenance and integrity

Earliest retained product/build records are dated **September 25, 2026**. The **October 1 UTC Git import already contained 0.9.7**. The exact original start and a pre-September-14 baseline are unconfirmed. This package makes no claim that all functionality was created during a judging window. No independent human-user study or customer traction is asserted.

`EXPORT-SCOPE.json` is the explicit source-file allowlist with original hashes and adaptation status. `MANIFEST.json` hashes the complete curated payload, excluding only itself and its checksum. Run `npm run verify:manifest` in a clean exported tree, such as an extracted GitHub Download ZIP or `git archive`, before installing dependencies or running the app/tests. Do not run it in a clone containing `.git` or a tree with generated runtime artifacts. The accompanying archive checksum is supplied separately. Hashes show package integrity, not originality or an external audit.
