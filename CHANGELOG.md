# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Dynamic imports are no longer invisible to the dependency graph**:
  `import("./x")`, `require("./x")` and `require.resolve("./x")` with a
  static string argument (string literals and substitution-free template
  literals) now create graph edges, so consumers reachable only through a
  dynamic load appear in the blast radius. Arguments that cannot be
  resolved statically (template literals with variables, concatenation)
  are counted per file and reported through the new
  `unresolved-dynamic-imports` warning (additive to JSON schema v1)
  instead of being silently dropped.
- **Test coverage is now transitive**: a test covers not only the files it
  imports directly but everything it reaches through the dependency graph
  within `DEFAULT_TEST_COVERAGE_DEPTH` (4) hops. The cap mirrors the risk
  engine's depth threshold so one root-importing test cannot claim to
  cover the whole codebase; the limit is configurable per call.
- Coverage now also flows through dynamic loads: tests exercising a module
  via `await import(...)` are mapped too (reuses the graph built once per
  analysis).
- **Re-export wiring no longer counts as active usage**: `isImportOnlyUsage`
  now classifies `export { X } from "./y"` (including renamed, `default`,
  `export * from` and `export * as NS` forms) and bare `export { X }` lists
  as passive contract wiring, matching what it already did for import
  declarations. Barrel pass-throughs stop inflating the blast radius.
  Dynamic calls on the line (`import("./x")`) and exports whose initializer
  uses the symbol (`export default build(X)`) remain active usages.

## [1.1.0] - 2026-08-23

### Added

- **Machine-readable output**: `impactwave analyze --json` prints the full
  report as a single JSON document on pure stdout (warnings go to stderr).
- **Versioned contract** (`meta.schemaVersion`, currently `1`): within a
  schema version only additive changes are allowed; breaking changes bump the
  version. Published JSON Schema at [`docs/schema-v1.json`](docs/schema-v1.json)
  (draft 2020-12), validated in CI against real output on every change.
- **Raw consumer data**: with `--json`, symbol usages include contract-wiring
  connections flagged as `importOnly: true` instead of being filtered out, so
  each tool can apply its own policy.
- **Programmatic API**: `analyzeProject()` facade (`src/engine/analyze.ts`)
  runs the whole pipeline and returns the serializable result — the same
  object `--json` emits.
- Golden-file test that guarantees console output stays byte-identical across
  refactors (`npm run golden:update` regenerates it deliberately).
- This changelog.

### Changed

- Running outside a Git repository now exits with code `1` and a clear error
  message instead of exiting `0` silently.
- Internal: the CLI is a thin adapter; analysis lives behind the facade and
  rendering in `src/output/`. Console output is unchanged (guarded by the
  golden file).

## [1.0.1] - 2026-08-21

### Fixed

- No longer crashes on unreadable directories (e.g. Docker-owned `pg_data`
  with restrictive permissions): the source discovery walks the repository
  itself and skips hostile paths silently.
- Projects whose root `tsconfig.json` has no `include`/`files` (NestJS-style)
  are analyzed correctly; only `compilerOptions` are consumed from the
  tsconfig, never TypeScript's own file globbing.
- Legacy `compilerOptions` spellings (`moduleResolution: "node"`,
  `"es6"`) are normalized; unconvertible options such as `jsx` or
  `moduleDetection` are dropped with an explicit warning instead of crashing.

## [1.0.0] - 2026-08-15

### Added

- Initial release: blast-radius analysis of committed changes
  (`base..HEAD`) with AST-based modified-symbol detection, real consumers,
  dependency-graph blast radius by cascade level, impact coverage against
  test files, deterministic risk score (0–100) with explainable reasons, and
  configurable risk weights via `--risk-weights`.

[Unreleased]: https://github.com/paleto30/impactwave/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/paleto30/impactwave/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/paleto30/impactwave/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/paleto30/impactwave/releases/tag/v1.0.0
