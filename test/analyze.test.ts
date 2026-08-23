import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { analyzeProject } from "../src/engine/analyze.js";
import type { AnalysisResult } from "../src/engine/analysis-result.interface.js";
import { createGitRepo, git, type GitRepoFixture } from "./helpers/git-repo.js";

const TSX = path.resolve("node_modules/.bin/tsx");
const CLI = path.resolve("src/cli.ts");
const SIMPLE = path.resolve("test/fixtures/simple-project");
const SCHEMA = path.resolve("docs/schema-v1.json");

function runCli(cwd: string, args: string[]) {
    const result = spawnSync(TSX, [CLI, ...args], {
        cwd,
        encoding: "utf8",
        timeout: 60000
    });
    return {
        status: result.status,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? ""
    };
}

describe("analyzeProject facade", () => {
    let repo: GitRepoFixture;
    let result: AnalysisResult;

    before(async () => {
        repo = createGitRepo({
            "A.ts": readFileSync(path.join(SIMPLE, "A.ts"), "utf8"),
            "B.ts": readFileSync(path.join(SIMPLE, "B.ts"), "utf8"),
            "C.ts": readFileSync(path.join(SIMPLE, "C.ts"), "utf8"),
            "tsconfig.json": readFileSync(
                path.join(SIMPLE, "tsconfig.json"),
                "utf8"
            )
        });
        git(repo.dir, "branch", "-M", "main");

        const modifiedB = [
            'import { c } from "./C.js";',
            "",
            "export function b(): number {",
            "    const y = 2;",
            "    return c() + y;",
            "}"
        ].join("\n");
        writeFileSync(path.join(repo.dir, "B.ts"), modifiedB + "\n");
        git(repo.dir, "add", "-A");
        git(repo.dir, "commit", "-q", "-m", "change b");

        const { version } = JSON.parse(
            readFileSync("package.json", "utf8")
        ) as { version: string };

        result = await analyzeProject({
            projectRoot: repo.dir,
            version,
            base: "HEAD~1"
        });
    });

    after(() => repo.cleanup());

    it("is fully serializable (JSON round-trip loses nothing)", () => {
        const serialized = JSON.parse(JSON.stringify(result));
        assert.deepEqual(serialized, result);
    });

    it("carries the contract version and injected package version", () => {
        assert.equal(result.meta.schemaVersion, 1);
        assert.equal(typeof result.meta.version, "string");
        assert.match(result.meta.version, /^\d+\.\d+\.\d+/);
        assert.equal(result.meta.branch, "main");
        assert.equal(result.meta.base, "HEAD~1");
    });

    it("computes the known fixture assessment", () => {
        // Same deterministic numbers the console integration test asserts.
        assert.equal(result.risk.level, "MEDIUM");
        assert.equal(result.risk.score, 28);
        // Only B.ts changed in this fixture
        assert.equal(result.summary.filesAnalyzed, 1);
    });

    it("marks the physically modified symbol with line counts", () => {
        const bFile = result.changedFiles.find(f => f.path === "B.ts");
        assert.ok(bFile);

        const symbol = bFile.exportedSymbols?.find(s => s.name === "b");
        assert.ok(symbol);
        assert.equal(symbol.modified, true);
        assert.ok((symbol.linesModified ?? 0) > 0);
    });

    it("reports the real consumer of the modified symbol, unfiltered", () => {
        const bFile = result.changedFiles.find(f => f.path === "B.ts");
        const aUsage = bFile?.consumers?.find(
            usage => usage.filePath === "A.ts" && !usage.importOnly
        );

        assert.ok(aUsage, "A.ts should consume b() as an active execution");
        assert.equal(aUsage.symbol, "b");
        assert.ok(aUsage.line > 0);
        assert.ok(aUsage.snippet.length > 0);
    });

    it("collects no warnings on a clean repository", () => {
        assert.deepEqual(result.warnings, []);
    });
});

describe("--json CLI output", () => {
    let repo: GitRepoFixture;

    before(() => {
        repo = createGitRepo({
            "index.ts": "export const value = (): number => 1;\n",
            "tsconfig.json":
                '{\n  "compilerOptions": {\n    "module": "nodenext",\n    "target": "es2020"\n  }\n}\n'
        });
        writeFileSync(path.join(repo.dir, "index.ts"), "export const value = (): number => 2;\n");
        git(repo.dir, "add", "-A");
        git(repo.dir, "commit", "-q", "-m", "bump");
    });

    after(() => repo.cleanup());

    function parseJsonOutput(args: string[]): { status: number; parsed: unknown; stderr: string } {
        const { status, stdout, stderr } = runCli(repo.dir, args);
        assert.equal(status, 0, stderr);
        return { status, parsed: JSON.parse(stdout), stderr };
    }

    it("emits a single valid JSON document on stdout", () => {
        const { parsed, stderr } = parseJsonOutput(["analyze", "--json", "-b", "HEAD~1"]);
        assert.equal(stderr, "");
        assert.ok(parsed && typeof parsed === "object");
    });

    it("satisfies the published schema-v1 contract", () => {
        const { parsed } = parseJsonOutput(["analyze", "--json", "-b", "HEAD~1"]);

        const ajv = new Ajv2020({ strict: false, allErrors: true });
        const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));
        const validate = ajv.compile(schema);

        const ok = validate(parsed);
        assert.ok(ok, ajv.errorsText(validate.errors, { separator: "\n  " }));
    });

    it("keeps warnings out of stdout and on stderr", () => {
        // Unknown tsconfig option triggers the warning sink; with --json the
        // message must travel through stderr while stdout stays pure JSON.
        const dirWithJsx = createGitRepo({
            "app.tsx": "export const App = (): string => 'a';\n",
            "tsconfig.json":
                '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "module": "nodenext",\n    "target": "es2020"\n  }\n}\n'
        });
        try {
            writeFileSync(
                path.join(dirWithJsx.dir, "app.tsx"),
                "export const App = (): string => 'b';\n"
            );
            git(dirWithJsx.dir, "add", "-A");
            git(dirWithJsx.dir, "commit", "-q", "-m", "touch");

            const { status, stdout, stderr } = runCli(dirWithJsx.dir, [
                "analyze",
                "--json",
                "-b",
                "HEAD~1"
            ]);
            assert.equal(status, 0);
            // stdout must still be valid JSON despite the warning
            const parsed = JSON.parse(stdout) as AnalysisResult;
            assert.equal(parsed.warnings.length, 1);
            assert.equal(parsed.warnings[0]!.code, "unsupported-tsconfig-option");
            assert.match(stderr, /ignoring "jsx"/);
        } finally {
            dirWithJsx.cleanup();
        }
    });
});
