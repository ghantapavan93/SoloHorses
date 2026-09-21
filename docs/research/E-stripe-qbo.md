# E — Stripe + QuickBooks Online integration architecture (SPADE OPS)

Research agent E. Verified 2026-09-16 against live sources: docs.stripe.com, stripe-node 22.6.2 tarball, npm registry, GitHub READMEs/CHANGELOGs, Intuit OpenID discovery document, BullMQ docs/source. Intuit's developer portal is JS-rendered (not fetchable); QBO limits/error codes were cross-checked across intuit-oauth CHANGELOG, Intuit community answers and three 2026 third-party guides (marked "3rd-party" below). Local machine facts (Redis 3.0.504 on :6379, Docker 29.6.1 daemon stopped, no winget/scoop, Node 22.14.0) were checked with the shell.

## 0. Pinned versions (npm `latest`, 2026-09-16)

| Package | Version | Notes |
|---|---|---|
| `stripe` (stripe-node) | **22.6.2** (2026-09-09), MIT, node>=18 | Pinned API version constant: **`'2026-08-26.dahlia'`** (`src/apiVersion.ts`). v22.0.0 (2026-04-02) made `Stripe` a true ES6 class (`new Stripe()` only), removed callbacks. v21 added `decimal_string` fields. |
| `@stripe/cli` | 1.50.11 (2026-09-10), MIT | Official CLI now on npm; docs quickstart uses `npm install -g @stripe/cli`. |
| `intuit-oauth` | **4.2.5** (2026-07-15), Apache-2.0, ships `types/index.d.ts` | 4.2.4 added `x_refresh_token_hard_expires_in` (5-year absolute cap) + `includeRefreshTokenHardExpiresIn` flag; axios ^1.18.1. |
| `node-quickbooks` | 2.0.50 (2026-03-29), ISC on npm, **no LICENSE file in repo**, callback API, OAuth1-era constructor, no TS types | Do not use. |
| `@nestjs/core` / `@nestjs/bullmq` | 12.0.3 / 12.0.0 (both 2026-08-27; 11.1.29 is the mature line) | `@nestjs/bullmq` peers: bullmq ^3–^6, nest ^10–^12. |
| `bullmq` | 6.3.6 (2026-09-14) | Hard minimum Redis **5.0.0** (`RedisConnection.minimumVersion`); `maxmemory-policy noeviction` required. |
| `@prisma/client` / `prisma` | 7.10.0 (`latest`); 8.0.0-rc.15 is `latest` for the CLI tag | Pin **7.10.0** for both; Prisma 7 needs `@prisma/adapter-pg` 7.10.0. |
| `next` | 16.3.5 | |
| `@golevelup/nestjs-stripe` | 3.0.0 (2026-03-18) peers `stripe ^20.4.1` | Peer-conflicts with stripe 22; hand-roll the webhook controller instead. |
| `pg-boss` | 12.33.0, MIT | Postgres-backed alternative to BullMQ (see Critic #4). |
| QBO Accounting API | v3, `minorversion=75` | Minor versions 1–74 ignored since 2025-08-01 (sandbox since 2025-02-10); always send `minorversion=75`. |
| Stripe events | snapshot events (v1) | Thin events for v1 resources are private preview; not needed. |

## 1. Stripe (sandbox / test mode)

### 1.1 Client
```ts
import Stripe from 'stripe';
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-08-26.dahlia', // typed as Stripe.LatestApiVersion; other literals are a TS error
  maxNetworkRetries: 2,            // SDK auto-adds idempotency keys to retried POSTs
  timeout: 20_000,
  appInfo: { name: 'spade-ops', version: '0.1.0' },
});
// Outbound idempotency: every POST gets a deterministic key derived from OUR entity id
await stripe.paymentIntents.create(params, { idempotencyKey: `pi-create-${invoice.id}-${attemptNo}` });
```
`Idempotency-Key` rules (docs.stripe.com/api/idempotent_requests): POST only, <=255 chars, first result (even a 500) replayed; keys pruned after >=24 h; same key + different params -> 400 `idempotency_error`.

### 1.2 Webhooks in NestJS (Express) — exact shape
```ts
// main.ts
const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true }); // requires built-in body parser (no bodyParser:false)
// integrations/stripe/stripe-webhook.controller.ts
@Controller('integrations/stripe')
export class StripeWebhookController {
  constructor(private readonly ingest: StripeIngestService, private readonly stripe: Stripe) {}
  @Post('webhook') @HttpCode(200)
  async handle(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') sig: string) {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(req.rawBody!, sig, process.env.STRIPE_WEBHOOK_SECRET!); // tolerance default 300 s
    } catch (err) { throw new BadRequestException(`Webhook signature verification failed: ${(err as Error).message}`); }
    const { duplicate } = await this.ingest.recordAndEnqueue(event);  // <50 ms; no business logic here
    return { received: true, duplicate };                            // 2xx fast; Stripe retries non-2xx for 3 days (live) / 3x over hours (sandbox)
  }
}
```
`Stripe.Event` is a discriminated union in v22 (`Stripe.PaymentIntentSucceededEvent`, `Stripe.InvoicePaymentPaidEvent`, ...), so `switch (event.type)` narrows `event.data.object`. Unit tests: `stripe.webhooks.generateTestHeaderString({ payload, secret })` signs synthetic payloads offline.

### 1.3 Events we consume and where our IDs live
| Event | `data.object` | Carries `metadata`? | Link key we use |
|---|---|---|---|
| `payment_intent.processing` (ACH submitted) / `.succeeded` / `.payment_failed` | PaymentIntent | yes | `metadata.spadeInvoiceId`, `metadata.spadePaymentId`; `customer` |
| `charge.refunded` (fires for partial refunds too), `refund.updated`/`refund.failed` (async ACH refunds) | Charge / Refund | Charge gets a one-time **snapshot copy** of PI metadata at creation | `charge.payment_intent`, `charge.amount_refunded` |
| `invoice.paid` (also out-of-band), `invoice.payment_failed`, `invoice_payment.paid` (per attached payment) | Invoice / InvoicePayment | Invoice: yes | `invoice.metadata.spadeInvoiceId`, `invoice.number`, `invoice.payments` |
| `checkout.session.completed` | Checkout.Session | yes; `payment_intent_data.metadata` propagates to the PI | `session.metadata`, `session.payment_intent` |
| `customer.created` | Customer | yes | `customer.metadata.spadeCustomerId` |

**Basil+ breaking fact (2025-03-31.basil, still true in dahlia):** `Invoice.payment_intent`, `Invoice.charge`, `PaymentIntent.invoice`, `Charge.invoice` are **removed**. Link PI <-> Invoice via `invoice.payments` (expand) or `GET /v1/invoice_payments?payment[type]=payment_intent&payment[payment_intent]=pi_...`. `stripe.invoices.attachPayment(id, { payment_intent })` (GA 2025-05-28.basil) attaches multiple/partial payments; `invoice_payment.paid` fires per payment; `invoice.paid` only when `amount_remaining` hits 0. Metadata limits: 50 keys, key<=40 chars, value<=500 chars; never sensitive data.

### 1.4 Idempotency / ordering (exact doc statements)
- At-least-once: "Webhook endpoints might occasionally receive the same event more than once... logging the event IDs you've processed". Also: two *distinct* Event objects can describe one change -> secondary dedupe on (`event.type`, `data.object.id`).
- Ordering: "Stripe doesn't guarantee the delivery of events in the order that they're generated"; `created` has 1-second resolution — never use it for ordering. Handle out-of-order by making handlers **state-monotonic**: `succeeded` may arrive before `processing`; each handler upserts by `pi` id and only moves status forward (`PENDING -> SUCCEEDED`, never back). When in doubt, re-fetch the object (`stripe.paymentIntents.retrieve`) and trust the API, not the payload.
- Retries: live mode up to 3 days with exponential backoff; sandbox "three times over the course of a few hours". Manual: Dashboard Resend (15 days), `stripe events resend <evt_id>` (30 days) — resends to the CLI's local listener; `--webhook-endpoint we_...` targets a registered endpoint.

### 1.5 Stripe CLI on Windows (this machine has neither winget nor scoop; Node 22 present)
```powershell
npm install -g @stripe/cli          # or: winget install Stripe.StripeCLI | scoop bucket add stripe https://github.com/stripe/scoop-stripe-cli.git; scoop install stripe | GitHub release zip + PATH
stripe login                        # pairing code -> browser; config: %USERPROFILE%\.config\stripe\config.toml
stripe listen --forward-to 127.0.0.1:3000/integrations/stripe/webhook --events payment_intent.succeeded,payment_intent.processing,payment_intent.payment_failed,charge.refunded,invoice.paid,invoice.payment_failed,invoice_payment.paid,checkout.session.completed,customer.created
#  -> "Ready! Your webhook signing secret is whsec_..." (stable across restarts). Use 127.0.0.1, not localhost, to dodge ::1 vs 0.0.0.0 mismatches.
stripe trigger payment_intent.succeeded --add "payment_intent:metadata[spadeInvoiceId]=inv_01J...,payment_intent:metadata[spadePaymentId]=pay_01J..."
stripe trigger invoice.paid          # fixture chain: customer -> invoiceitem -> invoice -> invoice_pay
stripe trigger charge.refunded; stripe trigger checkout.session.completed; stripe trigger customer.created
stripe events resend evt_1ABC...     # REPLAY: re-delivers the identical event id to the local listener -> proves dedupe
stripe fixtures .\stripe\fixtures\breeding-contract.json   # seed customers/invoices/PIs; ${name:field} references, ${.env:VAR|default}
```
Not triggerable: `payment_intent.processing` (not in `stripe trigger` list) — produce it with a fixture: `POST /v1/payment_intents {amount, currency:'usd', customer, payment_method:'pm_usBankAccount_success', payment_method_types:['us_bank_account'], confirm:true, mandate_data:{customer_acceptance:{type:'offline'}}}` -> `processing` then `succeeded` (test ACH settles instantly per docs; live = up to 4 business days). PowerShell: quote args containing `[ ]`.

### 1.6 Test values (docs.stripe.com/testing)
Cards: success `4242424242424242`; generic decline `4000000000000002`; insufficient funds `4000000000009995`; 3DS always `4000002760003184` (or `4000002500003155`); async refund pending->succeeded `4000000000007726`, refund fails `4000000000005126`; disputes `4000000000000259`. Tokens: `pm_card_visa`, `pm_card_visa_chargeDeclined`, `pm_card_authenticationRequired`.
ACH (routing `110000000`): success `000123456789` (`pm_usBankAccount_success`); insufficient funds `000222222227`; account closed `000111111113`; debit not authorized `000333333335`; stuck in `processing` forever `000000000009` (`pm_usBankAccount_processing`); dispute `000555555559`. Microdeposits: amounts `32`/`45` or descriptor `SM11AA` verify; `SM33CC` attempts exceeded; `SM44DD` timeout.

### 1.7 Which primitive: Invoices vs PaymentIntents vs Checkout
**Recommendation: Stripe Invoices (`collection_method: 'send_invoice'`) are the system-of-record primitive; PaymentIntents appear only as the payments attached to invoices; Checkout is not used.** Why: (1) an Invoice is the only Stripe object that natively mirrors a QBO Invoice (customer, line items, `number`, `due_date`, `hosted_invoice_url`, `amount_remaining`, dunning emails) -> a 1:1 mapping `Stripe Invoice = QBO Invoice`, `Stripe InvoicePayment = QBO Payment`; (2) the auction "settle by Monday" is literally an invoice with `due_date = next Monday`, `payment_settings.payment_method_types: ['us_bank_account','card']` (ACH matters for 5-figure horse settlements; card fees 2.9% vs ACH 0.8% capped); `invoice.overdue`/`invoice.will_be_due` events feed the settlement board; (3) fee is 0.4% per paid invoice (Starter) — immaterial. Deposit + balance on a breeding contract: **two invoices** (deposit invoice due at signing, balance invoice due before shipment/foal) — simplest, all Stripe-hosted, and how most equine bookkeepers already do it. Single-invoice partial payments via `attachPayment` are GA but need our own Payment Element UI for the deposit PI; keep as phase 2. Invoice *payment plans* (`/v1/payment_plans`, `amounts_due`) are **private preview** behind `Stripe-Version: 2026-08-26.preview` — do not build on them. Checkout Sessions have no due date/dunning and would create a second reconciliation path; raw PaymentIntents lack hosted collection.
**Out of scope, confirmed:** Stripe Connect (no marketplace payouts; seller payouts are a QBO Bill/BillPayment recorded from the bank, not Stripe money movement), Financial Connections beyond what the hosted ACH flow uses implicitly, Accounts v2, thin events, Payment Links, Customer Portal.

## 2. QuickBooks Online (sandbox)

### 2.1 Sandbox setup checklist (exact)
1. Create an Intuit Developer account at developer.intuit.com (free); sign in.
2. Dashboard -> **Create an app** -> "QuickBooks Online and Payments" -> name `SPADE OPS (dev)` -> scope **`com.intuit.quickbooks.accounting`** (add `openid profile email` only if you want the user's identity).
3. App -> **Development settings -> Keys & credentials**: copy *development* Client ID / Client Secret (development keys only reach sandbox companies).
4. Same page -> **Redirect URIs** -> add `http://localhost:3000/integrations/qbo/callback`. Rule: "All URI requests must use HTTPS" except localhost (http allowed); production keys refuse localhost/IP addresses and require exact-match https URIs.
5. Portal -> **API Docs & Tools -> Sandbox** -> *Add a sandbox company* -> country **US** (region-locked; US chart of accounts + USD). Note **Company ID = `realmId`**. Quota: up to 5 sandbox companies per account (some sources say 10; portal shows yours). "Go to company" opens the sandbox UI at app.sandbox.qbo.intuit.com. Sample data cannot be reset — delete + recreate the company (also the way to get a clean demo).
6. `.env`: `QBO_ENV=sandbox QBO_CLIENT_ID QBO_CLIENT_SECRET QBO_REDIRECT_URI QBO_MINOR_VERSION=75 QBO_WEBHOOK_VERIFIER= QBO_TOKEN_ENC_KEY=` (tokens encrypted at rest).
7. Endpoints (from the live discovery doc `https://developer.intuit.com/.well-known/openid_sandbox_configuration`): authorize `https://appcenter.intuit.com/connect/oauth2`, token `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`, revoke `https://developer.api.intuit.com/v2/oauth2/tokens/revoke`, API base `https://sandbox-quickbooks.api.intuit.com` (prod `https://quickbooks.api.intuit.com`).
8. Run `GET /integrations/qbo/connect` -> consent -> callback receives `code`, `state` (CSRF, must match), **`realmId`** -> exchange -> store `{access_token, refresh_token, expires_in: 3600, x_refresh_token_expires_in (~100 days idle), x_refresh_token_hard_expires_in (5 years), realmId}`.
9. Smoke test: `GET {base}/v3/company/{realmId}/companyinfo/{realmId}?minorversion=75` -> `CompanyInfo.CompanyName = "Sandbox Company_US_1"`.
10. Seed the company once (idempotently, by name lookup): Service Items `Stud Fee`, `Embryo/ICSI Services`, `Recipient Mare Lease`, `Veterinary Services`, `Auction Hammer Price`, `Buyer Premium`; a Bank account **`Stripe Clearing`** (`DepositToAccountRef` for every Stripe payment; Undeposited Funds otherwise); optional custom field `SPADE Ref` (Settings -> Account and settings -> Sales -> Sales form content; API exposes it as `CustomField[{DefinitionId:'1', Type:'StringType', StringValue}]`, value <= 31 chars).
11. (Optional) App -> Development settings -> **Webhooks**: needs a public HTTPS URL (ngrok); select Customer/Invoice/Payment; copy **Verifier Token**; enable the CloudEvents payload format. Skip for the prototype (see 2.5).

### 2.2 OAuth facts
Access token 1 h. Refresh token: valid 100 days of inactivity **and rotates roughly every 24 h** — "always use the refresh token returned in the most recent token_endpoint response"; the old one is force-expired. Policy change (sandbox 2025-12-10, production 2026-01-27): every refresh token now has a **5-year hard expiry** (`x_refresh_token_hard_expires_in`); the portal's **Reconnect URL** field is mandatory (link to our "Reconnect QuickBooks" page). On 401 (`AuthenticationFailed`, code 3200): refresh once and retry; on `invalid_grant` mark the connection DISCONNECTED, raise `OperationalException(TOKEN_EXPIRED)`, and show "Reconnect" in Money Integrity.

### 2.3 Library choice
**Use `intuit-oauth` for the OAuth dance only** (`authorizeUri`, `createToken`, `refreshUsingToken`, `revoke`, `isAccessTokenValid`) and **our own thin typed REST client on `fetch`** for `/v3` calls. Reasons: `node-quickbooks` is callback-only, OAuth1-era, no license file, no types; `intuit-oauth.makeApiCall` works but hides headers/status we need (`intuit_tid`, 429 body) and drags axios/winston. Serialize refreshes with a per-realm mutex (concurrent workers refreshing simultaneously will race on the rotating token).
```ts
const oauth = new OAuthClient({ clientId, clientSecret, environment: 'sandbox', redirectUri, logging: false });
const url = oauth.authorizeUri({ scope: [OAuthClient.scopes.Accounting], state: csrfToken });
const { token } = await oauth.createToken(callbackUrl);      // token.realmId, token.refresh_token, ...
const fresh = await oauth.refreshUsingToken(stored.refreshToken); // persist BOTH new tokens immediately
```

### 2.4 Accounting API v3 essentials (all with `?minorversion=75`, `Accept: application/json`)
- Query: `GET /v3/company/{realmId}/query?query=<url-encoded SQL>` e.g. `SELECT * FROM Customer WHERE DisplayName = 'Jane Rider (jane@x.com)'`, `SELECT * FROM Invoice WHERE DocNumber = 'SPD-INV-000123'`, `SELECT * FROM Payment WHERE PaymentRefNum = 'SPD-PAY-000045'`, `... WHERE Metadata.LastUpdatedTime > '2026-09-01T00:00:00-07:00' ORDERBY Metadata.LastUpdatedTime STARTPOSITION 1 MAXRESULTS 1000` (max 1000). Escape `'` as `\'`. `SELECT COUNT(*) FROM Payment` supported.
- Customer create: `{ DisplayName, GivenName, FamilyName, CompanyName, PrimaryEmailAddr:{Address}, PrimaryPhone:{FreeFormNumber}, BillAddr:{...} }`. DisplayName must be unique across Customer/Vendor/Employee and may not contain `:` -> use `"{name} ({email})"`; collision = **6240 Duplicate Name Exists**.
- Item (Service): `{ Name:'Stud Fee', Type:'Service', IncomeAccountRef:{value:<Income account Id>} }` (look up `SELECT * FROM Account WHERE AccountType = 'Income'`).
- Invoice: `{ CustomerRef:{value}, DocNumber:'SPD-INV-000123' (<=21 chars), TxnDate:'2026-09-16', DueDate:'2026-09-22', PrivateNote:'stripe:in_1S...', CustomField:[{DefinitionId:'1',Name:'SPADE Ref',Type:'StringType',StringValue:'inv_01J...'}], Line:[{DetailType:'SalesItemLineDetail', Amount:2500.00, Description:'Breeding contract deposit — Lot 12', SalesItemLineDetail:{ItemRef:{value:'19'}, Qty:1, UnitPrice:2500.00}}] }`. Duplicate DocNumber -> **6140** unless `?include=allowduplicatedocnum`; company pref `SalesFormsPrefs.CustomTxnNumbers` must be on for custom DocNumbers.
- Payment (applies to invoice): `{ CustomerRef:{value}, TotalAmt:2500.00, TxnDate, PaymentRefNum:'SPD-PAY-000045' (<=21 chars — a 27-char `pi_...` does NOT fit), PrivateNote:'stripe:pi_3S...', DepositToAccountRef:{value:<Stripe Clearing Id>}, PaymentMethodRef:{value}, Line:[{ Amount:2500.00, LinkedTxn:[{TxnId:'145', TxnType:'Invoice'}] }] }`. Partial payment = Amount < invoice balance; QBO keeps `Balance` on the Invoice.
- Refund: `RefundReceipt` (money leaves `Stripe Clearing` back to the customer; `Line` with SalesItemLineDetail, `DepositToAccountRef`) for Stripe refunds; `CreditMemo` only when credit is retained on account (CreditMemo applies via a Payment `Line.LinkedTxn TxnType:'CreditMemo'`).
- Update: full update requires `Id` + current **`SyncToken`** (optimistic lock; stale -> **5010 Stale Object Error**, re-read and retry); sparse update `{ "sparse": true, Id, SyncToken, ...changed fields }`. Void: `POST /invoice?operation=void`; delete: `?operation=delete` with `{Id, SyncToken}`.
- Errors: 400 `Fault.Error[{Message, Detail, code}]` — 6000 business validation, 6240 duplicate name, 6140 duplicate doc number, 610 object not found, 2500 invalid reference, 5010 stale object; 401 3200 auth; 403 scope/subscription; **429 `ThrottleExceeded` (code 3001)**; 5xx/5000-series internal -> retry. Every response has header **`intuit_tid`** — persist it on `SyncJob` for Intuit support tickets.
- Throttling (3rd-party + Intuit community, consistent): **500 requests/min per realm**, **10 concurrent per realm per app**, batch endpoint 30 ops/request and 120 batch requests/min (raised from 40 on 2025-10-31), some report endpoints 200/min. No `Retry-After` header: on 429 pause the realm for 60 s then exponential backoff (2 s -> 4 -> 8 ... cap 5 min, jitter). **No idempotency key exists in the QBO API** -> creates must be "query-by-natural-key then create" and single-flight per entity.

### 2.5 QBO webhooks (optional) — recommendation: use CDC polling instead
Webhooks moved to **CloudEvents v1.0** (legacy `eventNotifications` envelope sunset 2026-07-31): request body is a JSON **array** of `{specversion:'1.0', id, source, type:'qbo.payment.updated.v1', datacontenttype, time, intuitentityid, intuitaccountid (=realmId), data}`; operations create/update/delete/merge/void; must answer 200 within **3 s**; retries 10s,20s,30s,5m,20m,2h,4h,6h then every 6h; endpoint disabled after exhaustion. Verify: header `intuit-signature` = base64(HMAC-SHA256(verifierToken, rawBody)); compare with `timingSafeEqual` on the **raw** body (re-stringifying JSON breaks the hash). Needs a public HTTPS URL -> on Windows dev that means ngrok, and it adds nothing the reconciler can't get from **Change Data Capture**: `GET /v3/company/{realmId}/cdc?entities=Invoice,Payment,Customer&changedSince=<ISO>` (<=30-day lookback, <=1000 objects, full payloads). The `reconcile` job stores `lastCdcAt` and pulls changes — deterministic, replayable, demoable offline.

### 2.6 Sandbox constraints and the simulator boundary
Sandbox = a real QBO company (US, USD, sample data, 2-year validity per Intuit help; no reset, delete/recreate), same rate limits, real 6240/5010/6140 semantics, no real money, no bank feeds. Everything goes through one port: `AccountingProvider` (3.4). `QboHttpProvider` (real sandbox) and `QboSimulatorProvider` (Postgres-backed tables `sim_qbo_*` reproducing Ids, `SyncToken` increments, 5010 on stale token, 6240 on duplicate DisplayName, 610 on unknown Id, 429 fault injection via `QBO_SIM_FAULTS=429x2`, latency) share one contract-test suite (`AccountingProvider.contract.spec.ts`, run nightly/manually against the real sandbox, always against the simulator). `QBO_MODE=simulator|sandbox`. The demo runs on the simulator by default; the sandbox run is the credibility proof.

## 3. Reference architecture

### 3.1 Prisma schema (excerpt; money is integer cents, QBO decimals converted at the adapter edge)
```prisma
enum EventStatus { RECEIVED PROCESSED IGNORED FAILED }
enum SyncStatus  { PENDING SYNCED ERROR }
enum ReconState  { IN_SYNC PENDING MISMATCH ORPHANED }
model IntegrationEvent {  // immutable: payload never updated; only status/processedAt/error
  id String @id @default(cuid())  provider String  externalId String  type String
  payload Json  receivedAt DateTime @default(now())  processedAt DateTime?
  status EventStatus @default(RECEIVED)  error String?  objectId String? // data.object.id for secondary dedupe
  @@unique([provider, externalId])  @@index([provider, type, objectId])  @@index([status, receivedAt])
}
model Payment {
  id String @id @default(cuid())  customerId String  invoiceId String?  provider String @default("stripe")
  providerPaymentId String @unique   // pi_...
  providerChargeId String?  method String  // card | us_bank_account
  amountCents Int  refundedCents Int @default(0)  currency String @default("usd")
  status String  // PENDING | SUCCEEDED | FAILED | PARTIALLY_REFUNDED | REFUNDED
  sourceEventId String?  settledAt DateTime?  createdAt DateTime @default(now())  updatedAt DateTime @updatedAt
  allocations PaymentAllocation[]
}
model PaymentAllocation { id String @id @default(cuid())  paymentId String  invoiceId String  amountCents Int  kind String /* DEPOSIT|BALANCE|SETTLEMENT|REFUND */  payment Payment @relation(fields:[paymentId], references:[id])  @@unique([paymentId, invoiceId, kind]) }
model AccountingMapping {
  id String @id @default(cuid())  provider String @default("qbo")  realmId String
  entityType String /* CUSTOMER|INVOICE|PAYMENT|REFUND|ITEM */  entityId String
  externalId String  syncToken String?  lastSyncedAt DateTime?  status SyncStatus @default(PENDING)
  reconState ReconState @default(PENDING)  lastReconciledAt DateTime?  lastError String?
  @@unique([provider, realmId, entityType, entityId])  @@unique([provider, realmId, entityType, externalId])
}
model SyncJob { id String @id @default(cuid())  queue String  jobName String  jobId String @unique  entityType String  entityId String  attempts Int @default(0)  rateLimitHits Int @default(0)  status String /* QUEUED|ACTIVE|DONE|FAILED */  lastError String?  intuitTid String?  startedAt DateTime?  finishedAt DateTime?  createdAt DateTime @default(now()) }
model OperationalException { id String @id @default(cuid())  kind String /* AMOUNT_MISMATCH|ORPHANED_LOCAL|ORPHANED_QBO|SYNC_FAILED|TOKEN_EXPIRED|LINK_MISSING */  severity String  entityType String  entityId String  expected Json?  actual Json?  status String @default("OPEN")  resolution String?  resolvedById String?  resolvedAt DateTime?  createdAt DateTime @default(now()) }
model AuditEvent { id String @id @default(cuid())  actorId String  action String  entityType String  entityId String  before Json?  after Json?  at DateTime @default(now()) }
```

### 3.2 Queues (BullMQ 6 via `@nestjs/bullmq`)
| Queue | Job names | `jobId` (dedupe key; no `:`; not all digits) | Options |
|---|---|---|---|
| `stripe-events` | `<event.type>` | `evt_...` (the Stripe event id) | attempts 5, exponential 1 s, `removeOnComplete {age: 7d}`, `removeOnFail false` |
| `qbo-sync` | `sync-customer`, `sync-invoice`, `sync-payment`, `sync-refund` | `qbo-<entityType>-<entityId>-v<n>` (bump `n` for a human retry) | attempts 8, custom backoff (429 -> `worker.rateLimit(60_000)` + `Worker.RateLimitError()` — does not consume an attempt; 5xx/timeouts exponential 2 s x2^n capped 5 min with jitter; 400-family -> `UnrecoverableError`), worker `limiter {max: 5, duration: 1000}`, `concurrency 2` (<= 10 concurrent/realm) |
| `reconcile` | `reconcile-all` (repeatable every 15 min via `queue.upsertJobScheduler`), `reconcile-payment` | `reconcile-payment-<paymentId>` | attempts 3 |

BullMQ jobId dedupe only holds while the job record exists (removed jobs can be re-added) -> the **database unique index is the real dedupe**; the jobId is a second fence. DLQ: BullMQ has none; on the final failed attempt the `@OnWorkerEvent('failed')` hook writes `SyncJob.status = FAILED` + `OperationalException(SYNC_FAILED)`; the UI "Retry" re-enqueues with `-v<n+1>`. Transactional outbox: `IntegrationEvent` + `SyncJob(QUEUED)` are inserted in the same Postgres transaction as the business write; the enqueue happens after commit; a 60-s sweeper re-enqueues any `QUEUED` SyncJob with no BullMQ job (closes the dual-write gap between Postgres and Redis).

### 3.3 Stripe event dedupe transaction
```ts
async recordAndEnqueue(event: Stripe.Event): Promise<{ duplicate: boolean }> {
  const objectId = (event.data.object as { id?: string }).id ?? null;
  const inserted = await this.prisma.integrationEvent.createMany({          // INSERT ... ON CONFLICT DO NOTHING
    data: [{ provider: 'stripe', externalId: event.id, type: event.type, objectId, payload: event as unknown as Prisma.InputJsonValue }],
    skipDuplicates: true,
  });
  if (inserted.count === 0) { this.metrics.inc('stripe.webhook.duplicate'); return { duplicate: true }; }
  await this.stripeEventsQueue.add(event.type, { eventId: event.id }, { jobId: event.id });     // second fence
  return { duplicate: false };
}
// processor: handlers are idempotent upserts keyed by provider ids, status only moves forward
async onPaymentIntentSucceeded(pi: Stripe.PaymentIntent, eventId: string) {
  await this.prisma.$transaction(async (tx) => {
    const payment = await tx.payment.upsert({
      where: { providerPaymentId: pi.id },
      create: { providerPaymentId: pi.id, customerId: pi.metadata.spadeCustomerId, invoiceId: pi.metadata.spadeInvoiceId ?? null,
                method: pi.payment_method_types[0], amountCents: pi.amount_received, status: 'SUCCEEDED', sourceEventId: eventId, settledAt: new Date() },
      update: { status: 'SUCCEEDED', amountCents: pi.amount_received, settledAt: new Date() },   // PENDING -> SUCCEEDED; never downgrade
    });
    await tx.syncJob.create({ data: { queue: 'qbo-sync', jobName: 'sync-payment', jobId: `qbo-PAYMENT-${payment.id}-v1`, entityType: 'PAYMENT', entityId: payment.id, status: 'QUEUED' } });
    await tx.integrationEvent.update({ where: { provider_externalId: { provider: 'stripe', externalId: eventId } }, data: { status: 'PROCESSED', processedAt: new Date() } });
  });
  await this.qboQueue.add('sync-payment', { paymentId }, { jobId: `qbo-PAYMENT-${paymentId}-v1` }); // after commit
}
```

### 3.4 `AccountingProvider` port
```ts
export interface AccountingProvider {
  readonly mode: 'sandbox' | 'simulator';
  findCustomerByDisplayName(realm: Realm, displayName: string): Promise<QboCustomer | null>;
  createCustomer(realm: Realm, input: QboCustomerInput): Promise<QboCustomer>;
  findInvoiceByDocNumber(realm: Realm, docNumber: string): Promise<QboInvoice | null>;
  createInvoice(realm: Realm, input: QboInvoiceInput): Promise<QboInvoice>;
  findPaymentByRefNum(realm: Realm, refNum: string): Promise<QboPayment | null>;
  createPayment(realm: Realm, input: QboPaymentInput): Promise<QboPayment>;          // Line[].LinkedTxn -> Invoice
  createRefundReceipt(realm: Realm, input: QboRefundInput): Promise<QboRefundReceipt>;
  getPayment(realm: Realm, id: string): Promise<QboPayment | null>;                  // null on 610
  sparseUpdatePayment(realm: Realm, id: string, syncToken: string, patch: Partial<QboPaymentInput>): Promise<QboPayment>; // throws StaleObjectError(5010)
  changedSince(realm: Realm, entities: ('Invoice'|'Payment'|'Customer')[], since: Date): Promise<QboChange[]>;   // CDC
}
export class QboApiError extends Error { constructor(readonly httpStatus: number, readonly code: string, readonly detail: string, readonly intuitTid?: string) { super(`${httpStatus} ${code}: ${detail}`); } }
// Realm = { realmId, accessToken (fresh via TokenStore.getValidAccessToken(realmId), mutex-guarded refresh) }
```

### 3.5 BullMQ processor (qbo-sync)
```ts
@Processor('qbo-sync', { concurrency: 2, limiter: { max: 5, duration: 1000 } })
export class QboSyncProcessor extends WorkerHost {
  async process(job: Job<{ paymentId: string }>) {
    const realm = await this.tokens.realm();                       // refreshes if expired; throws TokenExpiredError -> Unrecoverable
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: job.data.paymentId }, include: { allocations: true } });
    const customerMap = await this.mappings.ensureCustomer(realm, payment.customerId);   // find-by-DisplayName-then-create; handles 6240 by appending customer number
    const invoiceMap  = await this.mappings.ensureInvoice(realm, payment.invoiceId!);    // find-by-DocNumber-then-create
    try {
      const existing = await this.qbo.findPaymentByRefNum(realm, refNum(payment));       // QBO has no idempotency key: query first
      const qboPayment = existing ?? await this.qbo.createPayment(realm, {
        customerRef: customerMap.externalId, totalAmt: cents(payment.amountCents), txnDate: isoDate(payment.settledAt!),
        paymentRefNum: refNum(payment), privateNote: `stripe:${payment.providerPaymentId}`, depositToAccountRef: realm.stripeClearingAccountId,
        lines: [{ amount: cents(payment.amountCents), linkedTxn: [{ txnId: invoiceMap.externalId, txnType: 'Invoice' }] }] });
      await this.mappings.markSynced('PAYMENT', payment.id, qboPayment.Id, qboPayment.SyncToken);
      return { qboId: qboPayment.Id };
    } catch (err) {
      if (err instanceof QboApiError) {
        await this.syncJobs.recordAttempt(job, err);                  // stores intuit_tid, code, attempt no.
        if (err.httpStatus === 429) { await this.worker.rateLimit(60_000); throw Worker.RateLimitError(); }   // pause realm; not counted as an attempt
        if (err.httpStatus === 401) { await this.tokens.forceRefresh(); throw err; }                          // retried by backoff
        if (err.httpStatus === 400 && err.code !== '5010') throw new UnrecoverableError(`${err.code}: ${err.detail}`); // -> OperationalException
      }
      throw err;                                                       // 5xx/timeouts -> exponential backoff
    }
  }
  @OnWorkerEvent('failed') async onFailed(job: Job, err: Error) {
    if (job.attemptsMade >= (job.opts.attempts ?? 1) || err instanceof UnrecoverableError) await this.exceptions.raise('SYNC_FAILED', job, err);
  }
}
```

### 3.6 Reconciliation algorithm (`reconcile-all`, every 15 min + on demand)
For each local `Payment` with `status in (SUCCEEDED, PARTIALLY_REFUNDED, REFUNDED)` (and its invoice/customer):
1. `m = AccountingMapping(PAYMENT, payment.id)`. None and a `SyncJob` is QUEUED/ACTIVE -> **PENDING**. None and nothing queued (or job FAILED) -> **ORPHANED** (`ORPHANED_LOCAL`) -> exception.
2. `q = provider.getPayment(realm, m.externalId)`; `null` (610, deleted in QBO) -> **ORPHANED** -> exception `ORPHANED_LOCAL` ("QBO payment deleted").
3. Compare, all in integer cents: `round(q.TotalAmt*100) === payment.amountCents - payment.refundedCents(if refunds modeled as RefundReceipts, compare gross)`; `q.CustomerRef.value === mapping(CUSTOMER).externalId`; some `q.Line[].LinkedTxn[]` has `TxnId === mapping(INVOICE).externalId && TxnType === 'Invoice'`; refunds: each `REFUND` allocation has a `RefundReceipt` mapping with matching amount. Any failure -> **MISMATCH** -> `OperationalException(AMOUNT_MISMATCH | LINK_MISSING, expected, actual)`; else **IN_SYNC**, store `syncToken`, `lastReconciledAt`.
4. Reverse pass via CDC (`changedSince = lastCdcAt`): a QBO Payment/Invoice whose `PrivateNote` starts with `stripe:` but has no mapping -> **ORPHANED** (`ORPHANED_QBO`, e.g. created by hand in QBO). Deleted/voided entities in CDC -> re-check step 2.
5. Optional Stripe truth check (daily): `stripe.paymentIntents.retrieve(pi)` `amount_received` vs local; drift -> `AMOUNT_MISMATCH` with `source: 'stripe'`.
Exceptions are deduped on `(kind, entityType, entityId, status=OPEN)`; resolution actions (each writes `AuditEvent{before, after, actorId}`): **Re-push Stripe truth** (sparse update with current SyncToken; 5010 -> re-read, retry once), **Accept QBO value** (records a note; sets local `reconState = IN_SYNC` with `resolution = 'accepted_qbo'`), **Retry sync** (`-v<n+1>` job), **Ignore** (with reason). States are shown per row with a timeline (event -> job attempts -> mapping -> reconcile).

### 3.7 Demo script (proves the three behaviours)
Prereqs: Docker Desktop running, `docker compose up postgres redis` (**redis:7-alpine** — the machine's Redis 3.0.504 service on :6379 must be stopped first: `Stop-Service Redis` / `net stop Redis`; BullMQ refuses `< 5.0.0`), `stripe listen ...` in one terminal, `QBO_MODE=simulator` (or `sandbox` after `/integrations/qbo/connect`).
1. **Duplicate webhook -> one Payment.** `stripe trigger payment_intent.succeeded --add "payment_intent:metadata[spadeInvoiceId]=<inv>,payment_intent:metadata[spadeCustomerId]=<cus>"`; read `evt_...` from the listener; `stripe events resend evt_...` (or `POST /dev/replay/evt_...` which re-signs the stored payload with `generateTestHeaderString`); show: `IntegrationEvent` count for `evt_` = 1, second HTTP response `{received:true, duplicate:true}`, `SELECT count(*) FROM "Payment" WHERE "providerPaymentId"='pi_...'` = 1, `stripe-events` queue shows the second add ignored, Money Integrity "Integration Log" tab shows the duplicate line. Bonus: replay with a stale timestamp -> 400 (tolerance), tampered body -> 400.
2. **QBO 429 -> retries and succeeds.** `QBO_SIM_FAULTS=429x2` (simulator) or `QBO_FAULT_INJECT=429x2` (an interceptor in `QboHttpProvider` that fakes the first two responses even against the real sandbox); trigger a payment; UI row goes PENDING with attempt timeline: `429 ThrottleExceeded -> realm paused 60 s (rateLimitHits=1)` x2 -> `201 Payment Id 173` -> `SYNCED` -> next reconcile -> `IN_SYNC`. Show `SyncJob.rateLimitHits = 2, attempts = 1`, `intuit_tid` captured.
3. **Amount mismatch -> exception -> human resolves -> AuditEvent.** Edit the QBO payment (sandbox UI, or `sparseUpdatePayment(TotalAmt 2000.00)` via `/dev/tamper`); click "Reconcile now"; row flips to **MISMATCH**, `OperationalException{kind: AMOUNT_MISMATCH, expected: {totalAmt: 2500.00}, actual: {totalAmt: 2000.00}}`; user clicks **Re-push Stripe truth** -> sparse update with SyncToken (simulator can force one 5010 to show the re-read) -> reconcile -> **IN_SYNC**; `AuditEvent{action:'exception.resolve', before, after, actorId}` visible in the row's timeline. Repeat with **Accept QBO value** to show the alternative path.

### 3.8 Open-source examples to study
| Repo | License | Why |
|---|---|---|
| `stripe/stripe-node` (22.6.2) | MIT | `Webhooks.d.ts` (`constructEvent`, `generateTestHeaderString`), `resources/Events.d.ts` typed union, `InvoicePayments.d.ts`. |
| `stripe-samples/accept-a-payment` | MIT | Current server-side PI + webhook patterns (incl. `us_bank_account`). |
| `golevelup/nestjs` -> `packages/stripe` | MIT | NestJS raw-body + `@StripeWebhookHandler` design; read, don't depend (peer `stripe ^20.4.1`). |
| `intuit/oauth-jsclient` | Apache-2.0 | OAuth flow, `x_refresh_token_hard_expires_in`, token shape. |
| `IntuitDeveloper/SampleApp-Webhooks-Java-Cloudevents` | Apache-2.0 | Official CloudEvents webhook + `intuit-signature` verification + CDC sync (Java, but the only official current sample). |
| `jakethehoffer/ledgerly` | Apache-2.0 | Stripe events -> double-entry -> QBO `JournalEntry`; AI-generated and unaudited per author — study its dedupe/retry/DLQ shape, not its accounting. |
| `kgajera/stripe-event-types` | MIT | Obsolete since stripe-node's own typed events; useful only for the discriminated-union pattern. |
| `taskforcesh/bullmq` docs | MIT | Rate limiting (`Worker.RateLimitError`), custom backoff, job ids. |

## 4. CRITIC

1. **Over-scoped vs thin-but-real.** A full Customer/Item/Invoice/Payment/Refund/CreditMemo sync plus webhooks plus reconciliation is a 3-month product (Synder/Acodei exist). For the candidate prototype, the honest cut is: Customer + Invoice + Payment (+ RefundReceipt only if time) against the sandbox, with the reconciler and exception UI as the centrepiece. Items and the Stripe Clearing account are seeded once by name, not synced. Say so in the README; a reviewer respects a small, real slice over a wide mock.
2. **What breaks on Windows dev (verified on this machine).** Redis 3.0.504 (MSOpenTech) is installed *and running* on :6379 -> BullMQ throws "Redis version needs to be greater or equal than 5.0.0"; use Docker `redis:7-alpine` (daemon currently stopped) or Memurai. No winget/scoop -> install the CLI via `npm i -g @stripe/cli`. PowerShell eats `[ ]` in `--add` args (quote them). Node's `localhost` may resolve to `::1` -> forward to `127.0.0.1`. Prisma 7 needs the pg driver adapter; the `prisma` CLI `latest` tag is an 8.0 RC — pin 7.10.0 explicitly. Intuit's redirect URI for dev keys must be `http://localhost:<port>/...` exactly.
3. **Where an experienced QBO integrator will smell fakery.** Reading `invoice.payment_intent` (removed in Basil); omitting `minorversion=75`; keeping the first refresh token (rotation kills it in ~24 h); float dollars compared to cents; `PaymentRefNum` holding a 27-char `pi_` id (21-char limit); no `SyncToken` handling; hard-coded Item/Account Ids; no plan for where Stripe fees and payouts land (gross Payment -> `Stripe Clearing`, payout = Transfer to checking + fee expense; design it, label it phase 2); pretending QBO has idempotency keys; a "QBO webhook" that was never registered (needs public HTTPS). Also TxnDate: Stripe `created` is UTC, QBO dates are company-local — settle on the settlement date in the company timezone or reconciliation will drift at midnight.
4. **BullMQ vs Postgres jobs.** For a single-node prototype, Postgres-backed jobs (pg-boss 12.33.0, or a `SyncJob` table polled with `FOR UPDATE SKIP LOCKED`) are simpler and *more honest*: enqueue and business write share one transaction, no Redis, no dual-write sweeper, trivially inspectable in the same DB the UI reads. BullMQ earns its place only because the JD names Redis/BullMQ and it gives rate limiting/backoff/timeline for free. Keep BullMQ, but implement the outbox (3.2) and state the trade-off in the README; do not claim "exactly-once", claim "at-least-once + idempotent".
5. **Money Integrity should be two views, not one.** The founder's Monday pain is cash, not books: which lots are invoiced, which buyers paid by card (settled) vs ACH (`processing`, 4 business days, can still fail/dispute), who is overdue, and which seller payouts are unblocked. The Stripe->QBO sync state is the accountant's view. Build "Settlement board" (Stripe truth, per lot, due Monday, ACH pending) and "Books sync" (this document) as two tabs sharing the same `Payment`/`OperationalException` tables. Buyer premium and seller payout are QBO-side objects (Invoice line item / Bill) and money never touches Stripe Connect — say that explicitly.
6. **"Why didn't you just use that?"** Stripe Invoicing already does hosted invoices, reminders, overdue events and ACH — we *are* using it (1.7), and the UI must not re-implement invoice emailing. QuickBooks also lists off-the-shelf Stripe connectors; the prototype's answer is operational semantics (contract deposits, lot settlement, recipient-mare leases, human exception workflow), not a generic sync — the README should say that in one paragraph. Do not use Payment Links or Customer Portal (subscription-centric). Invoice payment plans would be the elegant deposit+balance answer but are private preview — mention, don't build.
7. **Sandbox reality risks.** QBO sandbox can't be reset (delete/recreate before the demo; keep a seed script), tokens rotate daily (the demo must run the connect flow the same day or the refresh loop must be proven), and `stripe trigger` events carry only the metadata you inject — the demo must show `--add` metadata or a fixture, otherwise the link to a SPADE invoice is fiction. Record a screen capture of the real-sandbox run as a fallback.
8. **Scope of "immutable IntegrationEvent".** Store the raw bytes (or exact JSON) and the signature header, not a re-serialized object, or replay/forensics claims are hollow; keep `payload` write-once via a DB trigger or app-level guard and never store `whsec_`/tokens in it.

## Sources
Stripe: docs.stripe.com/webhooks, /upgrades, /changelog/basil (2025-03-31 partial payments; 2025-05-28 attach_payment), /invoicing/payment-plans (private preview), /api/idempotent_requests, /metadata, /testing, /payments/ach-direct-debit/accept-a-payment, /cli/listen, /cli/trigger, /cli/events/resend, /cli/fixtures, stripe.com/invoicing/pricing; github.com/stripe/stripe-node (CHANGELOG, README, `src/apiVersion.ts`, tarball 22.6.2 types); github.com/stripe/stripe-cli README. NestJS: docs.nestjs.com/faq/raw-body. BullMQ: docs.bullmq.io (rate-limiting, job-ids, retrying-failing-jobs, going-to-production), `src/classes/redis-connection.ts`. Intuit: `developer.intuit.com/.well-known/openid_sandbox_configuration`, github.com/intuit/oauth-jsclient (README, CHANGELOG 4.2.4/4.2.5), IntuitDeveloper/SampleApp-Webhooks-Java-Cloudevents README, help.developer.intuit.com Q&A (refresh rotation), Intuit blog titles via search (refresh-token policy 2025-11-12; CloudEvents webhooks; minor version 75); 3rd-party 2026 guides used only for limits/error codes: truto.one, dev.to/zuplo, maesn.com, satvasolutions.com, dancingnumbers.com, breadwinner.com. npm registry via `npm view`.
