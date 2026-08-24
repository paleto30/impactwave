import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeAssessment } from "../src/engine/assessment.js";
import type { ImpactReportItem } from "../src/engine/impact-report-item.interface.js";
import type { FileStatus } from "../src/engine/git/file-status.js";
import type { TestMapping } from "../src/engine/testing/test-mapping.interface.js";

const EMPTY_MAPPING: TestMapping = { testFiles: [], coverage: new Map() };

function reportItemWithConsumers(
    consumers: { filePath: string; line: number; snippet: string }[]
): ImpactReportItem[] {
    return [
        {
            file: { path: "payment/PaymentService.ts", status: "modified" as FileStatus },
            dependents: [],
            symbolImpacts: [
                {
                    symbolName: "PaymentService",
                    filePath: "payment/PaymentService.ts",
                    consumers
                }
            ]
        }
    ];
}

const ONE_PROD_TWO_TESTS = reportItemWithConsumers([
    { filePath: "payment/CheckoutService.ts", line: 4, snippet: "this.paymentService.calculate(amount)" },
    { filePath: "payment/PaymentService.test.ts", line: 6, snippet: "service.calculate(100)" },
    { filePath: "payment/PaymentService2.test.ts", line: 7, snippet: "new PaymentService().calculate(1)" }
]);

describe("assessment caller impact split", () => {
    it("default config scores exactly like before the split (tests included)", () => {
        const assessment = computeAssessment(ONE_PROD_TWO_TESTS, EMPTY_MAPPING, 0);
        // Legacy caller points: 3 consumers -> min(3/10,1)*30 = 9;
        // plus default testGaps: 1 uncovered area of 1 -> 20 points.
        // Total 29 - identical to running the same input pre-split,
        // because without testCallerImpact configured nothing changes.
        assert.equal(assessment.uniqueDependentFiles, 3);
        assert.equal(assessment.riskAssessment.score, 29);
        const callers = assessment.riskAssessment.reasons.find(r =>
            r.label === "3 consumers of modified symbols"
        );
        assert.ok(callers, "legacy label preserved");
        assert.equal(callers.points, 9);
    });

    it("with testCallerImpact enabled the breakdown separates production and tests", () => {
        const assessment = computeAssessment(
            ONE_PROD_TWO_TESTS,
            EMPTY_MAPPING,
            0,
            {
                callerImpact: 30,
                affectedFiles: 0,
                dependencyDepth: 0,
                testGaps: 0,
                changeSize: 0,
                testCallerImpact: 15
            }
        );
        // production: min(1/10,1)*30 = 3 ; tests: round(min(2/10,1)*15) = 3
        assert.equal(assessment.riskAssessment.score, 6);
        assert.ok(assessment.riskAssessment.reasons.some(r =>
            r.label === "1 production consumer of modified symbols"
        ));
        assert.ok(assessment.riskAssessment.reasons.some(r =>
            r.label === "2 test consumers of modified symbols"
        ));
    });
});
