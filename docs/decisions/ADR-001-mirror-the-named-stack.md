# ADR-001 — Mirror the stack named in the role

**Situation.** The public job posting (May 2026) listed Next.js/Supabase/Netlify/Twilio/Resend. The current posting names three stacks: a NestJS + PostgreSQL + Prisma + Redis + BullMQ backend, a Next.js + Supabase + NextAuth veterinary app, and a React Native mobile app — plus Stripe and QuickBooks Online as essential integrations. The first research pass (docs/research/D, H) argued NestJS, Redis and a monorepo were "theater" for a solo prototype.

**Decision.** Build the prototype on the backend stack the role names — NestJS 11, Prisma 7, PostgreSQL 17, Redis + BullMQ — with Next.js 16 for the harness and Auth.js (NextAuth) for sessions. The role is maintaining existing codebases; showing fluency in their shapes matters more than picking the smallest possible stack.

**Cost.** Two apps instead of one. NestJS 12 could not be used because its CLI fails on Node 22.14 (`ERR_REQUIRE_CYCLE_MODULE` in its schematics dependency), so Nest 11 (CommonJS) is pinned, and TypeScript is 5.9 rather than 6.0 because the Nest 11 CLI pins it.

**Would change it.** If the backend moved to serverless functions, the domain package carries over unchanged; only `apps/api` would be rewritten.
