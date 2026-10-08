# Proposed review scope — 2026-10-08, revision 2

Prepared locally for owner review. No upload, repository creation, permission change, push, PR, merge or deployment is part of this export phase.

The source allowlist was selected before copying. Every selected text file was scanned for internal identity/host strings, email addresses, credential signatures, URL destinations and long identifiers; flagged constants were reviewed. Relative module imports were traced to retain runnable dependencies. A gateway test that pulled in private backup operations was excluded rather than carrying the operations tree into the package.

| Included | Reason |
|---|---|
| `src/` | Actual workbench components, locale catalog, styles and interfaces; preserved rather than a simulated demo UI. |
| Selected `server/`, `shared/`, `cloud/` modules | Express app and its dependency closure; archive/release/chain logic; private-preview fixture coverage. No hosted Worker entry point. |
| 15 existing test files, two fixtures and export documentation checks | Import safety, HTTP isolation/persistence/recovery, release policies, private-preview i18n/quota, admission policy, chain adapters, roles and SDK behavior. |
| Selected `public/` and two existing scripts | Text reference manual, verifier and SDKs, safe SQL/workflow templates, core brand vectors and required fonts with notices. |
| Root build configuration and reduced npm lockfile | Reproducible local installation/build; removed cloud/operations-only dev dependencies and unavailable test scripts. |
| New README, demo, contribution record, manifest verifier and local rehearsal | Explain and test precisely this review copy. |

## Excluded by default

- `.git`, GitHub workflows and repository metadata/history: access and publication material, not required to review the local implementation.
- `.env*`, `.dev.vars*`, `.data`, existing keys, credentials, cookies, user/application state, installed dependencies, generated builds and raw test/browser evidence: secrets or runtime data do not belong in the submission. No such files were copied.
- `ops/`, backups, systemd/launchd, private monitoring, cloud production/development Wrangler configuration, database migrations, email digest/administration Worker entry and real-auth harness: unnecessary infrastructure details for this credential-free scope. Full production reproduction is intentionally unavailable.
- Internal root READMEs/HANDOFF/RELEASING, business/planning notes, QA logs, research imports, competitor bundles and source snapshots: internal context, personal/resource identifiers or unrelated third-party bulk material.
- Historical manual screenshots, marketing raster images and design exports: unnecessary binary surface with possible workspace/access information. Included WOFF2 files are font assets, with source hashes and OFL licenses; included SVGs are vector brand assets inspected as text.
- Existing broad public-export generator and its private denylist: intended for a different tools-only distribution, not this runnable review copy.

## Retained identifiers and terms

Public chain contract addresses, gas-oracle constants, documented OKX implementation source/hash, public upstream URLs and the already-public fee guide's transaction reference describe protocols or cited fee evidence. They are not service credentials or a claim of owner/tester identity. Public-key/file/font digests and pinned GitHub Actions revisions are necessary verification/provenance constants. `example.com`, `.test`, `.invalid`, loopback and synthetic UUID/email fixtures are intentional. Service credential *field names*, authorization logic, security checks and test secret-rejection examples remain; actual service credentials do not.

## Adaptations from the selected source

- `package.json` identifies the review copy, retains local scripts, adds manifest/demo checks and drops unavailable cloud/browser scripts and cloud/operations-only development dependencies; `package-lock.json` is reconciled.
- `index.html` omits nonessential raster metadata/icons that are not included.
- The seven retained instructional pages (`fees.html`, `gateway.html`, `manual/index.html`, `webmcp.html`, `integrations.html`, `beta-a.html`, `receipt-verification.html`) receive a consistent bilingual hosted-reference/review-copy notice. Legal/licensing pages and the OAuth callback are not described as having this notice. The manual renderer omits historical screenshots. Focused bilingual manual fixes remain.
- Receipt verification removes the production signing-key retention/non-rotation history, explains fresh local keys, and preserves general key rotation, retirement, revocation and independent trust guidance.
- `tests/manual.test.mjs` checks the safe `examples/admission-policy.json` documentation values instead of an excluded production configuration; it no longer claims to check the current production deployment.
- New documentation describes rights and evidence without copying internal records or changing application auth/security behavior. Source allowlist/hash metadata records every retained source file. Additional notice/license copies retain their original wording and are scoped in `NOTICE.md`.

## Not reproducible here

Hosted email/wallet sign-in, browser Turnstile validation, real email delivery, hosted multiuser workspaces, production database policies, DNS/TLS/public Gateway hosting, provider OAuth builds/deployments, onchain ownership or transactions, and production WebMCP availability. Existing UI links and adapters do not make these services configured. Cloud password preview is reproducible only through the included module tests, not the local UI. The package neither adds nor removes production features in the source branch.
