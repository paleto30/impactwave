import { describe, it } from "node:test";

describe("dynamic", () => {
    it("loads helper through a dynamic import", async () => {
        const mod = await import("./helper");
        mod.helper();
    });
});
