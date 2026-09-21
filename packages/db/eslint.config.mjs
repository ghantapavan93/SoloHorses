// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'src/generated/**', 'eslint.config.mjs', 'vitest.config.mts', 'prisma.config.ts'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: './tsconfig.lint.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },

  {
    // The seed indexes fixed word lists and its own arrays; non-null assertions there are intentional.
    files: ['prisma/seed.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off', 'no-console': 'off' },
  },
);
