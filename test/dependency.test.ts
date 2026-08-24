import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildDependencyGraph, findTransitiveDependents } from "../src/engine/graph/dependency.js";

const SIMPLE = path.resolve("test/fixtures/simple-project");
const COVERAGE = path.resolve("test/fixtures/test-coverage");
const CIRCULAR = path.resolve("test/fixtures/circular-dependencies");
const BARREL = path.resolve("test/fixtures/barrel-exports");
const DYNAMIC = path.resolve("test/fixtures/dynamic-imports");

describe("dependency graph", () => {
    it("builds the A -> B -> C chain", () => {
        const graph = buildDependencyGraph(SIMPLE);
        assert.ok(graph.dependents.get("B.ts")?.includes("A.ts"), "A.ts imports B.ts");
        assert.ok(graph.dependents.get("C.ts")?.includes("B.ts"), "B.ts imports C.ts");
        assert.equal(graph.dependents.get("A.ts"), undefined, "A.ts should have no dependents");
    });

    it("builds the forward imports index", () => {
        const graph = buildDependencyGraph(SIMPLE);
        assert.deepEqual(graph.imports.get("A.ts"), ["B.ts"]);
        assert.deepEqual(graph.imports.get("B.ts"), ["C.ts"]);
        assert.deepEqual(graph.imports.get("C.ts"), []);
    });

    it("detects consumers of PaymentService in the test-coverage fixture", () => {
        const graph = buildDependencyGraph(COVERAGE);
        const consumers = graph.dependents.get("payment/PaymentService.ts");
        assert.ok(consumers?.includes("payment/CheckoutService.ts"));
        assert.ok(consumers?.includes("payment/InvoiceService.ts"));
        assert.ok(consumers?.includes("payment/PaymentService.test.ts"));
        assert.ok(consumers?.includes("payment/CheckoutService.test.ts"));
    });

    it("treats barrel re-exports (export ... from) as edges", () => {
        const graph = buildDependencyGraph(BARREL);
        const barrelDependents = graph.dependents.get("index.ts") ?? [];
        assert.ok(
            barrelDependents.includes("checkout.controller.ts"),
            "checkout.controller.ts imports through index.ts"
        );
    });

    it("finds real consumers hidden behind a barrel file", () => {
        const graph = buildDependencyGraph(BARREL);

        const serviceDependents = graph.dependents.get("payment/payment.service.ts") ?? [];
        assert.ok(serviceDependents.includes("index.ts"), "index.ts re-exports payment.service.ts");

        const impact = findTransitiveDependents(graph, "payment/payment.service.ts");
        assert.ok(
            impact.files.includes("checkout.controller.ts"),
            "controller must appear even though it only imports the barrel"
        );
        assert.equal(impact.depthMap.get("checkout.controller.ts"), 2);
        assert.equal(impact.maxDepth, 2);
    });
});

describe("transitive dependents", () => {
    it("finds all transitive dependents with depth", () => {
        const graph = buildDependencyGraph(SIMPLE);

        const impact = findTransitiveDependents(graph, "C.ts");
        assert.deepEqual(impact.files.sort(), ["A.ts", "B.ts"]);
        assert.equal(impact.depthMap.get("B.ts"), 1);
        assert.equal(impact.depthMap.get("A.ts"), 2);
        assert.equal(impact.maxDepth, 2);

        const leafImpact = findTransitiveDependents(graph, "A.ts");
        assert.deepEqual(leafImpact.files, []);
        assert.equal(leafImpact.maxDepth, 0);
    });

    it("terminates on circular dependencies", () => {
        const graph = buildDependencyGraph(CIRCULAR);

        const impact = findTransitiveDependents(graph, "X.ts");
        assert.deepEqual(impact.files, ["Y.ts"]);
        assert.equal(impact.maxDepth, 1);

        assert.deepEqual(findTransitiveDependents(graph, "Y.ts").files, ["X.ts"]);
    });
});

describe("dynamic imports", () => {
    it("creates an edge for await import(\"./x\")", () => {
        const graph = buildDependencyGraph(DYNAMIC);
        assert.ok(
            graph.dependents.get("c.ts")?.includes("consumer-import.ts"),
            "consumer-import.ts dynamically imports c.ts"
        );
    });

    it("creates an edge for a conditional require(\"./x\")", () => {
        const graph = buildDependencyGraph(DYNAMIC);
        assert.ok(
            graph.dependents.get("b.ts")?.includes("consumer-require.ts"),
            "consumer-require.ts requires b.ts inside a conditional branch"
        );
    });

    it("creates an edge for import(\"./x\").then(...)", () => {
        const graph = buildDependencyGraph(DYNAMIC);
        assert.ok(graph.dependents.get("e.ts")?.includes("consumer-then.ts"));
    });

    it("creates an edge for require.resolve(\"./x\")", () => {
        const graph = buildDependencyGraph(DYNAMIC);
        assert.ok(graph.dependents.get("e.ts")?.includes("consumer-resolve.ts"));
    });

    it("resolves substitution-free template literals", () => {
        const graph = buildDependencyGraph(DYNAMIC);
        assert.ok(graph.dependents.get("b.ts")?.includes("consumer-template.ts"));
    });

    it("includes dynamic consumers in the transitive blast radius", () => {
        const graph = buildDependencyGraph(DYNAMIC);

        for (const changed of ["b.ts", "c.ts"]) {
            const impact = findTransitiveDependents(graph, changed);
            assert.ok(
                impact.files.length > 0,
                `${changed} must have transitive dependents via dynamic imports`
            );
        }
    });

    it("records unresolvable dynamic arguments instead of dropping them silently", () => {
        const graph = buildDependencyGraph(DYNAMIC);
        // Two template literals with substitutions + one concatenation;
        // the bare package specifier ("lodash-es") is external policy, not unresolved
        assert.equal(graph.unresolvedDynamicImports.get("consumer-unresolved.ts"), 3);
    });

    it("ignores bare (package) dynamic specifiers like static imports do", () => {
        const graph = buildDependencyGraph(DYNAMIC);
        assert.equal(graph.unresolvedDynamicImports.get("consumer-import.ts"), undefined);
    });

    it("terminates on cycles that mix dynamic and static edges", () => {
        const graph = buildDependencyGraph(DYNAMIC);

        const fromB = findTransitiveDependents(graph, "cycle-b.ts");
        assert.deepEqual(fromB.files, ["cycle-a.ts"]);
        assert.equal(fromB.maxDepth, 1);

        const fromA = findTransitiveDependents(graph, "cycle-a.ts");
        assert.deepEqual(fromA.files, ["cycle-b.ts"]);
        assert.equal(fromA.maxDepth, 1);
    });
});