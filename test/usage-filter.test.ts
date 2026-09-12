import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { SymbolAnalyzer } from "../src/engine/analyzer/symbol-analyzer.js";
import type { SymbolImpact } from "../src/engine/analyzer/symbol-impact.interface.js";

const SHAPES = path.resolve("test/fixtures/import-shapes");
const BARREL = path.resolve("test/fixtures/barrel-exports");

type Consumer = SymbolImpact["consumers"][number];

function consumersOf(
    projectRoot: string,
    filePath: string,
    symbolName: string
): Consumer[] {
    const analyzer = new SymbolAnalyzer(projectRoot);
    return analyzer.analyzeSymbolImpact(filePath, [symbolName])[0]?.consumers ?? [];
}

function inFile(consumers: Consumer[], filePath: string): Consumer[] {
    return consumers.filter(consumer => consumer.filePath === filePath);
}

describe("contract wiring classification (AST based)", () => {
    it("classifies a multi-line import as wiring, not as a consumer", () => {
        // The reference lands on a line that reads just "PaymentService,":
        // no line-based rule can tell it is part of an import.
        const wiring = inFile(
            consumersOf(SHAPES, "service.ts", "PaymentService"),
            "multiline-import-only.ts"
        );

        assert.equal(wiring.length, 1);
        assert.equal(wiring[0]?.importOnly, true);
        assert.equal(wiring[0]?.snippet, "PaymentService,");
    });

    it("still reports the active usage when the import spans several lines", () => {
        const consumers = inFile(
            consumersOf(SHAPES, "service.ts", "PaymentService"),
            "multiline-active.ts"
        );

        const active = consumers.filter(consumer => !consumer.importOnly);
        assert.equal(active.length, 1, "the constructor call is a real usage");
        assert.match(active[0]!.snippet, /new PaymentService\(\)/);
        assert.ok(
            consumers.some(consumer => consumer.importOnly),
            "its multi-line import is still wiring"
        );
    });

    it("classifies a multi-line re-export as wiring", () => {
        const wiring = inFile(
            consumersOf(SHAPES, "service.ts", "PaymentService"),
            "multiline-reexport.ts"
        );

        assert.equal(wiring.length, 1);
        assert.equal(wiring[0]?.importOnly, true);
    });

    it("keeps dynamic imports as active usage", () => {
        const consumers = inFile(
            consumersOf(SHAPES, "service.ts", "formatAmount"),
            "dynamic-consumer.ts"
        );

        assert.ok(consumers.length > 0, "the lazy module call must be seen");
        assert.ok(
            consumers.every(consumer => !consumer.importOnly),
            "a dynamic load executes the module: it is not wiring"
        );
    });

    it("classifies single-line barrel re-exports as wiring", () => {
        const barrel = inFile(
            consumersOf(BARREL, "payment/payment.service.ts", "PaymentService"),
            "index.ts"
        );

        assert.equal(barrel.length, 1);
        assert.equal(barrel[0]?.importOnly, true);
    });

    it("keeps real consumers behind a barrel active", () => {
        const controller = inFile(
            consumersOf(BARREL, "payment/payment.service.ts", "PaymentService"),
            "checkout.controller.ts"
        );

        assert.ok(
            controller.some(consumer => !consumer.importOnly),
            "the controller instantiates the service"
        );
    });
});
