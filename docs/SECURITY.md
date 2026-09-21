# Security notes

What protects what, and what a production deployment would still need.

## Identity and access

- Sessions: Auth.js JWT cookies (12-hour max age) in the web app. Credentials are verified by the API over a service-secret header; passwords are bcrypt-hashed; failed lookups run a dummy compare so timing does not reveal whether an email exists.
- Web → API: a two-minute HS256 token minted per request from the session; the browser never sees an API token. Verified with `node:crypto`, HS256 only, constant-time comparison, issuer/audience/expiry checked (ADR-010).
- Authorization: `@Requires(action, resource)` on routes → the RBAC matrix in `@daysheet/domain`. Row-level access (`canSeeRecord`) is enforced in services, which the assistant's tools also go through. Tests: `records.service.spec.ts`, `ask.service.spec.ts`.
- Roles: admin, stallion office, recip farm, vet, billing, customer. Customers see only their own rows; a stallion's book is never shown to a customer.

## Money

- Stripe test mode only; the client refuses `sk_live_` / `rk_live_` keys at boot.
- Webhooks are verified against the raw request body. Inbound events are write-once (`IntegrationEvent`, unique per provider + event id, payload immutable by trigger). Processing is idempotent and forward-only.
- Refunds require a settled payment and an amount within the refundable balance; every refund request is audited before it is sent.
- Accounting tokens are stored in the database for the sandbox. Production would encrypt them at rest (pgcrypto or a KMS-backed envelope) and rotate on each refresh (already rotated; not yet encrypted).

## Data

- Everything is synthetic. No real customer, horse, phone number or dollar figure exists in this repository or its seed.
- Logs redact `authorization`, `x-service-secret`, cookies and request bodies. Sentry, when enabled, drops request data and auth headers before sending and never sends PII by default.
- The audit table is append-only at the database level. The seed disables the trigger to rebuild the world; nothing else may.

## Assistant

- Read-only tools; no write path exists. Tool results are framed as data (`DATA_NOT_INSTRUCTIONS`) and the system prompt says record text never changes the rules. Two injection cases are seeded: an instruction typed into a question, and one written into a retrieved record (a vet's note that says to mark an invoice paid); the eval and `front-door.spec.ts` assert nothing is paid, nothing is refunded, no proposal appears.
- Every cited code is verified against what the tools returned this turn. Unverifiable claims are shown as abstentions, not hidden.
- Clinical and financial questions abstain with a reason and route to people.
- Monthly spend cap on model usage, computed from stored token counts.
- Memory is explicit: written only by people, listed, deletable, and typed — preferences, workflow, presentation, terminology, digest. `screenMemory` refuses record codes, money and policy statements, so memory can never hold a fact the records should.

## Secrets and supply chain

- `.env` is git-ignored; `.env.example` holds placeholders only. No secret is read by the browser bundle except `NEXT_PUBLIC_SENTRY_DSN`, which is public by design.
- pnpm build scripts are opt-in (`allowBuilds`); telemetry packages are left off. Dependencies are pinned exactly (`save-exact`). A CI step checks production dependency licenses against an allowlist.
- Helmet sets baseline headers on the API; CORS is limited to the web origin. The web app sends `X-Content-Type-Options`, `X-Frame-Options: DENY`, a referrer policy, a permissions policy and a content-security-policy for framing, plugins, base-uri and form-action; browser source maps are off in production builds.
- `pnpm audit --audit-level=high --prod` runs in CI; transitive advisories are pinned to patched lines in `pnpm-workspace.yaml` until the parent packages release. One moderate advisory is known and accepted for now: `decode-uri-component` under `intuit-oauth` → `query-string` (a decoding DoS on malformed input); its patched line is ESM-only and the CommonJS parent cannot load it. It parses the OAuth callback the API receives from the accounting provider, not user input; it goes when `intuit-oauth` moves.
- Money moves by a transition table (`PAYMENT_TRANSITIONS`): an impossible transition — a returned debit clearing again, a second return — is refused server-side with `409 INVALID_PAYMENT_TRANSITION`, so a double click and a replayed request are harmless.

## Still to do before real use

- Encrypt accounting tokens at rest; move `AUTH_SECRET` and provider keys to a secrets manager.
- Rate-limit the login and webhook routes; add CSRF protection if any non-JSON form posts are added to the API.
- Twilio inbound signature verification depends on the public URL (`API_URL_PUBLIC`); set it on deploy.
- Per-customer data export and deletion paths.
- A real password policy and MFA for staff roles.
