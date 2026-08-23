import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { createGitRepo, git, type GitRepoFixture } from "./helpers/git-repo.js";

const TSX = path.resolve("node_modules/.bin/tsx");
const CLI = path.resolve("src/cli.ts");
const SIMPLE = path.resolve("test/fixtures/simple-project");

function runCli(cwd: string, args: string[]) {
    const result = spawnSync(TSX, [CLI, ...args], { cwd, encoding: "utf8", timeout: 60000 });
    const stripAnsi = (text: string) => text.replace(/\x1B\[[0-9;]*m/g, "");
    return {
        status: result.status,
        stdout: stripAnsi(result.stdout ?? ""),
        stderr: stripAnsi(result.stderr ?? "")
    };
}

function readFixture(name: string): string {
    return readFileSync(path.join(SIMPLE, name), "utf8");
}

describe("CLI integration", () => {
    let repo: GitRepoFixture;

    before(() => {
        // A real git repo: B.ts is modified after the base commit, so the
        // symbol b() is modified and its consumer A.ts is impacted.
        repo = createGitRepo({
            "A.ts": readFixture("A.ts"),
            "B.ts": readFixture("B.ts"),
            "C.ts": readFixture("C.ts"),
            "tsconfig.json": readFixture("tsconfig.json")
        });

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
    });

    after(() => repo.cleanup());

    it("produces a full report with the expected score and blast radius", () => {
        const result = runCli(repo.dir, ["analyze", "-b", "HEAD~1"]);
        assert.equal(result.status, 0, result.stderr);

        const output = result.stdout;
        assert.match(output, /Risk Assessment/);
        assert.match(output, /MEDIUM RISK \(score: 28\/100\)/);

        // 1 consumer -> 3 pts (30% of 30), 1 transitive file -> 1 pt,
        // depth 1 -> 4 pts, 1 untested affected area -> 20 pts, 2 lines -> 0 pts
        assert.match(output, /1 consumer of modified symbols \(3 pts\)/);
        assert.match(output, /1 affected files \(transitive reach\) \(1 pts\)/);
        assert.match(output, /Impact reaches depth 1 dependency level \(4 pts\)/);
        assert.match(output, /1 affected area without detected tests \(20 pts\)/);
        // Zero-point reasons are rendered without the "(N pts)" suffix.
        // The whole function tail becomes 3 added lines (base file has no
        // trailing newline, so "}" cannot be matched as context).
        assert.match(output, /3 lines modified\s*$/m);

        // Unified blast radius format (direct/total/depth) with the consumer listed
        assert.match(output, /Files in blast radius \(imported by ↓\) \(1 direct, 1 total, depth 1\)/);
        assert.match(output, /A\.ts/);

        // Coverage: one affected area (A.ts) without any test
        assert.match(output, /Affected components\s*:\s*1/);
        assert.match(output, /Impact coverage\s*:\s*0%/);
        assert.match(output, /Uncovered:/);
        assert.match(output, /✗ A\.ts/);
    });

    it("applies custom risk weights end to end", () => {
        const result = runCli(repo.dir, [
            "analyze",
            "-b", "HEAD~1",
            "--risk-weights",
            '{"callerImpact":100,"affectedFiles":0,"dependencyDepth":0,"testGaps":0,"changeSize":0}'
        ]);
        assert.equal(result.status, 0, result.stderr);
        // 1 consumer saturates 10% of callerImpact=100 -> 10 pts
        assert.match(result.stdout, /LOW RISK \(score: 10\/100\)/);
    });

    it("runs without the 'analyze' subcommand (npx impactwave)", () => {
        // §26 of the founding document: the MVP success criterion is
        // running the bare command and getting the full report.
        const result = runCli(repo.dir, ["-b", "HEAD~1"]);
        assert.equal(result.status, 0, result.stderr);

        const output = result.stdout;
        assert.match(output, /Risk Assessment/);
        assert.match(output, /MEDIUM RISK \(score: 28\/100\)/);
        assert.match(output, /Files in blast radius/);
    });
});

describe("CLI integration without a root tsconfig.json", () => {
    let repo: GitRepoFixture;

    before(() => {
        // Monorepo-style workspace: no tsconfig at the root. getProject must
        // fall back to an explicit scan instead of crashing with
        // FileNotFoundError.
        repo = createGitRepo({
            "src/greet.ts": 'export function greet(name: string): string {\n    return `Hello ${name}`;\n}\n',
            "src/main.ts": 'import { greet } from "./greet.js";\n\nconsole.log(greet("world"));\n'
        });

        writeFileSync(
            path.join(repo.dir, "src/greet.ts"),
            'export function greet(name: string): string {\n    const greeting = `Hello ${name}`;\n    return greeting;\n}\n'
        );
        git(repo.dir, "add", "-A");
        git(repo.dir, "commit", "-q", "-m", "change greet");
    });

    after(() => repo.cleanup());

    it("does not crash and detects modified symbols", () => {
        const result = runCli(repo.dir, ["analyze", "-b", "HEAD~1"]);
        assert.equal(result.status, 0, result.stderr);

        const output = result.stdout;
        assert.doesNotMatch(result.stderr, /FileNotFoundError/);
        // The CLI no longer crashes when there is no root tsconfig.json.
        // The modified symbol is detected and its line count is displayed.
        assert.match(output, /greet.*\(function\)/);
        assert.match(output, /2 lines modified/);
    });
});

describe("CLI integration: modified class methods", () => {
    let repo: GitRepoFixture;

    before(() => {
        // A class with two public methods and one private method. Only the
        // public suma() is modified after the base commit: the report must
        // name the concrete modified method and skip the private one.
        const calcTs = [
            "export class Calculadora {",
            "    suma(a: number, b: number): number {",
            "        return a + b;",
            "    }",
            "",
            "    resta(a: number, b: number): number {",
            "        return a - b;",
            "    }",
            "",
            "    private logInterno(msg: string): void {",
            "        console.log(msg);",
            "    }",
            "}",
            ""
        ].join("\n");

        repo = createGitRepo({
            "src/calc.ts": calcTs,
            "src/main.ts": 'import { Calculadora } from "./calc.js";\n\nconsole.log(new Calculadora().suma(2, 3));\n',
            "tsconfig.json": '{ "compilerOptions": { "target": "ES2020", "module": "commonjs" } }\n'
        });

        writeFileSync(
            path.join(repo.dir, "src/calc.ts"),
            calcTs.replace("return a + b;", "return a + b + 0.0001;")
        );
        git(repo.dir, "add", "-A");
        git(repo.dir, "commit", "-q", "-m", "modify suma");
    });

    after(() => repo.cleanup());

    it("reports the specific modified method of each class", () => {
        const result = runCli(repo.dir, ["analyze", "-b", "HEAD~1"]);
        assert.equal(result.status, 0, result.stderr);

        const output = result.stdout;
        assert.match(output, /Calculadora \(class.*modified\)/);
        assert.match(output, /└─ ✏️\s+suma method modified/);
        assert.doesNotMatch(output, /\(suma method modified\)/);
    });

    it("does not report private methods as modified", () => {
        const result = runCli(repo.dir, ["analyze", "-b", "HEAD~1"]);
        const output = result.stdout;
        assert.doesNotMatch(output, /logInterno/);
    });
});