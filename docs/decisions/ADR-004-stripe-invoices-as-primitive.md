# ADR-004 — Stripe Invoices as the payment primitive

**Situation.** The business bills deposits, stud fees, chute fees, lease fees and board; customers pay by card or ACH; semen and papers are released on payment.

**Decision.** Each local `Invoice` maps one-to-one to a hosted Stripe Invoice (`collection_method: send_invoice`, payment methods card and `us_bank_account`). Our invoice code travels in Stripe `metadata`; idempotency keys on outbound calls are our own codes. Webhooks handled: `invoice.paid`, `invoice.payment_failed`, `payment_intent.processing`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `customer.created`. Current API shapes are respected: `Invoice.payment_intent` no longer exists, so payments are read from `invoice.payments` or `invoicePayments.list`.

**Cost.** No custom Elements checkout; the hosted page is Stripe's. Partial payments and payment plans are out of scope.

**Would change it.** A need for card-on-file with off-session charges (SetupIntent) or split settlement to consignors (Connect).
