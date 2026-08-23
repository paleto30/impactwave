import { FileStatus } from "../git/file-status.js";
import type { RiskLevel } from "../risk/risk.types.js";
import type { TestMapping } from "../testing/test-mapping.interface.js";
import type { ImpactCoverage } from "../testing/impact-coverage.interface.js";
import type { AssessmentResult } from "../assessment-result.interface.js";
import type { ImpactReportItem } from "../impact-report-item.interface.js";
import { isTestFile } from "../testing/test-mapping.js";
import { colors, BOX_WIDTH } from "./colors.js";
import { buildExportedSymbolsView, formatSymbolKind } from "./symbols-view.js";
import { isImportOnlyUsage } from "../analyzer/usage-filter.js";

function boxTop(label: string, color: string): void {
    console.log(`${color}╭─ ${label} ${"─".repeat(BOX_WIDTH - 5 - label.length)}╮${colors.reset}`);
}

function boxStart(color: string): void {
    console.log(`${color}╭${"─".repeat(BOX_WIDTH - 2)}╮${colors.reset}`);
}

function boxHeader(): void {
    boxStart(colors.cyan);
    console.log(`${colors.cyan}│${colors.reset} ${colors.bold}🌊 IMPACTWAVE — BLAST RADIUS REPORT${colors.reset}`);
    boxFooter(colors.cyan);
}

function boxFooter(color: string): void {
    console.log(`${color}╰${"─".repeat(BOX_WIDTH - 2)}╯${colors.reset}`);
}

const riskStyles: Record<RiskLevel, { emoji: string; description: string }> = {
    LOW: {
        emoji: "🟢",
        description: "Changes are isolated or have minimal downstream exposure."
    },
    MEDIUM: {
        emoji: "🟡",
        description: "Changes affect a few dependent modules. Verify them before proceeding."
    },
    HIGH: {
        emoji: "🟠",
        description: "Wide blast radius! Core contracts or heavily used files were altered."
    },
    CRITICAL: {
        emoji: "🔴",
        description: "Critical core changes with broad downstream exposure. Review before merging."
    }
};

export interface ReportOptions {
    gitContext?: { branch: string; base: string };
    testMapping?: TestMapping;
    assessment: AssessmentResult;
    skippedFiles?: number;
}

export function printConsoleReport(
    reportItems: ImpactReportItem[],
    options: ReportOptions
): void {
    const { gitContext, testMapping, assessment, skippedFiles = 0 } = options;

    console.log("");
    boxHeader();
    printGitContext(gitContext);
    printDescription();
    printRiskAssessment(assessment);
    printImpactCoverage(assessment.impactCoverage);

    for (const item of reportItems) {
        printFileSection(item);
    }

    printSummary(reportItems, assessment, testMapping);
    printRecommendedAction(assessment);

    if (skippedFiles > 0) {
        console.log(
            `${colors.dim}⚠️  ${skippedFiles} file(s) skipped (non-parseable or binary).${colors.reset}`
        );
    }
}

function printGitContext(gitContext?: { branch: string; base: string }): void {
    if (!gitContext) return;

    console.log("");
    console.log(` ${colors.bold}📂 Git Context${colors.reset}`);
    console.log(
        `    ${colors.gray}├─ Branch     :${colors.reset} ` +
        `${colors.bold}${gitContext.branch}${colors.reset}`
    );
    console.log(
        `    ${colors.gray}└─ Comparing  :${colors.reset} ` +
        `${colors.bold}HEAD vs ${gitContext.base}${colors.reset}`
    );
}

function printDescription(): void {
    console.log("");
    console.log(
        `${colors.dim}ℹ️  What is this? This report evaluates the downstream impact${colors.reset}`
    );
    console.log(
        `${colors.dim}   of your changes before merging or pushing code.${colors.reset}`
    );
}

