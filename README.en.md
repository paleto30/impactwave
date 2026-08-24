# ImpactWave

> **English | [Español](README.md)**

**Blast radius analyzer for TypeScript and JavaScript.**

ImpactWave is a CLI that analyzes your Git changes before merging and answers one question:

> **"What can I break with this change, and what should I test?"**

---

## The problem

In a real codebase, a "small" change can break things far away from the file you edited. Reviewers catch it by intuition, global test suites don't tell you *what* to test first, and the actual impact surfaces in production.

ImpactWave turns that intuition into data: which exported symbols you physically touched, who really consumes them, which affected areas lack tests, and how much risk the change carries — with a deterministic score and explainable reasons.

## What it does

Given a commit range (`base branch → HEAD`), it prints a console report with:

- **Modified symbols** — functions, classes, public methods, interfaces, types… detected via AST ([ts-morph](https://ts-morph.com)), not plain text: only what the diff physically touched counts.
- **Real consumers** — every active usage of the modified symbols, with file, line and snippet. A pure `import` executes nothing and doesn't count as impact.
- **Blast radius** — every file reached through the dependency graph (barrel files included), grouped by cascade level.
- **Impact coverage** — what percentage of the affected areas is covered by tests, plus the exact list of those that aren't.
- **Risk score 0–100** — deterministic (same input → same score) and explainable: every point comes with its reason.

### What is blast radius?

The *blast radius* is the set of code that can be affected when you change a file: whoever imports it directly, whoever imports those, and so on down the cascade. Knowing it before merging means knowing exactly where to look and which tests to run — instead of finding out through a bug report.

## Installation

```bash
npm install -g impactwave   # or run it without installing:
npx impactwave
```

Requirements: Node ≥ 22.12, a local Git repository and a TypeScript/JavaScript project.

## Usage

Run it at the root of your project:

```bash
cd my-project
impactwave
```

> `analyze` is the default command: `impactwave` and `impactwave analyze` are equivalent. Only **committed** changes are analyzed (`base..HEAD`); uncommitted working-tree edits are not included.

```text
$ impactwave --help

ImpactWave answers one question before you merge:

  "What can I break with this change, and what should I test?"

It combines your Git diff with AST analysis to find the exported symbols you
modified, who really consumes them, whether tests cover the affected areas,
and computes a deterministic risk score (0-100) with explainable reasons.

Usage: impactwave [options] [command]

Analyze the blast radius of your code changes before merging

Options:
  -V, --version      output the version number
  -h, --help         display help for command

Commands:
  analyze [options]  Analyze changed code impact in this repository
  help [command]     display help for command

Documentation: https://github.com/paleto30/impactwave#readme

Tip: running bare "impactwave" inside a Git repository is equivalent to
"impactwave analyze". Run "impactwave analyze --help" for options and examples.
```

### Options

| Option | Description |
|---|---|
| `-b, --base <branch>` | Base branch to compare against (auto-detection: `origin/HEAD` → `main`/`master` → `HEAD~1`) |
| `--risk-weights <json>` | Custom weights for the risk factors. See [risk model](#risk-model) |
| `--json` | Report as JSON on stdout, with a versioned contract (`meta.schemaVersion`) and a [published schema](docs/schema-v1.json). Ideal for CI |

### Examples

```bash
# HEAD against the auto-detected base branch
impactwave

# Compare against an explicit base branch
impactwave analyze -b main

# Give more weight to test coverage gaps
impactwave --risk-weights '{"callerImpact":30,"testGaps":35}'

# Score only by direct consumers of modified symbols
impactwave analyze --risk-weights '{"callerImpact":100}'

# Machine-readable output for pipelines (pure stdout, warnings on stderr)
impactwave --json | jq '.risk'

# Merge gate: fail unless the level is LOW or MEDIUM
impactwave analyze --json -b main | jq -e '.risk.level | inside("LOW|MEDIUM")' > /dev/null
```

## How it works

1. **Git**: detects the repository, the base branch and changed files (A/M/D).
2. **AST**: ts-morph extracts exports and imports of changed files, using a single project built from your root `tsconfig.json`'s `compilerOptions` plus files discovered by its own tree walk (tolerant of unreadable directories).
3. **Modified symbols**: intersects each exported symbol's line range with the diff lines.
4. **Real consumers**: `findReferences` finds the active usages of each symbol (pure imports don't count as impact).
5. **Dependency graph**: reverse and forward indexes of relative imports + transitive traversal (BFS) with depth.
6. **Test mapping**: detects `*.test.ts`/`*.spec.ts` files and maps which code they cover.
7. **Risk engine**: deterministic 0-100 score with explainable reasons.

## Risk model

Five factors with saturation thresholds. Default weights (configurable with `--risk-weights`):

| Factor | Weight | Signal |
|---|---|---|
| Caller impact | 30 | direct consumers of modified symbols (threshold 10) |
| Affected files | 20 | transitively reached files (threshold 15) |
| Dependency depth | 15 | maximum depth levels (threshold 4) |
| Test gaps | 20 | share of affected areas without tests |
| Change size | 15 | modified lines (threshold 200) |

Levels: `0-25 LOW · 26-50 MEDIUM · 51-75 HIGH · 76-100 CRITICAL`.

The factor names are the JSON keys of `--risk-weights` (all optional; omitted ones default to 0).

## The report

Every analysis prints Git context, a risk assessment with score and reasons, impact coverage, and per changed file: exported symbols (marking modified ones), downstream usages with line and snippet, cascade blast radius and related tests:

![ImpactWave example report](https://raw.githubusercontent.com/paleto30/impactwave/master/docs/img-example.png)

```
╭─ Risk Assessment ────────────────────────────────────────╮
│ 🟡 MEDIUM RISK (score: 31/100)                           │
│ Changes affect a few dependent modules. Verify them...   │
│ 4 unique dependent files at risk                         │
│ Reasons:                                                 │
│   • 4 consumers of modified symbols (12 pts)             │
│   • 4 affected files (transitive reach) (5 pts)          │
│   • Impact reaches depth 1 dependency level (4 pts)      │
│   • 1 affected area without detected tests (10 pts)      │
│   • 1 line modified                                      │
╰──────────────────────────────────────────────────────────╯
```

📖 **How to read the full report, section by section** → [docs/GUIDE.en.md](docs/GUIDE.en.md)

### Visual example

A real ImpactWave run before merging to `main`: impact analysis of a users-module refactor in a NestJS project.

![Impact analysis before merge: users-module refactor in a NestJS project](docs/impactwave.png)

> **Note**: this capture was taken during development with a utility that saves the full terminal output as an image, so part of the report's design and formatting is lost. It does not exactly represent the final report — it is just a visual example of pre-merge impact analysis; the real report renders directly in your terminal.

### JSON output for CI

`impactwave analyze --json` emits the same report as a single JSON document
on stdout (warnings go to `stderr`). The format is versioned
(`meta.schemaVersion`) and published as a [JSON Schema](docs/schema-v1.json):
within a schema version only additive changes are allowed. Symbol usages
travel unfiltered, flagged with `importOnly: true` when they are only
contract wiring (`import`, re-exports).

## Known limitations

- Compares commits; uncommitted working-tree changes are not analyzed.
- Test coverage is transitive: a test covers the files it reaches through the dependency graph within 4 hops (`DEFAULT_TEST_COVERAGE_DEPTH`, configurable per call), preventing a root-importing test from claiming coverage over the whole codebase.
- The graph only considers relative imports (no `node_modules` or path aliases).
- In monorepos with several tsconfigs, only the root one is used; source discovery walks the whole tree (skipping `node_modules`/`dist`/`build`, hidden and unreadable paths).

## Development

```bash
npm test       # test suite (node:test)
npm run build  # compile to dist/
npm run dev    # run in development
```

Fixtures in `test/fixtures/` validate the analysis against artificial projects: `simple-project` (A→B→C chain), `circular-dependencies` (X↔Y), `barrel-exports` (barrel re-exports) and `test-coverage` (services with and without tests).

To contribute: open an [issue](https://github.com/paleto30/impactwave/issues) or send a PR. Priorities and candidate improvements are documented in [docs/ROADMAP.md](docs/ROADMAP.md); the release history, in [CHANGELOG.md](CHANGELOG.md).

## License

[ISC](LICENSE)
