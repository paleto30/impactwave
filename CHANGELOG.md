# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Scope is now explicitly TypeScript only** (`.ts`, `.tsx`, `.mts`,
  `.cts`). JavaScript was never really analyzed — its files never reached
  the dependency graph — so it is documented as out of scope instead of
  half-supported. `.mts`/`.cts`, which are TypeScript, are now discovered.
- Consumers carry an `importOnly` flag computed when they are collected;
  every later stage (risk, console, JSON) reads that one classification.
- JSON output gains `changedFiles[].previousPath` for renames and the
  `unsupported-source-files` warning code (both additive to schema v1).

### Fixed

- **Multi-line imports no longer count as real consumers**: contract wiring
  is classified from the AST instead of from the text of the reference's
  line. An import formatted across several lines put the symbol on a line of
  its own (`PaymentService,`), which the line-based rule read as an active
  usage — inflating the blast radius and the score with files that merely
  import the symbol.
- **Renames are diffed against their previous content**: a rename used to be
  split into a delete plus an add, so every line of the new path counted as
  modified and every symbol in it was marked as touched. It is now reported
  as one modification of the new path, carrying `previousPath`.
- **Changes that only delete code are detected**: removals have no line of
  their own in the new file and were ignored entirely, so dropping a
  validation inside a function marked no symbol and reported no impact. The
  removed code's position is now recorded.
- **Base branch detection keeps the remote prefix and slashes**:
  `refs/remotes/origin/release/2.0` resolved to `2.0`, a ref that does not
  exist. It now resolves to `origin/release/2.0`, which also works in CI
  clones that never create the local branch.
- **JavaScript files no longer crash the analysis**: a changed `.js` file
  reached `findReferences` on a file the TypeScript program did not contain
  and killed the run with an uncaught error. Such files are now skipped and
  reported through the `unsupported-source-files` warning.
- **Risk reasons add up to the score**: each factor is rounded once and the
  score is the sum of the points shown, instead of rounding the total
  separately and disagreeing with the printed reasons.
- Unmerged or unknown git statuses no longer abort the run with an uncaught
  error; type changes (`T`) are treated as modifications.
- The engine no longer writes to stdout when the directory is not a Git
  repository, which polluted the `--json` document.

## [1.2.0] - 2026-08-24

### Added

- **`testCallerImpact` risk weight** (optional, via `--risk-weights`): test
  files consuming a modified symbol no longer have to count inside
  `callerImpact`. When the key is absent, scoring is byte-identical to
  previous behavior; when present, production consumers saturate
  `callerImpact` and test consumers saturate `testCallerImpact`
  (`points = min(P/10,1)·w.callerImpact + min(T/10,1)·w.testCallerImpact`).
  An explicit `0` exempts tests from the score.

  Measured on this repository analyzing its own v1.2 work
  (`analyze -b master`, 5 production + 2 test consumers):

  | config                       | score | level  |
  |------------------------------|-------|--------|
  | default (legacy, tests in callerImpact) | 56    | HIGH   |
  | `"testCallerImpact":15`      | 53    | HIGH   |
  | `"testCallerImpact":0`       | 50    | MEDIUM |

### Changed

- `--risk-weights` accepts the new optional key `testCallerImpact`;
  validation lists it among valid keys.

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

[Unreleased]: https://github.com/paleto30/impactwave/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/paleto30/impactwave/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/paleto30/impactwave/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/paleto30/impactwave/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/paleto30/impactwave/releases/tag/v1.0.0
