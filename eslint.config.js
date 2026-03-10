/**
 * ESLint configuration — SSoT enforcement for injectable clocks and RNG.
 *
 * Goals:
 *  1. Prevent new raw Date.now() calls from bypassing injectable _now clocks.
 *     (warn during RuntimeContext migration; promote to error once all 26
 *      existing sites are migrated — tracked via --max-warnings 26 in CI.)
 *  2. Prevent Math.random() — not cryptographically secure.
 *  3. Prevent direct crypto.randomBytes / crypto.randomUUID property access
 *     outside the approved utils/id.ts gateway.
 *
 * Why two rule types:
 *  - no-restricted-syntax (AST selector) is used for Date.now() because
 *    no-restricted-properties fires on property access only, not on calls,
 *    and would also block new Date() used for ISO string formatting.
 *  - no-restricted-properties is sufficient for Math.random and crypto.*
 *    because these are accessed as properties before being called.
 *
 * Note: process.hrtime.bigint() is intentionally NOT restricted. It is the
 * approved monotonic clock primitive with a single consumer (EvidenceFactory).
 */

import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Global ignores — must be a standalone config object (no `files`) for ESLint v9 flat config.
  {
    ignores: ['**/dist/**', 'scripts/**', 'coverage/**'],
  },
  {
  files: ['packages/*/src/**/*.ts'],
  languageOptions: {
    parser: tseslint.parser,
  },
  rules: {
    'no-restricted-syntax': [
      'warn',
      {
        selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
        message:
          "Direct Date.now() bypasses the injectable clock. Use the module's _now parameter or runtime.now. (warn→error after RuntimeContext RFC lands)",
      },
    ],
    'no-restricted-properties': [
      'error',
      {
        object: 'Math',
        property: 'random',
        message:
          'Math.random() is not cryptographically secure. Use injectable _randomInt or crypto.randomInt().',
      },
      {
        object: 'crypto',
        property: 'randomBytes',
        message: 'Direct crypto.randomBytes() access. Use generateSecureId() from utils/id.ts.',
      },
      {
        object: 'crypto',
        property: 'randomUUID',
        message: 'Direct crypto.randomUUID() access. Use generateSecureId() from utils/id.ts.',
      },
    ],
  },
},
)
