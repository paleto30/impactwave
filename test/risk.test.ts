import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyRisk, evaluateRisk } from "../src/engine/risk/risk.js";
import { parseRiskWeights } from "../src/engine/risk/risk.weights.js";

const zeroFactors = {
    uniqueConsumers: 0,
    transitiveFiles: 0,
    maxDepth: 0,
    affectedComponents: 0,
    uncoveredComponents: 0,
    changedLines: 0
};

describe("risk classification", () => {
    it("maps score to the four levels", () => {
        assert.equal(classifyRisk(0), "LOW");
        assert.equal(classifyRisk(25), "LOW");
        assert.equal(classifyRisk(26), "MEDIUM");
        assert.equal(classifyRisk(50), "MEDIUM");
        assert.equal(classifyRisk(51), "HIGH");
        assert.equal(classifyRisk(75), "HIGH");
        assert.equal(classifyRisk(76), "CRITICAL");
        assert.equal(classifyRisk(100), "CRITICAL");
    });
});

describe("risk evaluation", () => {
    it("returns 0 and LOW with no impact signals", () => {
        const assessment = evaluateRisk(zeroFactors);
        assert.equal(assessment.score, 0);
        assert.equal(assessment.level, "LOW");
        assert.deepEqual(assessment.reasons, [
            { label: "No impacted consumers detected", points: 0 }
        ]);
    });

    it("scores test gaps proportionally to uncovered areas", () => {
        const assessment = evaluateRisk({
            ...zeroFactors,
            affectedComponents: 4,
            uncoveredComponents: 2
        });
        // testGaps weight 20, half uncovered -> 10 points
        assert.equal(assessment.score, 10);
        assert.equal(assessment.level, "LOW");
        assert.ok(assessment.reasons.some(r =>
            r.label === "2 affected areas without detected tests"
        ));
    });

    it("saturates to CRITICAL with heavy signals", () => {
        const assessment = evaluateRisk({
            uniqueConsumers: 50,
            transitiveFiles: 60,
            maxDepth: 10,
            affectedComponents: 6,
            uncoveredComponents: 6,
            changedLines: 1000
        });
        assert.equal(assessment.score, 100);
        assert.equal(assessment.level, "CRITICAL");
    });

    it("respects custom weights", () => {
        const assessment = evaluateRisk(
            {
                ...zeroFactors,
                uniqueConsumers: 10,
                changedLines: 100
            },
            { callerImpact: 70, affectedFiles: 0, dependencyDepth: 0, testGaps: 0, changeSize: 0 }
        );
        // callerImpact saturated (10 consumers) -> 70 points
        assert.equal(assessment.score, 70);
        assert.equal(assessment.level, "HIGH");
    });

    it("never exceeds 100", () => {
        const assessment = evaluateRisk({
            uniqueConsumers: 100,
            transitiveFiles: 100,
            maxDepth: 20,
            affectedComponents: 10,
            uncoveredComponents: 10,
            changedLines: 10000
        });
        assert.ok(assessment.score <= 100);
    });
});

describe("testCallerImpact factor", () => {
    it("keeps the legacy score when testCallerImpact is not configured", () => {
        // 1 production + 2 test consumers = 3 total, weight 30,
        // threshold 10 -> min(3/10,1)*30 = 9 points (exactly pre-fix)
        const legacy = evaluateRisk(
            { ...zeroFactors, uniqueConsumers: 3, testConsumers: 2 },
            { callerImpact: 30, affectedFiles: 0, dependencyDepth: 0, testGaps: 0, changeSize: 0 }
        );
        const noTestField = evaluateRisk(
            { ...zeroFactors, uniqueConsumers: 3 },
            { callerImpact: 30, affectedFiles: 0, dependencyDepth: 0, testGaps: 0, changeSize: 0 }
        );
        assert.equal(legacy.score, 9);
        assert.equal(noTestField.score, 9);
        assert.ok(legacy.reasons.some(r => r.label === "3 consumers of modified symbols"),
            "legacy mode keeps the historical reason label");
    });

    it("splits production and test consumers when configured", () => {
        // callerImpact 30 on 1 production consumer -> 3 points;
        // testCallerImpact 15 on 2 test consumers -> round(min(2/10,1)*15)=3
        const assessment = evaluateRisk(
            { ...zeroFactors, uniqueConsumers: 3, testConsumers: 2 },
            {
                callerImpact: 30,
                affectedFiles: 0,
                dependencyDepth: 0,
                testGaps: 0,
                changeSize: 0,
                testCallerImpact: 15
            }
        );
        assert.equal(assessment.score, 6);
        assert.ok(assessment.reasons.some(r =>
            r.label === "1 production consumer of modified symbols" && r.points === 3
        ));
        assert.ok(assessment.reasons.some(r =>
            r.label === "2 test consumers of modified symbols" && r.points === 3
        ));
    });

    it("lets testCallerImpact: 0 fully exempt tests from the score", () => {
        const assessment = evaluateRisk(
            { ...zeroFactors, uniqueConsumers: 3, testConsumers: 2 },
            {
                callerImpact: 30,
                affectedFiles: 0,
                dependencyDepth: 0,
                testGaps: 0,
                changeSize: 0,
                testCallerImpact: 0
            }
        );
        assert.equal(assessment.score, 3);
        // Consistent with every other zero-weighted factor: the reason
        // stays visible for explainability, contributing 0 points.
        const testReason = assessment.reasons.find(r =>
            r.label === "2 test consumers of modified symbols"
        );
        assert.ok(testReason);
        assert.equal(testReason.points, 0);
    });

    it("accepts testCallerImpact as a --risk-weights key", () => {
        const parsed = parseRiskWeights('{"testCallerImpact": 15}');
        assert.equal(parsed.ok, true);
    });
});