function printRiskAssessment(assessment: AssessmentResult): void {
    const { riskAssessment, uniqueDependentFiles } = assessment;

    const riskLevelText = `${riskStyles[riskAssessment.level].emoji} ${riskAssessment.level} RISK`;

    console.log("");
    boxTop("Risk Assessment", colors.yellow);
    console.log(
        `${colors.yellow}│${colors.reset} ${riskLevelText} ` +
        `${colors.dim}(score: ${riskAssessment.score}/100)${colors.reset}`
    );
    console.log(
        `${colors.yellow}│${colors.reset}`
    );
    console.log(
        `${colors.yellow}│${colors.reset} ${colors.gray}${riskStyles[riskAssessment.level].description}${colors.reset}`
    );
    console.log(
        `${colors.yellow}│${colors.reset} ${colors.gray}${uniqueDependentFiles} unique dependent file${uniqueDependentFiles === 1 ? "" : "s"} at risk${colors.reset}`
    );
    console.log(
        `${colors.yellow}│${colors.reset}`
    );
    console.log(
        `${colors.yellow}│${colors.reset} ${colors.bold}Reasons:${colors.reset}`
    );
    for (const reason of riskAssessment.reasons) {
        console.log(
            `${colors.yellow}│${colors.reset}   ${colors.gray}•${colors.reset} ${reason.label}` +
            (reason.points > 0 ? ` ${colors.dim}(${reason.points} pts)${colors.reset}` : "")
        );
    }
    boxFooter(colors.yellow);
}

function printImpactCoverage(impactCoverage: ImpactCoverage): void {
    console.log("");
    boxTop("Impact Coverage", colors.blue);
    console.log(
        `${colors.blue}│${colors.reset} ` +
        `Affected components : ${colors.bold}${impactCoverage.affected}${colors.reset}`
    );
    console.log(
        `${colors.blue}│${colors.reset} ` +
        `Covered             : ${colors.green}${colors.bold}${impactCoverage.covered}${colors.reset}`
    );
    console.log(
        `${colors.blue}│${colors.reset} ` +
        `Uncovered           : ${colors.red}${colors.bold}${impactCoverage.uncovered}${colors.reset}`
    );
    console.log(
        `${colors.blue}│${colors.reset} ` +
        `Impact coverage     : ${colors.bold}${impactCoverage.affected === 0 ? "—" : `${impactCoverage.percentage}%`}${colors.reset}`
    );

    if (impactCoverage.uncoveredFiles.length > 0) {
        console.log(
            `${colors.blue}│${colors.reset}`
        );
        console.log(
            `${colors.blue}│${colors.reset} ${colors.red}${colors.bold}Uncovered:${colors.reset} (The affected files without tests — are exactly what you should test.)`
        );
        impactCoverage.uncoveredFiles.forEach(file => {
            console.log(
                `${colors.blue}│${colors.reset}   ${colors.gray}✗${colors.reset} ${colors.cyan}${file}${colors.reset}`
            );
        });
    }

    boxFooter(colors.blue);
}

function printFileSection(item: ImpactReportItem): void {
    let statusColor = colors.blue;
    let statusLabel = "MODIFIED";

    if (item.file.status === FileStatus.Added) {
        statusColor = colors.green;
        statusLabel = "ADDED";
    } else if (item.file.status === FileStatus.Deleted) {
        statusColor = colors.red;
        statusLabel = "DELETED";
    }

    console.log("");
    boxStart(colors.cyan);
    console.log(
        `${colors.cyan}│${colors.reset} ` +
        `${colors.bold}📄 [${statusColor}${statusLabel}${colors.reset}${colors.bold}] ` +
        `${item.file.path}${colors.reset}`
    );
    boxFooter(colors.cyan);

    printExportedSymbols(item);
    printDownstreamUsages(item);
    printBlastRadius(item);
    printRelatedTests(item);
}

