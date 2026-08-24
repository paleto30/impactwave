import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { isImportOnlyUsage } from "../src/engine/analyzer/usage-filter.js";
import { getProject } from "../src/engine/project.js";
import { SymbolAnalyzer } from "../src/engine/analyzer/symbol-analyzer.js";

const BARREL = path.resolve("test/fixtures/barrel-exports");

describe("import-only usage filter", () => {
    it("keeps treating import statements as passive wiring", () => {
        assert.ok(isImportOnlyUsage('import { PaymentService } from "./PaymentService.js";'));
        assert.ok(isImportOnlyUsage('import type { Foo } from "./foo.js";'));
        assert.ok(isImportOnlyUsage('import "./polyfills.js";'));
        assert.ok(isImportOnlyUsage('import * as payment from "./payment.js"'));
    });

    it("treats re-exports as passive wiring (contract pass-through)", () => {
        assert.ok(isImportOnlyUsage('export { PaymentService } from "./PaymentService.js";'));
        assert.ok(
            isImportOnlyUsage('export { PaymentService as Checkout } from "./PaymentService.js";'),
            "renamed re-export"
        );
        assert.ok(isImportOnlyUsage('export * from "./payment/index.js";'));
        assert.ok(isImportOnlyUsage('export * as PaymentNS from "./payment.js";'));
        assert.ok(
            isImportOnlyUsage('export { default as PaymentService } from "./PaymentService.js";'),
            "default re-export"
        );
    });

    it("treats bare export specifier lists as passive wiring", () => {
        // import { X } from "./y"; export { X };  -> the export line wires,
        // it executes nothing of X
        assert.ok(isImportOnlyUsage("export { PaymentService };"));
        assert.ok(isImportOnlyUsage("export { PaymentService as default };"));
    });

    it("does not swallow genuinely active usages", () => {
        assert.ok(!isImportOnlyUsage("const total = paymentService.calculate(amount);"));
        assert.ok(!isImportOnlyUsage("new PaymentService(card).charge(order);"));
        assert.ok(!isImportOnlyUsage("export const factory = makeService(PaymentService);"));
        assert.ok(!isImportOnlyUsage("export default buildGateway(PaymentService)"), 
            "an export whose initializer USES the symbol is active");
    });

    it("does not classify dynamic import calls as passive", () => {
        // A dynamic import is a real module load on that line
        assert.ok(!isImportOnlyUsage('const mod = await import("./b");'));
        assert.ok(!isImportOnlyUsage('import("./b").then(m => m.b());'));
    });
});

describe("barrel re-exports end up flagged as contract wiring", () => {
    it("classifies the index.ts reference to a re-exported symbol as importOnly", () => {
        const projectRoot = BARREL;
        const analyzer = new SymbolAnalyzer(projectRoot);
        getProject(projectRoot);

        const impacts = analyzer.analyzeSymbolImpact(
            "payment/payment.service.ts",
            ["PaymentService"]
        );

        const impact = impacts[0];
        assert.ok(impact, "the symbol must have an impact entry");
        const indexConsumer = impact.consumers.find(c => c.filePath === "index.ts");
        assert.ok(indexConsumer, "the barrel must appear among the consumers");
        assert.ok(
            isImportOnlyUsage(indexConsumer.snippet),
            `re-export line must be wiring: ${indexConsumer.snippet}`
        );
    });
});
