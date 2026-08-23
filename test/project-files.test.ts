import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Project } from "ts-morph";
import { addProjectSourceFiles } from "../src/engine/project-files.js";

describe("addProjectSourceFiles", () => {
    let dir: string;

    afterEach(() => {
        if (!dir) return;
        // restore read access so rm -rf can clean up
        try {
            chmodSync(path.join(dir, "locked-data"), 0o700);
        } catch {
            // already readable or never created
        }
        rmSync(dir, { recursive: true, force: true });
        dir = "";
    });

    it("loads source files and skips unreadable directories without throwing", () => {
        dir = mkdtempSync(path.join(tmpdir(), "impactwave-files-"));

        writeFileSync(
            path.join(dir, "src.ts"),
            "export const main = (): string => 'main';\n"
        );
        mkdirSync(path.join(dir, "lib"));
        writeFileSync(
            path.join(dir, "lib", "util.ts"),
            "export const util = (): number => 1;\n"
        );

        // simulates a Docker-owned data directory (e.g. pg_data, 0700)
        mkdirSync(path.join(dir, "locked-data"));
        writeFileSync(
            path.join(dir, "locked-data", "internal.ts"),
            "export const hidden = true;\n"
        );
        chmodSync(path.join(dir, "locked-data"), 0o000);

        mkdirSync(path.join(dir, ".git"));
        writeFileSync(path.join(dir, ".git", "hook.ts"), "export {};\n");
        mkdirSync(path.join(dir, "node_modules"));
        writeFileSync(
            path.join(dir, "node_modules", "dep.ts"),
            "export {};\n"
        );

        const project = new Project();
        assert.doesNotThrow(() => addProjectSourceFiles(project, dir));

        const loaded = project
            .getSourceFiles()
            .map(f => path.relative(dir, f.getFilePath()))
            .sort();

        assert.deepEqual(loaded, ["lib/util.ts", "src.ts"]);
    });
});
