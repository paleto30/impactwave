import type { SimpleGit } from "simple-git";
import {
    branchExists,
    detectBaseBranch,
    detectRepo,
    getChangedFiles,
    getModifiedLines
} from "./git/detect.js";
import { FileStatus } from "./git/file-status.js";
import { analyzeFile, getExportedSymbolNames } from "./parser/parser.js";
import type { FileAnalysis } from "./parser/file-analysis.interface.js";
import { buildDependencyGraph } from "./graph/dependency.js";
import { computeAssessment, generateReport } from "./assessment.js";
import { buildTestMapping } from "./testing/test-mapping.js";
import { parseRiskWeights } from "./risk/risk.weights.js";
import type { RiskWeights } from "./risk/risk.types.js";
import { SymbolAnalyzer } from "./analyzer/symbol-analyzer.js";
import type { SymbolImpact } from "./analyzer/symbol-impact.interface.js";
import type { ImpactReportItem } from "./impact-report-item.interface.js";
import type { ChangedFile } from "./git/changed-file.interface.js";
import { getProject } from "./project.js";
import type { TsConfigWarning } from "./tsconfig-compiler-options.js";
import { isImportOnlyUsage } from "./analyzer/usage-filter.js";
import { buildExportedSymbolsView } from "./reporter/symbols-view.js";
import type {
    AnalysisResult,
    AnalysisWarning,
    ChangedFileReport,
    ConsumerUsageJson
} from "./analysis-result.interface.js";
import { ANALYSIS_SCHEMA_VERSION } from "./analysis-result.interface.js";

/**
 * Facade over the whole analysis pipeline: git context -> diff -> AST ->
 * consumers -> risk. Presentation-free by contract: nothing here prints;
 * callers render the returned AnalysisResult however they need (console,
 * JSON, future API) and route warnings to their channel of choice.
 */

export class AnalyzeError extends Error {
    constructor(
        public readonly code:
            | "not-a-git-repo"
            | "unknown-base-branch"
            | "invalid-risk-weights",
        message: string
    ) {
        super(message);
        this.name = "AnalyzeError";
    }
}

export interface AnalyzeOptions {
    projectRoot: string;
    /** npm package version, injected so this module stays meta-free. */
    version: string;
    base?: string;
    riskWeights?: RiskWeights;
    /** Raw JSON weights (--risk-weights); validated before any heavy work. */
    rawRiskWeights?: string;
    onWarning?: (warning: AnalysisWarning) => void;
}

interface ChangedFileAnalysis {
    analysis: FileAnalysis;
    modifiedLines: Set<number>;
    modifiedSymbols: Set<string>;
    modifiedSymbolLineCounts?: Map<string, number>;
    modifiedClassMethods?: Map<string, string[]>;
    symbolImpacts: SymbolImpact[];
}

/**
 * Resolves the candidate base branch: explicit option, auto-detection,
 * or a HEAD~1 fallback (surfaced as a warning, never silent).
 */
async function resolveBaseBranch(
    git: SimpleGit,
    requested: string | undefined,
    warnings: AnalysisWarning[]
): Promise<string> {
    if (requested) return requested;

    const detected = await detectBaseBranch(git);
    if (detected) return detected;

    warnings.push({
        code: "base-branch-fallback",
        message:
            "Could not determine an automatic base branch. Using 'HEAD~1' by default."
    });
    return "HEAD~1";
}

/**
 * Analyzes every non-deleted changed file: exported symbols, modified
 * lines, physically modified symbols/methods and their real consumers.
 *
 * Only the file parse is guarded: unparseable/binary files are counted as
 * skipped. Any other failure is an internal bug and must surface.
 */
