// Flat ESLint config for the TypeScript workspaces (apps/api, apps/web,
// packages/*). Run from the repo root with `pnpm lint`.
//
// Deliberately NOT type-aware: the type-checked presets need a per-workspace
// `project` and re-typecheck everything, which would duplicate `pnpm type-check`
// and make lint the slowest job in CI. Type errors are type-check's job; this
// catches the things tsc does not — unused code, sloppy async, debugger leftovers.

import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const recommended = tsPlugin.configs["flat/recommended"];

export default [
  {
    // Generated output and vendored trees. Linting these reports thousands of
    // violations in code nobody edits.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/.venv/**",
      "**/*.d.ts",
      "**/next-env.d.ts",
    ],
  },

  ...recommended,

  {
    // `apps/web` disables react-hooks/exhaustive-deps inline, but that rule
    // ships in eslint-plugin-react-hooks, which Next.js supplies to `next lint`
    // and which is not a dependency here. Without a definition ESLint fails the
    // *disable comment* itself. Declaring the rule as a no-op lets the directive
    // resolve; the real check stays Next's job.
    plugins: {
      "react-hooks": {
        rules: { "exhaustive-deps": { create: () => ({}) } },
      },
    },
    rules: { "react-hooks/exhaustive-deps": "off" },
  },

  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // An unused import usually means a refactor left a dangling reference.
      // `_`-prefixed names are the codebase's marker for "intentionally unused".
      // Warn, not error: ~33 pre-existing hits across apps/web and apps/api that
      // are not this change's to fix. Tighten to "error" once they are cleared.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],

      // A floating promise inside a fire-and-forget handler swallows the
      // rejection; requires type info, so it stays off — see the header note.
      "no-async-promise-executor": "error",
      "require-atomic-updates": "off",

      // Ships to production and pauses the process.
      "no-debugger": "error",

      // `catch {}` hides the failure it was written to handle.
      "no-empty": ["error", { allowEmptyCatch: false }],

      // Two cases falling into one another is nearly always a missing `break`.
      "no-fallthrough": "error",

      // `==` against a non-null literal is a coercion bug waiting to happen.
      eqeqeq: ["error", "always", { null: "ignore" }],

      // One pre-existing hit in apps/api/src/services/tracegraph.ts, which this
      // change does not own. Warn until it is fixed.
      "prefer-const": "warn",

      // `any` is load-bearing in the SDK proxies and provider adapters, which
      // wrap third-party clients whose types we do not control. Warn, don't fail.
      "@typescript-eslint/no-explicit-any": "warn",

      // The codebase uses `!` where a preceding guard proves non-null and the
      // compiler cannot see it. tsc's strict mode already covers the real cases.
      "@typescript-eslint/no-non-null-assertion": "off",

      // Empty interfaces are used as extension points in @causal/types.
      "@typescript-eslint/no-empty-object-type": "off",

      // Fastify and the Next.js app both legitimately declare `namespace` and
      // module augmentations.
      "@typescript-eslint/no-namespace": "off",

      // Reported on the `require`-based lazy loads in the MCP server.
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  {
    // Plain Node scripts (migrate.js, this file). No TS plugin, no globals
    // package installed — `no-undef` would flag `process` and `console`, so it
    // stays off and tsc/runtime catch real typos.
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },

  {
    // Tests assert on deliberately malformed input and stub third-party shapes.
    files: ["**/*.test.{ts,tsx}", "**/tests/**", "**/__tests__/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
];
