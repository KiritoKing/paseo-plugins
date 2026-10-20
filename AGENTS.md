# Repository guide

This repository contains independently versioned Paseo plugins under `packages/*`.
The root is a private pnpm workspace. Read the root README and the affected package's
README and OVERVIEW before changing behavior.

## Toolchain and commands

- Use the exact pnpm version in root `package.json`; `.node-version` selects the
  development Node version. CI checks Node 22 and 24. Keep `pnpm-lock.yaml` frozen
  unless dependencies are intentionally changing.
- Run commands at the repository root. `pnpm check` runs the environment, style,
  public-source, import-boundary, type, unit/integration, fixture-build and isolated
  package checks. Use `pnpm --filter @chlrc/<package> test` for an affected test suite.
- `pnpm format` formats source; `pnpm check:style` checks without writing. Keep broad
  formatting changes separate from behavioral changes when preparing commits.
- Tests need Git and ripgrep. Consumer package checks need npm and tar. AIW CLI and a Paseo
  daemon are needed for real plugin acceptance, not the synthetic test suites.
- `pnpm fixtures:build` creates optional browser fixtures under ignored `work/`.
  `pnpm fixtures:serve` serves them on loopback; `PORT` can select an available port.
  Stop only the task-owned preview service when finished.

## Runtime boundaries

- `index.client.*` and `client/` run in the client. Use React Native primitives,
  SDK client modules and theme tokens. Node built-ins belong in `server/`.
- `index.server.*` and `server/` run on the selected daemon host. Use the server SDK
  context. The daemon's paths and tools belong to that host.
- `shared/` contains environment-independent contracts and pure logic. It must not
  import client/server modules, including type-only references.
- The root `@getpaseo/plugin` entry is shared; `/client` and `/server` are distinct.
  Host-provided SDK, React, React Native, React Query and Zod dependencies remain
  development dependencies. Other runtime libraries must be declared dependencies.
- DOM access belongs in `paseo-ux/client/web.ts`, guarded by the web platform with
  native fallbacks. Do not add DOM to the shared TypeScript configuration. Browser
  fixtures may use DOM and simulated host APIs; runtime code must not import them.
- `/client/host` is test-only. Do not depend on private host modules in production.

## Packaging and evidence

- Each plugin keeps its manifest ID, package identity, own version, OVERVIEW and MIT
  license. Update its changelog when changing behavior or supported environments.
- The root pnpm lock is for development and Git preparation. AIW's npm shrinkwrap
  locks its npm consumer tree. Keep both synchronized with intentional dependency
  changes; see CONTRIBUTING.md for artifact checks.
- `pnpm pack:release` prepares tarballs under `work/packages`; it does not publish.
  Git-only preparation is removed from npm artifacts. Publishing runs only through
  an explicitly approved CI release, after its authentication is configured.
- Keep public documents, tests and package contents free of credentials, private
  endpoints, personal machine paths and real workspace/session data. Use synthetic
  fixtures. Do not copy live validation receipts into the repository.
- Report local checks, browser fixtures, real client/daemon acceptance and remote
  CI as distinct evidence. Include revision and environment in VALIDATION.md; never
  turn an old validation result into a current guarantee.