function printExportedSymbols(item: ImpactReportItem): void {
    const symbols = item.analysis
        ? buildExportedSymbolsView(item.analysis)
        : [];

    console.log("");
    console.log(
        `    ${colors.gray}├─${colors.reset} ` +
        `${colors.bold}Exported symbols${colors.reset}`
    );

    if (symbols.length > 0) {
        symbols.forEach((sym, index) => {
            const isLast = index === symbols.length - 1;
            const prefix = isLast ? "└─" : "├─";

            const wasModified =
                item.modifiedSymbolNames?.has(sym.name) ?? false;

            const lineCount = item.modifiedSymbolLineCounts?.get(sym.name);
            const marker = wasModified
                ? `${colors.yellow}✏️  `
                : "";

            const suffix = wasModified
                ? lineCount !== undefined && lineCount > 0
                    ? ` ${colors.dim}(${lineCount} ${lineCount === 1 ? "line" : "lines"} modified)${colors.reset}`
                    : ` ${colors.dim}(modified)${colors.reset}`
                : "";

            const modifiedMethods = wasModified && sym.kind === "class"
                ? item.modifiedClassMethods?.get(sym.name)
                : undefined;

            console.log(
                `    ${colors.gray}│${colors.reset}    ` +
                `${colors.gray}${prefix}${colors.reset} ` +
                `${marker}${colors.bold}${sym.name}${colors.reset} ` +
                `${colors.dim}(${formatSymbolKind(sym)})${colors.reset}` +
                suffix
            );

            // Modified public methods render as a subtree of their class,
            // keeping the class line itself free of extra parentheses.
            if (modifiedMethods && modifiedMethods.length > 0) {
                modifiedMethods.forEach((methodName, methodIndex) => {
                    const isLastMethod =
                        methodIndex === modifiedMethods.length - 1;
                    const methodBranch = isLastMethod ? "└─" : "├─";

                    console.log(
                        `    ${colors.gray}│${colors.reset}          ` +
                        `${colors.gray}${methodBranch}${colors.reset} ` +
                        `${colors.yellow}✏️  ${colors.reset}` +
                        `${colors.bold}${methodName}${colors.reset} ` +
                        `${colors.dim}method modified${colors.reset}`
                    );
                });
            }
        });
    } else {
        console.log(
            `    ${colors.gray}│${colors.reset}    ` +
            `${colors.gray}└─ Exported symbols: None${colors.reset}`
        );
    }
}

function printDownstreamUsages(item: ImpactReportItem): void {
    console.log(
        `    ${colors.gray}│${colors.reset}`
    );

    console.log(
        `    ${colors.gray}├─${colors.reset} ` +
        `${colors.bold}Detailed Downstream Usages${colors.reset}`
    );

    if (item.symbolImpacts && item.symbolImpacts.length > 0) {
        const consumersByFile = new Map<
            string,
            {
                symbol: string;
                line: number;
                snippet: string;
            }[]
        >();

        for (const symImpact of item.symbolImpacts) {
            for (const consumer of symImpact.consumers) {
                // Omit pure import lines to avoid repetitive visual noise
                if (isImportOnlyUsage(consumer.snippet)) {
                    continue;
                }

                const usages = consumersByFile.get(consumer.filePath) ?? [];
                usages.push({
                    symbol: symImpact.symbolName,
                    line: consumer.line,
                    snippet: consumer.snippet
                });
                consumersByFile.set(consumer.filePath, usages);
            }
        }

        const entries = Array.from(consumersByFile.entries());

        if (entries.length > 0) {
            entries.forEach(([consumerFile, usages], fileIndex) => {
                const isLastFile = fileIndex === entries.length - 1;
                const filePrefix = isLastFile ? "└─" : "├─";

                console.log(
                    `    ${colors.gray}│${colors.reset}    ` +
                    `${colors.gray}${filePrefix}${colors.reset} ` +
                    `📂 Affected File: ` +
                    `${colors.cyan}${colors.bold}${consumerFile}${colors.reset}`
                );

                usages.forEach((usage, usageIndex) => {
                    const isLastUsage =
                        usageIndex === usages.length - 1;

                    const usagePrefix = isLastUsage ? "└─" : "├─";

                    console.log(
                        `    ${colors.gray}│${colors.reset}         ` +
                        `${colors.gray}${usagePrefix}${colors.reset} ` +
                        `🔸 Target Symbol: ` +
                        `${colors.bold}${usage.symbol}${colors.reset} ` +
                        `(Line ${colors.cyan}${usage.line}${colors.reset})`
                    );

                    console.log(
                        `    ${colors.gray}│${colors.reset}                ` +
                        `${colors.gray}💻 Code snippet : "${colors.reset}` +
                        `${colors.blue}${usage.snippet.trim()}${colors.reset}` +
                        `${colors.gray}"${colors.reset}`
                    );
                });
            });
        } else {
            console.log(
                `    ${colors.gray}│${colors.reset}    ` +
                `${colors.gray}└─ No active execution usages found outside of imports${colors.reset}`
            );
        }
    } else {
        console.log(
            `    ${colors.gray}│${colors.reset}    ` +
            `${colors.gray}└─ No downstream usages detected${colors.reset}`
        );
    }
}

