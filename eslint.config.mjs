import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/dist/**', '**/coverage/**', 'local/vendor/**']),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    // Literal spaces make the independently reviewed wire-format checks easier to compare.
    rules: { 'no-regex-spaces': 'off' },
  },
  {
    files: ['**/*.ts'],
    rules: { 'no-console': 'error', '@typescript-eslint/no-explicit-any': 'error' },
  },
]);
