#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { analyzeProject, AnalyzeError } from "./engine/analyze.js";
import { printConsoleReport } from "./output/console-reporter.js";
import { printJsonReport } from "./output/json-reporter.js";

/**
 * Single source of truth for the CLI version: package.json sits one level
 * above this file both in src/ (dev, via tsx) and dist/ (published bin).
 */
const { version } = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")
) as { version: string };

const program = new Command();

program
    .name("impactwave")
    .description("Analyze the blast radius of your code changes before merging")
    .version(version)
    .addHelpText("before", `
ImpactWave answers one question before you merge:

  "What can I break with this change, and what should I test?"

It combines your Git diff with AST analysis to find the exported symbols you
modified, who really consumes them, whether tests cover the affected areas,
and computes a deterministic risk score (0-100) with explainable reasons.
`)
    .addHelpText("after", `
Documentation: https://github.com/paleto30/impactwave#readme

Tip: running bare "impactwave" inside a Git repository is equivalent to
"impactwave analyze". Run "impactwave analyze --help" for options and examples.`);

program
    .command("analyze", { isDefault: true })
    .description("Analyze the impact of your committed changes in the current Git repository (default command)")
    .summary("Analyze changed code impact in this repository")
    .option(
        "-b, --base <branch>",
        "base branch or ref to compare HEAD against " +
        '(default: auto-detected: origin/HEAD -> main/master -> HEAD~1)'
    )
    .option(
        "--json",
        "print a machine-readable JSON report to stdout (schemaVersion 1); " +
        "warnings and errors go to stderr"
    )
    .option(
        "--risk-weights <json>",
        'JSON object with custom risk factor weights; omitted keys count as 0. ' +
        "Valid keys: callerImpact, affectedFiles, dependencyDepth, testGaps, changeSize. " +
        'Defaults: {"callerImpact":30, "affectedFiles":20, "dependencyDepth":15, "testGaps":20, "changeSize":15}'
    )
    .addHelpText("after", `
Purpose:
  Analyze what your current changes could break and what you should test,
  before merging.

How it works:
  Compares HEAD against a base branch (git diff <base>..HEAD), finds which
  exported symbols were physically modified, locates their real consumers,
  traces the blast radius across the dependency graph and maps test coverage
  over the affected areas. It ends in a risk assessment: a deterministic
  score from 0 to 100 with explainable reasons.

Default behavior:
  - Without --base, the base branch is auto-detected:
      origin/HEAD -> main/master -> HEAD~1 (with a warning on fallback).
  - Only committed changes are analyzed; uncommitted working-tree edits are
    not included.
  - Prints a human-readable report to stdout and exits 0 unless there is a
    usage error (e.g. unknown base branch or invalid --risk-weights JSON).
  - With --json, stdout carries only the machine-readable document; run
    warnings/errors go to stderr. The schema is versioned independently of
    the package (meta.schemaVersion) — see docs/schema-v1.json.

Examples:
  # Analyze HEAD vs the auto-detected base branch
  $ impactwave

  # Compare against an explicit base branch
  $ impactwave analyze -b main

  # Machine-readable output for CI or piping
  $ impactwave analyze --json | jq '.risk'

  # Emphasize test coverage gaps in the score
  $ impactwave --risk-weights '{"callerImpact":30,"testGaps":35}'

Full guide: https://github.com/paleto30/impactwave/blob/main/docs/GUIA.md`)
    .action(async (options) => {
        try {
            const result = await analyzeProject({
                projectRoot: process.cwd(),
                version,
                base: options.base,
                rawRiskWeights: options.riskWeights,
                onWarning: (warning) => {
                    process.stderr.write(`[impactwave] ${warning.message}\n`);
                }
            });

            if (options.json) {
                printJsonReport(result);
            } else {
                // Console mode surfaces collected warnings on stderr first,
                // keeping stdout reserved for the report itself.
                for (const warning of result.warnings) {
                    if (warning.code !== "base-branch-fallback") continue;
                    console.error(`⚠️ ${warning.message}`);
                }
                printConsoleReport(result);
            }
        } catch (error) {
            if (error instanceof AnalyzeError) {
                const hints: Record<AnalyzeError["code"], string | undefined> = {
                    "not-a-git-repo": undefined,
                    "unknown-base-branch":
                        "💡 Tip: If you are in a shallow clone (CI), make sure to fetch the base branch.",
                    "invalid-risk-weights": undefined
                };
                console.error(`❌ Error: ${error.message}`);
                const hint = hints[error.code];
                if (hint) console.error(hint);
                process.exit(1);
            }
            throw error;
        }
    });

program.parse(process.argv);