function printBlastRadius(item: ImpactReportItem): void {
    console.log(
        `    ${colors.gray}│${colors.reset}`
    );

    /*
     * Keep the original dependency graph here because this section
     * intentionally shows the static/potential dependency information.
     * Risk Assessment above is based on REAL symbol impacts only.
     */
    const dependents = item.dependents;
    const transitive = item.transitiveImpact;

    if (dependents.length > 0) {
        // Always show the same format: direct/transitive/depth. When the
        // impact has no transitive reach, total equals direct and depth is 1.
        const reachSummary =
            ` (${dependents.length} direct, ${transitive?.files.length ?? dependents.length} total, ` +
            `depth ${transitive?.maxDepth ?? 1})`;

        console.log(
            `    ${colors.gray}├─${colors.reset} ` +
            `${colors.bold}Files in blast radius${colors.reset} ` +
            `${colors.dim}(imported by ↓)${colors.reset}` +
            `${colors.dim}${reachSummary}${colors.reset}`
        );

        const depthMap = transitive?.depthMap;
        const maxDepth = transitive?.maxDepth ?? 1;

        if (!depthMap || maxDepth <= 1) {
            // Flat list: every dependent is a direct consumer
            dependents.forEach((dep, index) => {
                const isLast = index === dependents.length - 1;
                const prefix = isLast ? "└─" : "├─";

                console.log(
                    `    ${colors.gray}│${colors.reset}    ` +
                    `${colors.gray}${prefix}${colors.reset} ` +
                    `${colors.cyan}${dep}${colors.reset}`
                );
            });
        } else {
            // Cascade tree grouped by level: L1 imports the changed file,
            // L2 imports L1, and so on (§13 Level cascade)
            for (let level = 1; level <= maxDepth; level++) {
                const filesAtLevel = Array.from(depthMap.entries())
                    .filter(([, depth]) => depth === level)
                    .map(([file]) => file)
                    .sort();

                const isLastLevel = level === maxDepth;
                const levelPrefix = isLastLevel ? "└─" : "├─";
                const childIndent = isLastLevel ? "      " : "│     ";

                console.log(
                    `    ${colors.gray}│${colors.reset}    ` +
                    `${colors.gray}${levelPrefix}${colors.reset} ` +
                    `${colors.dim}Level ${level}${colors.reset}`
                );

                filesAtLevel.forEach((file, index) => {
                    const isLastFile = index === filesAtLevel.length - 1;
                    const filePrefix = isLastFile ? "└─" : "├─";

                    console.log(
                        `    ${colors.gray}│${colors.reset}    ${colors.gray}${childIndent}` +
                        `${colors.reset}` +
                        `${colors.gray}${filePrefix}${colors.reset} ` +
                        `${colors.cyan}${file}${colors.reset}`
                    );
                });
            }
        }
    } else {
        console.log(
            `    ${colors.gray}├─${colors.reset} ` +
            `${colors.green}Files in blast radius: None (Isolated change)${colors.reset}` +
            `${colors.dim}(imported by ↓)${colors.reset}`
        );
    }
}