async function collectChangedFileAnalyses(
    git: SimpleGit,
    baseBranch: string,
    changedFiles: ChangedFile[],
    symbolAnalyzer: SymbolAnalyzer,
    projectRoot: string
): Promise<{
    analyses: Map<string, FileAnalysis>;
    changedFileAnalyses: Map<string, ChangedFileAnalysis>;
    skippedFiles: number;
}> {
    const analyses = new Map<string, FileAnalysis>();
    const changedFileAnalyses = new Map<string, ChangedFileAnalysis>();
    let skippedFiles = 0;

    for (const file of changedFiles) {
        if (file.status === FileStatus.Deleted) continue;

        let analysis: FileAnalysis;
        try {
            analysis = analyzeFile(file.path, projectRoot);
        } catch {
            // Non-parseable or binary file: skip silently
            skippedFiles++;
            continue;
        }

        analyses.set(file.path, analysis);

        const exportedSymbols = getExportedSymbolNames(analysis);
        if (exportedSymbols.length === 0) continue;

        const modifiedLines = await getModifiedLines(git, baseBranch, "HEAD", file.path);

        // Which symbols were physically touched in this file
        const modifiedSymbols = symbolAnalyzer.getModifiedSymbolNames(
            file.path,
            exportedSymbols,
            modifiedLines
        );

        // How many lines were modified per symbol
        const modifiedSymbolLineCounts = symbolAnalyzer.getModifiedSymbolLineCounts(
            file.path,
            exportedSymbols,
            modifiedLines
        );

        // Which methods were modified per class
        const modifiedClassMethods = symbolAnalyzer.getModifiedClassMethods(
            file.path,
            analysis,
            modifiedLines
        );

        // KEY FILTER: only analyze the impact if at least one symbol changed
        const symbolImpacts = modifiedSymbols.size > 0
            ? symbolAnalyzer.analyzeSymbolImpact(
                file.path,
                Array.from(modifiedSymbols),
                modifiedLines
            )
            : [];

        // Class-level references miss call sites like "service.calculate()";
        // method-level impacts add the consumers of each modified method.
        const methodImpacts = symbolAnalyzer.getModifiedMethodImpacts(
            file.path,
            modifiedClassMethods
        );

        changedFileAnalyses.set(file.path, {
            analysis,
            modifiedLines,
            modifiedSymbols,
            modifiedSymbolLineCounts,
            modifiedClassMethods,
            symbolImpacts: [...symbolImpacts, ...methodImpacts]
        });
    }

    return { analyses, changedFileAnalyses, skippedFiles };
}

/**
 * Links the per-file analysis data to its report item.
 */
function wireReportData(
    reportItems: ImpactReportItem[],
    changedFileAnalyses: Map<string, ChangedFileAnalysis>,
    testCoverage: Map<string, string[]>
): void {
    reportItems.forEach(item => {
        const changed = changedFileAnalyses.get(item.file.path);
        item.symbolImpacts = changed?.symbolImpacts ?? [];
        item.modifiedSymbolNames = changed?.modifiedSymbols ?? new Set<string>();
        item.modifiedSymbolLineCounts = changed?.modifiedSymbolLineCounts ?? new Map();
        item.modifiedClassMethods = changed?.modifiedClassMethods ?? new Map();
        item.relatedTests = testCoverage.get(item.file.path) ?? [];
    });
}

/**
 * Total number of modified lines across all analyzed changed files.
 */
function collectChangedLines(changedFileAnalyses: Map<string, ChangedFileAnalysis>): number {
    return Array.from(changedFileAnalyses.values())
        .reduce((acc, file) => acc + file.modifiedLines.size, 0);
}

/**
 * Surfaces dynamic imports whose argument is not statically resolvable
 * (template literals with variables, concatenation...). The dependency
 * graph records them; here they become an explicit warning instead of a
 * silent blind spot in the blast radius.
 *
 * Deterministic: files sorted alphabetically, at most 5 listed.
 */
function warnUnresolvedDynamicImports(
    counts: Map<string, number>,
    emitWarning: (warning: AnalysisWarning) => void
): void {
    if (counts.size === 0) return;

    const entries = Array.from(counts.entries())
        .sort(([a], [b]) => a.localeCompare(b));
    const totalImports = entries.reduce((acc, [, count]) => acc + count, 0);

    const MAX_LISTED_FILES = 5;
    const listed = entries
        .slice(0, MAX_LISTED_FILES)
        .map(([file, count]) => `${file} (${count})`)
        .join(", ");
    const remainingFiles = entries.length - MAX_LISTED_FILES;

    emitWarning({
        code: "unresolved-dynamic-imports",
        message:
            `${totalImports} dynamic import${totalImports === 1 ? "" : "s"} with ` +
            `non-static arguments could not be resolved across ${entries.length} ` +
            `file${entries.length === 1 ? "" : "s"}: ${listed}` +
            `${remainingFiles > 0 ? `, and ${remainingFiles} more` : ""}. ` +
            "Their targets are excluded from the dependency graph."
    });
}

