# ImpactWave Guide

> **English | [Español](GUIA.md)**

Developer guide: what the tool does, how to use it, and how to interpret its reports.

---

## 1. What is it?

**ImpactWave** is a CLI that analyzes code changes in a Git repository and answers the question:

> **"What can I break with this change, and what should I test?"**

To do so it combines:

- **Git**: identifies which files changed and on which lines.
- **AST** (ts-morph): understands code structure, not plain text.
- **Symbol analysis**: determines which exported functions/classes/interfaces/types/constants were **physically** modified (intersection of AST line ranges with the diff). Arrow functions assigned to `export const` count as functions.
- **Real consumers**: finds the active usages of each modified symbol (pure `import` lines do NOT count as impact).
- **Dependency graph**: which files import which files, directly and transitively.
- **Test mapping**: detects test files (`*.test.ts`, `*.spec.ts`) and which code they cover.
- **Risk engine**: a deterministic 0-100 score with explainable reasons.

## 2. How to use it

### Requirements

- A local Git repository (the tool runs inside it).
- A TypeScript/JavaScript project. A root `tsconfig.json` is optional: when present, it contributes only `compilerOptions` (path aliases, decorators, target...). File discovery always uses our own walk, which silently skips directories without read permission (e.g. Docker's `pg_data`); the tsconfig `include`/`exclude` fields are not used for scanning.

### Running

```bash
# At the root of the project to analyze:
impactwave

# 'analyze' is the default command: both forms are equivalent.
# In development (from the tool's repo):
npm run dev
```

### Options

| Option | Description |
|---|---|
| `-b, --base <branch>` | Base branch to compare against. If omitted, it is auto-detected: `origin/HEAD` → `main`/`master` → `HEAD~1`. |
| `--risk-weights <json>` | Tune the weights of the risk factors (see [2.1. Configurable risk weights](#21-configurable-risk-weights)). |

### 2.1 Configurable risk weights

`--risk-weights` accepts a JSON object with **five properties** (all optional — omitted ones default to `0`). Each one weighs a factor of the score:

| JSON property | Default weight | Signal it weighs | Saturation threshold |
|---|---|---|---|
| `callerImpact` | `30` | Direct consumers of modified symbols | 10 consumers |
| `affectedFiles` | `20` | Files reached transitively (total blast radius) | 15 files |
| `dependencyDepth` | `15` | Maximum depth of the dependency cascade | 4 levels |
| `testGaps` | `20` | Share of affected areas without tests | 100% uncovered |
| `changeSize` | `15` | Change size in modified lines | 200 lines |

**How each factor is computed:** points = weight × saturation, where saturation goes from 0 to 1 according to the threshold. Examples with default weights:

- 5 consumers → `callerImpact` = 30 × (5/10) = **15 pts**
- 40 reached files → `affectedFiles` = 20 × 1 = **20 pts** (saturated)
- 2 out of 4 affected areas without tests → `testGaps` = 20 × (2/4) = **10 pts**

**Rules:**

- Weights don't have to add up to 100: the final score is capped at 100.
- If a factor's weight is `0`, that factor contributes no points (and its reason shows none either).
- If the JSON contains unknown keys or non-numeric values, the command fails with a clear error listing the valid keys.
- The rest of the formula (thresholds and `LOW/MEDIUM/HIGH/CRITICAL` levels) is not configurable in the MVP.

**Examples:**

```bash
# Same project risk, but emphasizing test coverage:
impactwave --risk-weights '{"callerImpact":30,"affectedFiles":10,"dependencyDepth":10,"testGaps":35,"changeSize":15}'

# Only consumers matter (all other factors default to 0):
impactwave --risk-weights '{"callerImpact":100}'
```

### What it compares

The tool compares **commits** (`git diff base..HEAD`). The full flow:

1. Detects the repository and the base branch.
2. Gets the added/modified/deleted files.
3. For every non-deleted file: extracts its exports, intersects the modified lines with symbol ranges and locates the consumers of the touched symbols.
4. Builds the dependency graph and the test mapping of the project.
5. Computes risk and generates the report.

## 3. How to read the report

Real example: `PaymentService.calculate()` was modified (rate change 0.19 → 0.21). The report is divided into blocks:

```
╭──────────────────────────────────────────────────────────╮
│ 🌊 IMPACTWAVE — BLAST RADIUS REPORT                     │
╰──────────────────────────────────────────────────────────╯
```
**Header** — just identifies the report.

```
 📂 Git Context
    ├─ Branch     : main
    └─ Comparing  : HEAD vs HEAD~1
```
**Git context** — the current branch and what it was compared against (the base).

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
**Risk assessment** — the most important block:

- **Level**: `🟢 LOW` (0-25) · `🟡 MEDIUM` (26-50) · `🟠 HIGH` (51-75) · `🔴 CRITICAL` (76-100).
- **Score**: deterministic number; the same input always produces the same score.
- **Reasons**: why the change is risky, each with its points. A reason without points contributes 0. With no consumers: "No impacted consumers detected".

```
╭─ Impact Coverage ─────────────────────────────────────────╮
│ Affected components : 2                                   │
│ Covered             : 1                                   │
│ Uncovered           : 1                                   │
│ Impact coverage     : 50%                                 │
│ Uncovered:                                                │
│   ✗ payment/InvoiceService.ts                             │
╰──────────────────────────────────────────────────────────╯
```
**Impact coverage** — key metric (different from the project's global test coverage):

- **Affected components**: affected production files (test files don't count as areas).
- **Impact coverage**: % of those areas that have at least one test importing them. Files exporting only contracts or constants (interfaces/types/enums, no functions, classes nor behavioral constants) are untestable by design and stay out of the metric.
- **Uncovered**: affected files **without tests** — they are exactly what you should test.

```
╭──────────────────────────────────────────────────────────╮
│ 📄 [MODIFIED] payment/PaymentService.ts                  │
╰──────────────────────────────────────────────────────────╯
```
**File** — one block per changed file. Status can be `[MODIFIED]`, `[ADDED]` or `[DELETED]`.

```
    ├─ Exported symbols
    │    └─ ✏️  PaymentService (class, 1 method) (2 lines modified)
    │          └─ ✏️  calculate method modified
    │    └─ Invoice (interface)
```
**Exported symbols** — what the file exposes to the rest of the project. For each symbol touched by the diff:

- **✏️** — the symbol was touched by the diff (not the whole file: only declarations whose lines changed).
- **`(N lines modified)`** — how many diff lines fall inside that symbol's declaration.
- **Methods as a subtree** — in classes, each modified **public** method is listed as a child node of the symbol (`✏️  method method modified`). Private/protected methods are not listed: they are not part of the surface other files can consume.

Symbols without ✏️ exist in the file but were not touched by this change.

```
    ├─ Detailed Downstream Usages
    │    ├─ 📂 Affected File: payment/CheckoutService.ts
    │         ├─ 🔸 Target Symbol: PaymentService (Line 4)
    │         │        💻 Code snippet : "constructor(...paymentService: PaymentService) {}"
    │         └─ 🔸 Target Symbol: PaymentService.calculate (Line 7)
    │                💻 Code snippet : "return this.paymentService.calculate(amount);"
```
**Downstream usages** — the **active** consumers of the modified symbol, with file, line and usage snippet. Useful for auditing every touch point of the change. Pure `import` lines are omitted (an import executes nothing).

Two granularity levels are shown: `PaymentService` lists references to the **class** (constructor injection, type annotations) and `PaymentService.calculate` lists the **call sites of the specific modified method** (`service.calculate(...)`). Barrel file re-exports (`export { X } from`) also count as edges: the real consumer appears even when it imports only through an `index.ts`.

```
    ├─ Files in blast radius (imported by ↓) (1 direct, 3 total, depth 3)
    │    ├─ Level 1
    │    │     └─ payment/index.ts
    │    ├─ Level 2
    │    │     └─ checkout/CheckoutService.ts
    │    └─ Level 3
    │          └─ app.controller.ts
```
**Blast radius** — all files that **import the changed file** (`imported by ↓` marks the direction: these files consume what this file exports, not the other way around). It is **static/potential** dependency: transitive reach appears as `(X direct, Y total, depth Z)` and files are grouped by **cascade level**: `Level 1` imports the changed file directly, `Level 2` imports someone from `Level 1`, and so on.

This block is informational: real risk is NOT computed from it, but from real symbol usages (previous block).

> **Note on cycles**: if two files import each other (e.g. a controller importing the service for injection, and the service importing DTOs/interfaces declared inside the controller), each card will list the other in its blast radius — both entries are correct. To remove that noise, extract shared types into their own file (e.g. `withdraws.dto.ts`).

```
    └─ Related Tests
         ├─ ✓ payment/CheckoutService.test.ts
         └─ ✓ payment/PaymentService.test.ts
```
**Related tests** — the test files covering this file (✓), or the warning (✗) if none does.

```
╭─ Analysis Summary ───────────────────────────────────────╮
│ Files analyzed       : 1                                  │
│ Test files detected  : 2                                  │
│ Tests on affected    : 1                                  │
│ Dependent files      : 4                                  │
│ Risk level           : 🟡 MEDIUM RISK                     │
│ Impact coverage      : 50%                                │
╰──────────────────────────────────────────────────────────╯
```
**Summary** — analysis totals.

```
 💡 Recommended Action
    Run tests covering the dependent files listed above...
    ⚠️  These affected areas have no detected tests:
    ├─ payment/InvoiceService.ts
    └─ Consider adding tests before merging.
```
**Recommended action** — what to do with the information: run the tests of the affected areas and, if there are zones without tests, write them before merging.

## 4. Quick interpretation

| Signal | Meaning |
|---|---|
| ✏️ `(modified)` on a symbol | The symbol was touched by the diff |
| `(N lines modified)` on a symbol | How many diff lines fall inside its declaration |
| `✏️  method method modified` (under the class) | Concrete class method touched by the diff (public only) |
| High `score` + `CRITICAL` | Change in heavily consumed code, low coverage or great depth |
| Low `Impact coverage` | Affected areas are not covered by tests — real risk may be higher than the global score |
| File under "Uncovered" | Affected area without tests → candidate for writing tests |
| `Blast radius (imported by ↓)` | The listed files import the changed one; if your file also imports them, it's a cycle |
| `Blast radius (X direct, Y total, depth Z)` | Dependency propagates in cascade (Z levels) |
| "No impacted consumers detected" | Change without consumers → low risk by default |

## 5. Known limitations

- Compares commits; **uncommitted** working tree changes are not analyzed.
- Test coverage is based on **direct** imports of test files (not transitive).
- The graph only considers relative imports (no `node_modules` nor non-relative path aliases).
- "Modified symbol" granularity is the top-level declaration; within classes, the report also lists the concrete modified public methods (private/protected ones are not reported).
- **In monorepos**: the analysis always covers `<root>/src/**/*.ts`. If the project has code outside `src/` (e.g. `packages/`, `app/`, per-workspace tsconfigs), those files are not loaded and their symbols don't appear in the report. Full monorepo support (multiple tsconfigs and arbitrary directories) is planned in `ROADMAP.md` as future work, outside the MVP scope.
- **Unreadable directories**: folders without read permission (e.g. Docker's `pg_data`) are silently skipped; they never abort the analysis.

## 6. More information

- [README.en.md](../README.en.md) — project overview (also in [Spanish](../README.md)).
- `test/fixtures/` — sample projects used by the test suite (`npm test`).
