// Flat config. Site code is browser ES modules; tests and config files run in Node.
// supabase/functions/ is Deno TypeScript — checked by `deno lint`/`deno test`, not ESLint.
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/', 'tests/screenshots/', 'supabase/', 'js/vendor/'],
  },
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['error', { caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    files: ['tests/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { caughtErrors: 'none', ignoreRestSiblings: true, argsIgnorePattern: '^_' }],
    },
  },
];
