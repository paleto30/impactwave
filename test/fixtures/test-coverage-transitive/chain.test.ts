import { describe, it } from "node:test";
import { m0 } from "./m0.js";

describe("chain", () => {
    it("runs the entry point", () => {
        m0();
    });
});
