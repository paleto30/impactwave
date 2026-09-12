import type { RiskWeights } from "./risk.types.js";
import { CALLER_IMPACT_THRESHOLD, AFFECTED_FILES_THRESHOLD, DEPENDENCY_DEPTH_THRESHOLD, CHANGE_SIZE_THRESHOLD, LOW_MAX, MEDIUM_MAX, HIGH_MAX, MAX_SCORE, DEFAULT_RISK_WEIGHTS } from "./risk.constants.js";
import type { RiskFactors, RiskReason, RiskAssessment, RiskLevel } from "./risk.types.js";

export function classifyRisk(score: number): RiskLevel {
    if (score <= LOW_MAX) return "LOW";
    if (score <= MEDIUM_MAX) return "MEDIUM";
    if (score <= HIGH_MAX) return "HIGH";
    return "CRITICAL";
}

/**
 * Evaluates the risk deterministically (§16 of the original document).
 *
 * Each factor contributes points proportional to its saturation against a
 * reference threshold, capped by its weight. Weights are configurable and
 * do NOT have to add up to 100: parseRiskWeights validates only that the
 * keys are known and the values finite numbers, and the total is capped at
 * MAX_SCORE.
 *
 *   - callerImpact: direct consumers of modified symbols (threshold 10).
 *     Legacy mode: test files count as consumers. Split mode (only when
 *     testCallerImpact is configured): callerImpact counts production
 *     consumers only, and test consumers saturate their own
 *     testCallerImpact weight with the same threshold.
 *
 *       legacy:  points = min(C / 10, 1) · w.callerImpact          (C = P + T)
 *       split:   points = min(P / 10, 1) · w.callerImpact
 *                       + min(T / 10, 1) · w.testCallerImpact
 *
 *   - affectedFiles: transitively reached files (threshold 15)
 *   - dependencyDepth: maximum impact depth levels (threshold 4)
 *   - testGaps: share of affected areas without tests
 *   - changeSize: modified lines (threshold 200)
 */
export function evaluateRisk(
    factors: RiskFactors,
    weights: RiskWeights = DEFAULT_RISK_WEIGHTS
): RiskAssessment {
    // Sanitize: partial weights (configured via JSON) are filled with 0.
    // testCallerImpact keeps undefined when absent: that absence IS the
    // legacy-mode signal, an explicit 0 is a deliberate exemption.
    const w = {
        callerImpact: weights.callerImpact ?? 0,
        affectedFiles: weights.affectedFiles ?? 0,
        dependencyDepth: weights.dependencyDepth ?? 0,
        testGaps: weights.testGaps ?? 0,
        changeSize: weights.changeSize ?? 0,
        ...(weights.testCallerImpact !== undefined
            ? { testCallerImpact: weights.testCallerImpact }
            : {})
    };

    const reasons: RiskReason[] = [];

    const splitTestCallers = w.testCallerImpact !== undefined;
    const testConsumers = Math.min(factors.testConsumers ?? 0, factors.uniqueConsumers);
    const callerBasis = splitTestCallers
        ? factors.uniqueConsumers - testConsumers
        : factors.uniqueConsumers;

    // Each factor is rounded exactly once, here, and the score is the sum of
    // those same rounded points. Explainability is then literal: the reasons
    // printed in the report always add up to the score (unless it saturates
    // at MAX_SCORE). Rounding the total separately made them disagree.
    const callerImpact = Math.round(
        Math.min(callerBasis / CALLER_IMPACT_THRESHOLD, 1) * w.callerImpact
    );
    const testCallerImpact = splitTestCallers
        ? Math.round(
            Math.min(testConsumers / CALLER_IMPACT_THRESHOLD, 1) *
            (w.testCallerImpact ?? 0)
        )
        : 0;

    if (factors.uniqueConsumers > 0 && !splitTestCallers) {
        reasons.push({
            label: `${factors.uniqueConsumers} consumer${factors.uniqueConsumers === 1 ? "" : "s"} of modified symbols`,
            points: callerImpact
        });
    } else if (callerBasis > 0 || testConsumers > 0) {
        if (callerBasis > 0) {
            reasons.push({
                label:
                    `${callerBasis} production consumer${callerBasis === 1 ? "" : "s"} of modified symbols`,
                points: callerImpact
            });
        }
        if (testConsumers > 0) {
            reasons.push({
                label: `${testConsumers} test consumer${testConsumers === 1 ? "" : "s"} of modified symbols`,
                points: testCallerImpact
            });
        }
    }

    const affectedFiles = Math.round(
        Math.min(factors.transitiveFiles / AFFECTED_FILES_THRESHOLD, 1) * w.affectedFiles
    );
    if (factors.transitiveFiles > 0) {
        reasons.push({
            label: `${factors.transitiveFiles} affected files (transitive reach)`,
            points: affectedFiles
        });
    }

    const dependencyDepth = Math.round(
        Math.min(factors.maxDepth / DEPENDENCY_DEPTH_THRESHOLD, 1) * w.dependencyDepth
    );
    if (factors.maxDepth > 0) {
        reasons.push({
            label: `Impact reaches depth ${factors.maxDepth} dependency level${factors.maxDepth === 1 ? "" : "s"}`,
            points: dependencyDepth
        });
    }

    const testGaps = factors.affectedComponents === 0
        ? 0
        : Math.round(
            (factors.uncoveredComponents / factors.affectedComponents) * w.testGaps
        );
    if (factors.uncoveredComponents > 0) {
        reasons.push({
            label: `${factors.uncoveredComponents} affected area${factors.uncoveredComponents === 1 ? "" : "s"} without detected tests`,
            points: testGaps
        });
    }

    const changeSize = Math.round(
        Math.min(factors.changedLines / CHANGE_SIZE_THRESHOLD, 1) * w.changeSize
    );
    if (factors.changedLines > 0) {
        reasons.push({
            label: `${factors.changedLines} line${factors.changedLines === 1 ? "" : "s"} modified`,
            points: changeSize
        });
    }

    if (reasons.length === 0) {
        reasons.push({ label: "No impacted consumers detected", points: 0 });
    }

    const score = Math.min(
        MAX_SCORE,
        callerImpact +
        testCallerImpact +
        affectedFiles +
        dependencyDepth +
        testGaps +
        changeSize
    );

    return { score, level: classifyRisk(score), reasons };
}