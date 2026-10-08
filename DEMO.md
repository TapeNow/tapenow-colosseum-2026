# Four-minute review demo

Use only a non-sensitive sample. Do not connect wallets/providers or enter production credentials. No publication or transaction is necessary.

1. **0:00–1:00 — approachable workflow.** Start the local app, create a project with sample v1, and inspect its file list and SHA-256. Open the loopback preview. Explain that this local mode needs no cloud account or wallet. Hosted password preview is a distinct cloud flow; its real implementation is included and exercised with fixtures.
2. **1:00–2:00 — retain and recover.** Import sample v2, inspect the history, choose v1 and review a restore. Create a recovery candidate. Show that restoring files does not automatically switch an external live entry or roll back a database.
3. **2:00–3:00 — export and verification.** Download the archive, inspect `site/`, `release.json`, `keys.json`, and explain independent signing-key fingerprint trust. Run `npm run test:demo` for an automated local sample/import/preview/restore/export walkthrough with valid and tampered archive checks. Its trust anchor is a locally established test key; it is not a production or live-site attestation.
4. **3:00–4:00 — upstream ownership and retrieval.** If network access is available, open the previously published Base example `https://12-3-2.tapekit.org/` and its linked `payload.txt`. The prior session reported both loading; no independent hashes were checked. Treat a live failure honestly. Explain TapeOut container ownership, TapeKit retrieval independent of the TapeNow dashboard, and TapeNow's release workflow contribution. Do not claim current ownership, publisher identity or all-file integrity from a successful page load.

Before presenting, run the commands in README and record the export manifest hash. The actual UI must be checked in a working sandboxed browser; the preparation environment's Chromium sandbox was unavailable, so automated HTTP/module checks are not human click-through evidence. Never disable the browser sandbox to perform this demo.

For an archive, independently pin the signing-key fingerprint and then run:

```sh
node scripts/verify-release.mjs release.json keys.json <pinned-sha256-key-fingerprint> site
```

For current live bytes, independently retrieve every target file and compare its bytes/hash with a trusted manifest, recording chain, container, entry and time. An archive signature does not do this. Gateway uses conventional cloud snapshots, and multi-transaction chain updates are not atomic. No customer traction or independent human testing is asserted.
