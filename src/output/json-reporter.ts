import type { AnalysisResult } from "../engine/analysis-result.interface.js";

/**
 * Machine-readable rendering: stdout carries ONLY the JSON document, so
 * `impactwave analyze --json | jq` works and any consumer can parse it
 * without filtering noise. Diagnostics belong to stderr (CLI's job).
 */
export function printJsonReport(result: AnalysisResult): void {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
