import path from "node:path";
import { getProject } from "../project.js";
import { findTransitiveFiles } from "../graph/dependency.js";
import type { DependencyGraph } from "../graph/dependency-graph.interface.js";
import { buildDependencyGraph } from "../graph/dependency.js";
import type { TestMapping } from "./test-mapping.interface.js";

/**
 * Maximum import-hop distance credited as test coverage.
 *
 * Why a binary cutoff (and why 4):
 * - Symmetry with the risk engine: DEPENDENCY_DEPTH_THRESHOLD = 4 already
 *   saturates risk by dependency depth — reach beyond 4 hops adds no risk
 *   points, so it must not add coverage credit either.
 * - In layered projects, real execution paths rarely exceed a handful of
 *   hops; beyond that, reachability is dominated by barrel/index chains,
 *   where one root-importing test would claim to cover the whole codebase
 *   (the false positive this cap exists to prevent).
 * - Weighted decay was considered and rejected: every downstream metric
 *   (coverage %, uncovered counts feeding testGaps) needs binary
 *   membership, so decay would only add fuzziness without removing the
 *   need for a threshold.
 *
 * Configurable per call site for teams with deeper coupling conventions.
 */
export const DEFAULT_TEST_COVERAGE_DEPTH = 4;

/**
 * Determines whether a path corresponds to a test file (name-based).
 */
export function isTestFile(filePath: string): boolean {
    return /\.(test|spec)\.(ts|tsx|js|jsx)$/i.test(filePath);
}

/**
 * Builds the mapping test -> covered code.
 *
 * A test file "covers" a production file when the file is reachable from
 * the test through the shared dependency graph within
 * DEFAULT_TEST_COVERAGE_DEPTH hops (configurable). The graph's forward
 * edges include dynamic loads, so tests exercising modules via
 * `await import(...)` are mapped too. Transitive coverage reuses the ONE
 * graph traversal (findTransitiveFiles) instead of duplicating logic;
 * its visited set makes cycles harmless.
 */
export function buildTestMapping(
    projectRoot: string,
    graph?: DependencyGraph,
    maxDepth: number = DEFAULT_TEST_COVERAGE_DEPTH
): TestMapping {
    const dependencyGraph = graph ?? buildDependencyGraph(projectRoot);
    const project = getProject(projectRoot);
    const coverage = new Map<string, string[]>();
    const testFiles: string[] = [];

    for (const sourceFile of project.getSourceFiles()) {
        const filePath = path.relative(projectRoot, sourceFile.getFilePath());
        if (!isTestFile(filePath)) continue;

        testFiles.push(filePath);

        const reachable = findTransitiveFiles(dependencyGraph, filePath, "imports", {
            maxDepth
        });

        for (const coveredFile of reachable.files) {
            const list = coverage.get(coveredFile) ?? [];
            if (!list.includes(filePath)) list.push(filePath);
            coverage.set(coveredFile, list);
        }
    }

    return { testFiles, coverage };
}

/**
 * Returns the test files that cover a file: directly importing it or
 * reaching it transitively through the dependency graph within the
 * configured depth.
 */
export function getRelatedTests(mapping: TestMapping, filePath: string): string[] {
    return mapping.coverage.get(filePath) ?? [];
}
