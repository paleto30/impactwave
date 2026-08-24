# AGENTS.md — Project conventions

Mandatory workflow for any code or docs change in this repository.

## Branching strategy

Never implement changes directly on the default branch (`master`). Every
change lives in its own branch, created from `master`, named:

```
<type>/<short-description>
```

| Type | Use for |
|---|---|
| `feature/` | new functionality |
| `fix/` | bug or wrong-behavior correction |
| `refactor/` | internal structure/design change, no behavior change |
| `docs/` | documentation only |
| `test/` | adding or modifying tests only |
| `chore/` | maintenance, config, dependencies, tooling |

Examples: `feature/add-json-output`, `fix/handle-missing-base-branch`,
`refactor/separate-report-types`.

## Change size

Small, isolated, controlled changes. One branch = one clear objective.
Do not mix unrelated features/refactors/fixes; if a task splits naturally,
split it into separate branches. Never piggyback unrelated edits onto a
branch "since we're already there".

## Commits

Small and coherent. Each commit is one logical unit of change with a clear,
descriptive message (conventional-commit style: `feat:`, `fix:`,
`docs:`, `chore:`, `refactor:`, `test:`).

## Workflow before touching files

1. Identify the change type → pick the branch name.
2. Create the branch from `master`.
3. Make only the changes related to that objective.
4. Verify the project still works (build + tests).
5. Commit in small logical units.
6. Push the branch to origin.

## Pull requests

Every branch ends in a PR toward `master`. The PR must be small,
understandable and reviewable — one objective per PR.
