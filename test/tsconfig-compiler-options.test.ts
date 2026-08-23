import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    readTsConfigCompilerOptions
} from "../src/engine/tsconfig-compiler-options.js";
import { getProject } from "../src/engine/project.js";
import { ScriptTarget } from "ts-morph";

describe("readTsConfigCompilerOptions", () => {
    let dir: string;

    afterEach(() => {
        if (!dir) return;
        rmSync(dir, { recursive: true, force: true });
        dir = "";
    });

    function createDir(): string {
        dir = mkdtempSync(path.join(tmpdir(), "impactwave-tsconfig-"));
        return dir;
    }

    it("extracts compilerOptions without filesystem enumeration", () => {
        const root = createDir();
        writeFileSync(
            path.join(root, "tsconfig.json"),
            JSON.stringify({
                compilerOptions: {
                    target: "ES2020",
                    baseUrl: ".",
                    paths: { "@app/*": ["src/*"] }
                }
            })
        );

        const options = readTsConfigCompilerOptions(
            path.join(root, "tsconfig.json")
        );

        assert.equal(options.target, ScriptTarget.ES2020);
        assert.deepEqual(options.paths, { "@app/*": ["src/*"] });
    });

    it("merges extends chains with child options taking precedence", () => {
        const root = createDir();
        writeFileSync(
            path.join(root, "base.json"),
            JSON.stringify({
                compilerOptions: {
                    target: "ES2020",
                    strict: false,
                    experimentalDecorators: true
                }
            })
        );
        writeFileSync(
            path.join(root, "tsconfig.json"),
            `{
                // real-world tsconfigs contain comments
                "extends": "./base.json",
                "compilerOptions": {
                    "strict": true,
                },
            }`
        );

        const options = readTsConfigCompilerOptions(
            path.join(root, "tsconfig.json")
        );

        assert.equal(options.strict, true);
        assert.equal(options.experimentalDecorators, true);
        assert.equal(options.target, ScriptTarget.ES2020);
    });

    it("returns empty options for missing or broken configs", () => {
        const root = createDir();

        assert.deepEqual(
            readTsConfigCompilerOptions(path.join(root, "missing.json")),
            {}
        );

        writeFileSync(path.join(root, "broken.json"), "{ not json ]");
        assert.deepEqual(
            readTsConfigCompilerOptions(path.join(root, "broken.json")),
            {}
        );
    });
});

describe("getProject with unreadable directories", () => {
    let dir: string;

    afterEach(() => {
        if (!dir) return;
        try {
            chmodSync(path.join(dir, "pg_data"), 0o700);
        } catch {
            // already readable or never created
        }
        rmSync(dir, { recursive: true, force: true });
        dir = "";
    });

    it("loads sources when a root tsconfig without include coexists with a locked directory", () => {
        dir = mkdtempSync(path.join(tmpdir(), "impactwave-nestjs-"));

        // NestJS-style root tsconfig: no include/exclude at all
        writeFileSync(
            path.join(dir, "tsconfig.json"),
            JSON.stringify({
                compilerOptions: {
                    module: "commonjs",
                    target: "es2020",
                    experimentalDecorators: true
                }
            })
        );
        mkdirSync(path.join(dir, "src"));
        writeFileSync(
            path.join(dir, "src", "app.service.ts"),
            "export class AppService { get(): string { return 'ok'; } }\n"
        );

        mkdirSync(path.join(dir, "pg_data"));
        writeFileSync(path.join(dir, "pg_data", "x.ts"), "export {};\n");
        chmodSync(path.join(dir, "pg_data"), 0o000);

        const project = getProject(dir);
        const loaded = project
            .getSourceFiles()
            .map(f => path.relative(dir, f.getFilePath()));

        assert.ok(loaded.includes(path.join("src", "app.service.ts")));
        assert.ok(!loaded.some(f => f.startsWith("pg_data")));
    });
});
