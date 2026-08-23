import type { ImpactCoverage } from "./testing/impact-coverage.interface.js";
import type { RiskAssessment } from "./risk/risk.types.js";
import type { ExportedSymbolKind } from "./reporter/symbols-view.js";

/**
 * Serializable, presentation-free view of a full analysis.
 *
 * This is the machine-facing contract of impactwave: the JSON output is a
 * direct JSON.stringify of it and nothing else. Rules for evolving it live
 * in docs/schema-v1.json + CHANGELOG.md — inside schemaVersion 1 only
 * additive changes are allowed; anything breaking bumps schemaVersion to 2.
 */

export const ANALYSIS_SCHEMA_VERSION = 1;

export interface AnalysisMeta {
    /** npm package version that produced this result. */
    version: string;
    /** Contract version of this shape (see ANALYSIS_SCHEMA_VERSION). */
    schemaVersion: number;
    branch: string;
    base: string;
}

export interface AnalysisWarning {
    /** Machine-readable identifier (e.g. "base-branch-fallback"). */
    code: string;
    message: string;
}

export interface AnalysisSummary {
    filesAnalyzed: number;
    testFilesDetected: number;
    testsOnAffected: number;
    dependentFiles: number;
    skippedFiles: number;
}

export interface ExportedSymbolJson {
    name: string;
    kind: ExportedSymbolKind;
    /** Class symbols only: total declared methods. */
    methodCount?: number;
    modified: boolean;
    linesModified?: number;
    /** Concrete public methods modified, class symbols only. */
    modifiedMethods?: string[];
}

export interface ConsumerUsageJson {
    symbol: string;
    filePath: string;
    line: number;
    snippet: string;
    /**
     * True when the usage line is contract wiring only (import/export-from)
     * rather than an active execution. Raw data: consumers are never
     * filtered out of the JSON output.
     */
    importOnly: boolean;
}

export interface ChangedFileReport {
    path: string;
    status: "added" | "modified" | "deleted" | string;
    exportedSymbols?: ExportedSymbolJson[];
    dependents: string[];
    transitive?: {
        total: number;
        maxDepth: number;
        /** Files grouped by dependency hop distance (Level cascade). */
        levels: Array<{ level: number; files: string[] }>;
    };
    /**
     * Real consumers of modified symbols, unfiltered. Import-only usages
     * are flagged instead of removed so machines can apply their own rules.
     */
    consumers?: ConsumerUsageJson[];
    relatedTests: string[];
}

export interface AnalysisResult {
    meta: AnalysisMeta;
    warnings: AnalysisWarning[];
    summary: AnalysisSummary;
    risk: RiskAssessment;
    impactCoverage: ImpactCoverage;
    changedFiles: ChangedFileReport[];
}
