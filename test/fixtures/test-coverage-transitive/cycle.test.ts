import { describe, it } from "node:test";
import { p } from "./p.js";

describe("cycle", () => {
    it("handles p", () => {
        p();
    });
});