function printRelatedTests(item: ImpactReportItem): void {
    console.log(
        `    ${colors.gray}│${colors.reset}`
    );

    console.log(
        `    ${colors.gray}└─${colors.reset} ` +
        `${colors.bold}Related Tests${colors.reset}`
    );

    const relatedTests = item.relatedTests ?? [];

    if (relatedTests.length > 0) {
        relatedTests.forEach((testFile, index) => {
            const isLast = index === relatedTests.length - 1;
            const prefix = isLast ? "└─" : "├─";

            console.log(
                `         ${colors.gray}${prefix}${colors.reset} ` +
                `${colors.green}✓${colors.reset} ${colors.cyan}${testFile}${colors.reset}`
            );
        });
    } else if (isTestFile(item.file.path)) {
        // A test file is not a covered area: it does not need tests about
        // itself. Real relations (other tests importing it) are still shown.
        console.log(
            `         ${colors.gray}└─ ${colors.yellow}ℹ️ Test file — not counted as a covered area${colors.reset}`
        );
    } else {
        console.log(
            `         ${colors.gray}└─ ${colors.red}✗ No test covers this file${colors.reset}`
        );
    }
}

function printSummary(
    reportItems: ImpactReportItem[],
    assessment: AssessmentResult,
    testMapping?: TestMapping
): void {
    const { impactCoverage, riskAssessment, uniqueDependentFiles, testsOnAffected } = assessment;

    const riskLevelText = `${riskStyles[riskAssessment.level].emoji} ${riskAssessment.level} RISK`;

    console.log("");
    boxTop("Analysis Summary", colors.cyan);

    console.log(
        `${colors.cyan}│${colors.reset} ` +
        `Files analyzed       : ${colors.bold}${reportItems.length}${colors.reset}`
    );

    console.log(
        `${colors.cyan}│${colors.reset} ` +
        `Test files detected  : ${colors.bold}${testMapping?.testFiles.length ?? 0}${colors.reset}`
    );

    console.log(
        `${colors.cyan}│${colors.reset} ` +
        `Tests on affected    : ${colors.bold}${testsOnAffected}${colors.reset}`
    );

    console.log(
        `${colors.cyan}│${colors.reset} ` +
        `Dependent files      : ${colors.bold}${uniqueDependentFiles}${colors.reset}`
    );

    console.log(
        `${colors.cyan}│${colors.reset} ` +
        `Risk level           : ${riskLevelText}`
    );

    console.log(
        `${colors.cyan}│${colors.reset} ` +
        `Impact coverage      : ${colors.bold}${impactCoverage.affected === 0 ? "—" : `${impactCoverage.percentage}%`}${colors.reset}`
    );

    boxFooter(colors.cyan);
}

function printRecommendedAction(assessment: AssessmentResult): void {
    const { uniqueDependentFiles, impactCoverage } = assessment;

    console.log("");
    console.log(
        ` ${colors.bold}💡 Recommended Action${colors.reset}`
    );

    if (uniqueDependentFiles > 0) {
        console.log(
            `    Run tests covering the dependent files listed above`
        );
        console.log(
            `    to ensure no unexpected regressions were introduced.`
        );

        if (impactCoverage.uncoveredFiles.length > 0) {
            console.log("");
            console.log(
                `    ${colors.red}${colors.bold}⚠️  These affected areas have no detected tests:${colors.reset}`
            );
            impactCoverage.uncoveredFiles.forEach(file => {
                console.log(
                    `    ${colors.gray}├─${colors.reset} ${colors.cyan}${file}${colors.reset}`
                );
            });
            console.log(
                `    ${colors.gray}└─${colors.reset} Consider adding tests before merging.`
            );
        }
    } else {
        console.log(
            `    This change is completely safe from downstream regressions.`
        );
    }

    console.log("");
}