function toChangedFileReport(item: ImpactReportItem): ChangedFileReport {
    const symbolsView = item.analysis
        ? buildExportedSymbolsView(item.analysis)
        : [];

    const exportedSymbols = item.analysis
        ? symbolsView.map(symbol => {
            const modified = item.modifiedSymbolNames?.has(symbol.name) ?? false;
            const linesModified = item.modifiedSymbolLineCounts?.get(symbol.name);
            const modifiedMethods =
                modified && symbol.kind === "class"
                    ? item.modifiedClassMethods?.get(symbol.name)
                    : undefined;

            return {
                name: symbol.name,
                kind: symbol.kind,
                ...(symbol.methodCount !== undefined
                    ? { methodCount: symbol.methodCount }
                    : {}),
                modified,
                ...(linesModified !== undefined && linesModified > 0
                    ? { linesModified }
                    : {}),
                ...(modifiedMethods && modifiedMethods.length > 0
                    ? { modifiedMethods }
                    : {})
            };
        })
    : undefined;

    const consumers: ConsumerUsageJson[] = (item.symbolImpacts ?? []).flatMap(
        symImpact =>
            symImpact.consumers.map(consumer => ({
                symbol: symImpact.symbolName,
                filePath: consumer.filePath,
                line: consumer.line,
                snippet: consumer.snippet,
                importOnly: isImportOnlyUsage(consumer.snippet)
            }))
    );

    const depthMapEntries = Array.from(item.transitiveImpact?.depthMap ?? []);
    const levels = depthMapEntries
        .reduce<Array<{ level: number; files: string[] }>>((acc, [file, level]) => {
            const entry = acc.find(l => l.level === level);
            if (entry) {
                entry.files.push(file);
            } else {
                acc.push({ level, files: [file] });
            }
            return acc;
        }, [])
        .map(levelGroup => ({
            level: levelGroup.level,
            files: levelGroup.files.sort()
        }))
        .sort((a, b) => a.level - b.level);

    return {
        path: item.file.path,
        status: item.file.status,
        ...(exportedSymbols !== undefined ? { exportedSymbols } : {}),
        dependents: item.dependents,
        transitive: {
            total: item.transitiveImpact?.files.length ?? item.dependents.length,
            maxDepth: item.transitiveImpact?.maxDepth ?? 1,
            levels
        },
        consumers,
        relatedTests: item.relatedTests ?? []
    };
}

/**
 * Runs the full blast-radius analysis for a project root and returns a
 * serializable result. Throws AnalyzeError for usage problems (not a repo,
 * unknown base ref, invalid weights); anything else is an internal bug.
 */
export async function analyzeProject(options: AnalyzeOptions): Promise<AnalysisResult> {
    const { projectRoot, version, base, onWarning } = options;
    const warnings: AnalysisWarning[] = [];
    const emitWarning = (warning: AnalysisWarning) => {
        warnings.push(warning);
        onWarning?.(warning);
    };

    const git = await detectRepo(projectRoot);
    if (!git) {
        throw new AnalyzeError(
            "not-a-git-repo",
            `'${projectRoot}' is not a Git repository.`
        );
    }

    // 1. Determine the candidate base branch
    const baseBranch = await resolveBaseBranch(git, base, warnings);

    // 2. Defensive validation (Fail Fast & Clear)
    const exists = await branchExists(git, baseBranch);
    if (!exists) {
        throw new AnalyzeError(
            "unknown-base-branch",
            `The base branch or reference '${baseBranch}' does not exist in this repository.`
        );
    }

    // Custom weights are validated before any expensive work runs.
    if (options.rawRiskWeights) {
        const parsed = parseRiskWeights(options.rawRiskWeights);
        if (!parsed.ok) {
            throw new AnalyzeError("invalid-risk-weights", parsed.message);
        }
        options.riskWeights = parsed.weights;
    }

    // Prime the shared Project so tsconfig warnings land in the result.
    getProject(projectRoot, (warning: TsConfigWarning) =>
        emitWarning(warning)
    );

    const changedFiles = await getChangedFiles(git, baseBranch, "HEAD");

    // 3. Symbol analyzer with a single shared AST index (high performance)
    const symbolAnalyzer = new SymbolAnalyzer(projectRoot);

    // 4. Per-file analysis: symbols, modified lines, real consumers
    const { analyses, changedFileAnalyses, skippedFiles } =
        await collectChangedFileAnalyses(git, baseBranch, changedFiles, symbolAnalyzer, projectRoot);

    // 5. Build the dependency graph and the test mapping
    const graph = buildDependencyGraph(projectRoot);
    warnUnresolvedDynamicImports(graph.unresolvedDynamicImports, emitWarning);
    const testMapping = buildTestMapping(projectRoot);

    // 6. Build the report items and link the per-file analysis data
    const reportItems = generateReport(changedFiles, analyses, graph);
    wireReportData(reportItems, changedFileAnalyses, testMapping.coverage);

    // 7. Compute the assessment (risk score, impact coverage, counts)
    const assessment = computeAssessment(
        reportItems,
        testMapping,
        collectChangedLines(changedFileAnalyses),
        options.riskWeights,
        projectRoot
    );

    const currentBranch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();

    return {
        meta: {
            version,
            schemaVersion: ANALYSIS_SCHEMA_VERSION,
            branch: currentBranch,
            base: baseBranch
        },
        warnings,
        summary: {
            filesAnalyzed: reportItems.length,
            testFilesDetected: testMapping.testFiles.length,
            testsOnAffected: assessment.testsOnAffected,
            dependentFiles: assessment.uniqueDependentFiles,
            skippedFiles
        },
        risk: assessment.riskAssessment,
        impactCoverage: assessment.impactCoverage,
        changedFiles: reportItems.map(toChangedFileReport)
    };
}
