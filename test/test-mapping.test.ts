import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildTestMapping, getRelatedTests, isTestFile } from "../src/engine/testing/test-mapping.js";
import { computeImpactCoverage } from "../src/engine/testing/impact-coverage.js";
import { analyzeFile } from "../src/engine/parser/parser.js";
import { buildDependencyGraph } from "../src/engine/graph/dependency.js";

const COVERAGE = path.resolve("test/fixtures/test-coverage");
const SIMPLE = path.resolve("test/fixtures/simple-project");
const TRANSITIVE = path.resolve("test/fixtures/test-coverage-transitive");

describe("test mapping", () => {
    it("detects test files by name", () => {
        assert.ok(isTestFile("PaymentService.test.ts"));
        assert.ok(isTestFile("foo.spec.tsx"));
        assert.ok(!isTestFile("PaymentService.ts"));
        assert.ok(!isTestFile("PaymentService.test.tsx.js"));
    });

    it("detects all test files in the fixture", () => {
        const mapping = buildTestMapping(COVERAGE);
        assert.deepEqual(
            mapping.testFiles.sort(),
            ["payment/CheckoutService.test.ts", "payment/PaymentService.test.ts"]
        );
    });

    it("maps tests to the files they import", () => {
        const mapping = buildTestMapping(COVERAGE);

        const paymentTests = getRelatedTests(mapping, "payment/PaymentService.ts");
        assert.ok(paymentTests.includes("payment/PaymentService.test.ts"));
        assert.ok(paymentTests.includes("payment/CheckoutService.test.ts"));

        const checkoutTests = getRelatedTests(mapping, "payment/CheckoutService.ts");
        assert.ok(checkoutTests.includes("payment/CheckoutService.test.ts"));

        const invoiceTests = getRelatedTests(mapping, "payment/InvoiceService.ts");
        assert.deepEqual(invoiceTests, [], "InvoiceService has no tests");
    });

    it("computes impact coverage over affected files", () => {
        const mapping = buildTestMapping(COVERAGE);

        const coverage = computeImpactCoverage(
            [
                "payment/CheckoutService.ts",
                "payment/InvoiceService.ts",
                "payment/PaymentService.test.ts",
                "payment/CheckoutService.test.ts"
            ],
            mapping
        );

        assert.equal(coverage.affected, 2, "test files are not counted as affected areas");
        assert.equal(coverage.covered, 1);
        assert.equal(coverage.uncovered, 1);
        assert.deepEqual(coverage.uncoveredFiles, ["payment/InvoiceService.ts"]);
        assert.equal(coverage.percentage, 50);
    });

    it("returns 0% coverage when nothing is covered", () => {
        const mapping = buildTestMapping(COVERAGE);
        const coverage = computeImpactCoverage(["payment/InvoiceService.ts"], mapping);
        assert.equal(coverage.percentage, 0);
        assert.equal(coverage.covered, 0);
    });

    it("excludes pure-contract files from the coverage metric when analyzed", () => {
        const mapping = buildTestMapping(COVERAGE);
        const analyses = new Map([
            [
                "payment/OrderStatus.interface.ts",
                analyzeFile(path.join(COVERAGE, "payment/OrderStatus.interface.ts"))
            ]
        ]);

        const coverage = computeImpactCoverage(
            ["payment/InvoiceService.ts", "payment/OrderStatus.interface.ts"],
            mapping,
            analyses
        );

        assert.equal(coverage.affected, 1, "interface-only files are not affected areas");
        assert.deepEqual(coverage.uncoveredFiles, ["payment/InvoiceService.ts"]);
        assert.equal(coverage.percentage, 0);
    });

    it("counts arrow-function consts as testable areas", () => {
        const mapping = buildTestMapping(COVERAGE);
        const analyses = new Map([
            ["D.ts", analyzeFile(path.join(SIMPLE, "D.ts"))],
            ["E.ts", analyzeFile(path.join(SIMPLE, "E.ts"))]
        ]);

        const coverage = computeImpactCoverage(["D.ts", "E.ts"], mapping, analyses);

        assert.equal(coverage.affected, 2, "arrow function consts are executable logic");
    });

    it("excludes const-only files from the coverage metric", () => {
        const mapping = buildTestMapping(COVERAGE);
        const analyses = new Map([
            [
                "src/engine/risk/risk.constants.ts",
                analyzeFile(path.resolve("src/engine/risk/risk.constants.ts"))
            ]
        ]);

        const coverage = computeImpactCoverage(
            ["src/engine/risk/risk.constants.ts"],
            mapping,
            analyses
        );

        assert.equal(coverage.affected, 0, "plain constants are not testable areas");
    });
});

describe("transitive test coverage", () => {
    // chain.test.ts imports m0; m0 -> m1 -> m2 -> m3 -> m4 -> m5.
    // Hop distance from the test: m0=1, m1=2 ... m5=6.
    it("covers files reached transitively through the dependency graph", () => {
        const mapping = buildTestMapping(TRANSITIVE);

        for (const file of ["m0.ts", "m1.ts", "m2.ts", "m3.ts"]) {
            assert.ok(
                getRelatedTests(mapping, file).includes("chain.test.ts"),
                `${file} is within the coverage depth and must be covered`
            );
        }
    });

    it("stops claiming coverage beyond the default depth cap", () => {
        // m4 (hop 5) and m5 (hop 6) exceed DEFAULT_TEST_COVERAGE_DEPTH = 4:
        // a test importing the root of a long barrel chain must not claim
        // to cover the whole codebase.
        const mapping = buildTestMapping(TRANSITIVE);

        assert.deepEqual(getRelatedTests(mapping, "m4.ts"), []);
        assert.deepEqual(getRelatedTests(mapping, "m5.ts"), []);
    });

    it("honors a configurable depth limit", () => {
        const deep = buildTestMapping(TRANSITIVE, undefined, 6);
        assert.deepEqual(
            getRelatedTests(deep, "m5.ts"),
            ["chain.test.ts"],
            "with maxDepth 6 the whole chain is reachable"
        );
    });

    it("terminates and stays correct on import cycles", () => {
        const mapping = buildTestMapping(TRANSITIVE);

        assert.ok(getRelatedTests(mapping, "p.ts").includes("cycle.test.ts"));
        assert.ok(getRelatedTests(mapping, "q.ts").includes("cycle.test.ts"));
    });

    it("counts coverage through dynamic imports in test files", () => {
        const mapping = buildTestMapping(TRANSITIVE);

        assert.ok(
            getRelatedTests(mapping, "helper.ts").includes("dyn.test.ts"),
            "the dynamic edge test -> helper is part of the graph"
        );
        assert.ok(
            getRelatedTests(mapping, "target.ts").includes("dyn.test.ts"),
            "target is reached statically from helper"
        );
    });

    it("keeps direct-only mappings when reusing an externally built graph", () => {
        // analyze.ts builds one graph and passes it in; this guards the
        // explicit-graph path against silently rebuilding something else.
        const graph = buildDependencyGraph(TRANSITIVE);
        const mapping = buildTestMapping(TRANSITIVE, graph);

        assert.ok(getRelatedTests(mapping, "m3.ts").includes("chain.test.ts"));
    });
});