import type { ImpactReportItem } from "./impact-report-item.interface.js";
import type { AssessmentResult } from "./assessment-result.interface.js";
import type { ChangedFile } from "./git/changed-file.interface.js";
import { analyzeFile } from "./parser/parser.js";
import type { FileAnalysis } from "./parser/file-analysis.interface.js";
import type { DependencyGraph } from "./graph/dependency-graph.interface.js";
import { findTransitiveDependents } from "./graph/dependency.js";
import { isImportOnlyUsage } from "./analyzer/usage-filter.js";
import { computeImpactCoverage } from "./testing/impact-coverage.js";
import { isTestFile } from "./testing/test-mapping.js";
import type { TestMapping } from "./testing/test-mapping.interface.js";
import { evaluateRisk } from "./risk/risk.js";
import type { RiskWeights } from "./risk/risk.types.js";

export function generateReport(
    changedFiles: ChangedFile[],
    analyses: Map<string, FileAnalysis>,
    graph: DependencyGraph
): ImpactReportItem[] {
    const reportItems: ImpactReportItem[] = [];

    for (const file of changedFiles) {
        const dependents = graph.dependents.get(file.path) ?? [];

        reportItems.push({
            file,
            analysis: analyses.get(file.path),
            dependents,
            transitiveImpact: findTransitiveDependents(graph, file.path)
        });
    }

    return reportItems;
}

/**
 * Computes the full assessment of the change set (§15 and §16 of the
 * original document). Pure computation: no I/O, no console output — the
 * result is meant to be consumed by any formatter (console, JSON, CI).
 *
 * IMPORTANT:
 * The dependency graph represents potential/static dependencies and must NOT
 * be used to determine the actual blast radius. The actual blast radius is
 * based only on consumers of symbols that were detected as impacted. Import
 * statements are ignored because they do not represent an active
 * execution/use of the symbol.
 */
export function computeAssessment(
    reportItems: ImpactReportItem[],
    testMapping: TestMapping,
    changedLines: number,
    riskWeights?: RiskWeights,
    projectRoot: string = process.cwd()
): AssessmentResult {
    const uniqueImpactedFiles = new Set<string>();
    const testConsumerFiles = new Set<string>();

    for (const item of reportItems) {
        for (const symbolImpact of item.symbolImpacts ?? []) {
            for (const consumer of symbolImpact.consumers) {
                if (isImportOnlyUsage(consumer.snippet)) {
                    continue;
                }
                uniqueImpactedFiles.add(consumer.filePath);
                // Tests are instruments, not blast radius: when the score
                // runs in split mode (testCallerImpact configured) they
                // saturate their own weight instead of callerImpact. In
                // legacy mode this set is ignored and behavior is
                // identical to counting everything as callers.
                if (isTestFile(consumer.filePath)) {
                    testConsumerFiles.add(consumer.filePath);
                }
            }
        }
    }

    // Tests covering the affected areas (excluding test files)
    const testsCoveringAffected = new Set<string>();
    for (const file of uniqueImpactedFiles) {
        if (isTestFile(file)) continue;
        for (const test of testMapping.coverage.get(file) ?? []) {
            testsCoveringAffected.add(test);
        }
    }

    // Collect the analysis of every affected file. Changed files already
    // have one; consumers that were not changed are analyzed on demand so
    // pure-contract files (interfaces/types only) can be excluded from the
    // impact coverage metric.
    const affectedAnalyses = new Map<string, FileAnalysis>();
    for (const item of reportItems) {
        if (item.analysis) affectedAnalyses.set(item.file.path, item.analysis);
    }
    for (const file of uniqueImpactedFiles) {
        if (isTestFile(file) || affectedAnalyses.has(file)) continue;
        try {
            affectedAnalyses.set(file, analyzeFile(file, projectRoot));
        } catch {
            // Non-parseable file: keep it counted as an affected area
        }
    }

    const impactCoverage = computeImpactCoverage(
        Array.from(uniqueImpactedFiles),
        testMapping,
        affectedAnalyses
    );

    const transitiveFiles = new Set<string>();
    let maxDepth = 0;
    for (const item of reportItems) {
        for (const file of item.transitiveImpact?.files ?? []) {
            transitiveFiles.add(file);
        }
        maxDepth = Math.max(maxDepth, item.transitiveImpact?.maxDepth ?? 0);
    }

    const riskAssessment = evaluateRisk({
        uniqueConsumers: uniqueImpactedFiles.size,
        testConsumers: testConsumerFiles.size,
        transitiveFiles: transitiveFiles.size,
        maxDepth,
        affectedComponents: impactCoverage.affected,
        uncoveredComponents: impactCoverage.uncovered,
        changedLines
    }, riskWeights);

    return {
        uniqueDependentFiles: uniqueImpactedFiles.size,
        testsOnAffected: testsCoveringAffected.size,
        impactCoverage,
        riskAssessment
    };
}