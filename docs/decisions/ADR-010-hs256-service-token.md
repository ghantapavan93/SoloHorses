# ADR-010 — Web → API identity: a short-lived HS256 token, verified with Node crypto

**Situation.** Sessions live in the web app (Auth.js JWT cookies). The API must know who is asking so it can enforce roles and row-level access, without the browser ever holding an API credential.

**Decision.** Each server-side API call mints a two-minute HS256 JWT (`sub`, `role`, `customerId`, `iss=daysheet-web`, `aud=daysheet-api`) signed with the shared `AUTH_SECRET`. The API verifies it with `node:crypto` — HS256 only, constant-time signature comparison, issuer, audience and expiry checked. The `jose` library is used only in the web app to sign; the API has no third-party JWT dependency (it also kept Jest, which cannot load ESM-only packages under CommonJS, out of the picture).

**Cost.** A shared secret couples the two apps; rotating it means restarting both. Acceptable for a two-service deployment.

**Would change it.** A third client (the mobile app). Then an asymmetric key (EdDSA or RS256) with a JWKS endpoint, so verifiers never hold the signing secret.
