# Biome runtime boundaries

These rules extend the root Biome 2.5.15 configuration. They run through the
existing `biome lint` and `biome ci` commands; they are not a second scanner.

- Client and shared source reject Node.js builtin modules and common Node.js
  globals. Runtime imports reject known SDK-private paths and client/server
  cross-layer imports. SDK/CLI installation discovery via `.resolve()` is also
  rejected. Shared modules reject React/React Native runtime imports. The existing `scripts/check-boundaries.mjs` remains the
  project dependency check and is intentionally outside this rule set.
- Essentials client source and `index.client.*` reject unshadowed browser DOM
  and global event APIs. Its file globs include any future `client/web.ts`, so
  adding an adapter does not exempt Essentials. Other plugin `client/web.ts`
  adapters may use DOM APIs.
- Native client JSX rejects lowercase tags and selected Web-only props.
- Runtime source rejects direct writes and common reflective mutations of
  native built-in and global event prototypes. Ordinary plugin-defined class
  prototypes remain valid.

The rules use Biome's built-in `noNodejsModules`, `noRestrictedGlobals`, and
`noRestrictedImports` rules plus GritQL plugins for syntax-specific JSX and
prototype patterns. GritQL matches the listed syntax forms; it does not resolve
arbitrary aliases such as `const prototype = KeyboardEvent.prototype` or
`const Native = KeyboardEvent`, nor does it identify every possible host-menu
injection through a public API. Keep the existing project-level boundary check
for dependency resolution, and review new host extension APIs separately.

`node --test scripts/tests/biome-rules.test.mjs` copies this exact config and
these plugins into an isolated temporary Git repository and checks physical
fixture files with the pinned Biome CLI. It never writes probes into production
source directories. The tests assert the expected diagnostic category/message,
so a formatter or unrelated lint error cannot masquerade as rule coverage.
