// Mutation testing over the rules that decide money, medicine and access:
// `pnpm --filter @daysheet/domain test:mutation`. Not the whole package — the question is whether
// the suite would notice if these particular rules went subtly wrong (cleared → initiated,
// > → >=, a permission dropped, an eligibility condition negated). A surviving mutant is read,
// not chased: a dangerous one gets the smallest test that kills it; an equivalent one is left.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  // The vitest runner plugin (10.0.0) re-runs one Vitest instance per mutant, which Vitest 5 answers
  // with zero tests: every runtime mutant "survives" without a test executed. The command runner
  // starts a fresh vitest per mutant instead — slower, no per-test coverage, but every mutant is met
  // by the whole suite. Revisit when the plugin supports Vitest 5.
  testRunner: 'command',
  commandRunner: { command: 'node node_modules/vitest/vitest.mjs run --reporter=dot' },
  mutate: [
    'src/money.ts',
    'src/rbac.ts',
    'src/rules/settlement.ts',
    'src/rules/payment-transitions.ts',
    'src/rules/clearance.ts',
    'src/rules/recipient.ts',
    'src/rules/recip-return.ts',
    'src/ask/verify.ts',
  ],
  coverageAnalysis: 'off',
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  clearTextReporter: { allowColor: false, logTests: false, reportMutants: true, reportScoreTable: true },
  concurrency: 3,
  tempDirName: '.stryker-tmp',
  // Read, not gated: the score is evidence for the honesty page, and a threshold would invite
  // tests that pin implementation details.
  thresholds: { high: 90, low: 70, break: null },
};
