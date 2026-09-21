// The boundaries docs/ARCHITECTURE.md and CLAUDE.md claim, checked by the build instead of by discipline.
// `pnpm check:architecture` fails on any edge below. Rules are as few as the claims: add one only for a
// boundary the docs already state.

// The five bounded contexts. `ask` and `lab` are not peers: Ask reads across all of them, the Reliability
// Lab drives all of them, so they get their own (looser) rule.
const CONTEXTS = 'accounting|billing|operations|reproduction|veterinary';

// What a context publishes: its Nest module (the DI surface, whose `exports` name the public services), its
// domain events (the asynchronous contract), and its services. Everything else — consumers, detectors, the
// domain folder, infrastructure adapters, controllers — is the context's own business.
const PUBLIC_SURFACE =
  '^apps/api/src/modules/[^/]+/([^/]+\\.module\\.ts|domain/events\\.ts|application/[^/]+\\.service\\.ts)$';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-stays-pure',
      comment:
        'packages/domain holds every rule as a pure function: it may depend on zod, on node built-ins and on its own files, never on Nest, Prisma, Redis, BullMQ, a model SDK, the web app or the API.',
      severity: 'error',
      from: { path: '^packages/domain/src' },
      to: {
        pathNot: ['^packages/domain/src', 'node_modules/(zod|vitest)/'],
        dependencyTypesNot: ['core'],
      },
    },
    {
      name: 'web-never-reaches-the-api-or-the-database',
      comment:
        'The web app is a harness over HTTP: it calls the API with a per-request token and never imports its implementation or a database client.',
      severity: 'error',
      from: { path: '^apps/web/src' },
      to: { path: ['^apps/api/', '^packages/db/', 'node_modules/(@prisma|prisma)/'] },
    },
    {
      name: 'platform-below-contexts',
      comment:
        'platform/ (config, persistence, security, outbox, ledger, resilience, cache…) is shared plumbing; it knows no bounded context.',
      severity: 'error',
      from: { path: '^apps/api/src/platform/' },
      to: { path: '^apps/api/src/modules/' },
    },
    {
      name: 'contexts-only-through-public-surface',
      comment:
        'A bounded context reaches another only through its module, its domain events or its exported services (ADR-011). Its consumers, detectors, domain folder, adapters and controllers are private.',
      severity: 'error',
      from: { path: `^apps/api/src/modules/(${CONTEXTS})/` },
      to: { path: '^apps/api/src/modules/(?!$1/)[^/]+/', pathNot: PUBLIC_SURFACE },
    },
    {
      name: 'readers-never-touch-plumbing',
      comment:
        'Ask and the Lab sit above the contexts: they may read a context’s pure domain vocabulary (the proposal catalog) and call its services, never its controllers or its consumers.',
      severity: 'error',
      from: { path: '^apps/api/src/modules/(ask|lab)/' },
      to: {
        path: '^apps/api/src/modules/(?!$1/)[^/]+/(api/|application/(?![^/]+\\.service\\.ts$))',
      },
    },
    {
      name: 'ask-never-touches-adapters',
      comment:
        'Stripe, QuickBooks, the auction feed: the assistant reaches an adapter only through the service that owns it, never by importing it.',
      severity: 'error',
      from: { path: '^apps/api/src/modules/ask/' },
      to: { path: '^apps/api/src/modules/[^/]+/infrastructure/' },
    },
    {
      name: 'lab-arms-only-the-simulator-seams',
      comment:
        'The Reliability Lab is the one module allowed past a context’s adapters, and only at the simulator seams it arms (ADR-008): the accounting provider port and its simulator, and the auction adapter. Any other adapter import is a leak.',
      severity: 'error',
      from: { path: '^apps/api/src/modules/lab/' },
      to: {
        path: '^apps/api/src/modules/[^/]+/infrastructure/',
        pathNot:
          '^apps/api/src/modules/(accounting/infrastructure/(accounting\\.provider|qbo\\.simulator)|billing/infrastructure/auction\\.adapter)\\.ts$',
      },
    },
    {
      name: 'ask-reads-through-services',
      comment:
        'The assistant is read-only over projections (ADR-016): its tools, graph, policy and verifier reach the world through the contexts’ services, never through Prisma. Only the conversation store (ask.service.ts) and the eval ledger own tables.',
      severity: 'error',
      from: {
        path: '^apps/api/src/modules/ask/',
        pathNot: ['^apps/api/src/modules/ask/application/ask\\.service\\.ts$', '^apps/api/src/modules/ask/evals/'],
      },
      to: {
        path: ['^apps/api/src/platform/persistence/', '^packages/db/', 'node_modules/(@prisma|prisma)/'],
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['\\.(spec|test)\\.ts$', '/dist/', '/\\.next/'] },
    tsPreCompilationDeps: true,
    // The web app's `@/` alias is left unresolved on purpose: no rule reads a web-internal edge, and
    // dependency-cruiser's one tsconfig slot cannot serve the API and the web app at once.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
