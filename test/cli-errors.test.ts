import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGitRepo, git, type GitRepoFixture } from "./helpers/git-repo.js";

const TSX = path.resolve("node_modules/.bin/tsx");
const CLI = path.resolve("src/cli.ts");

function runCli(cwd: string, args: string[]) {
    const result = spawnSync(TSX, [CLI, ...args], { cwd, encoding: "utf8", timeout: 60000 });
    const stripAnsi = (text: string) => text.replace(/\x1B\[[0-9;]*m/g, "");
    return {
        status: result.status,
        stdout: stripAnsi(result.stdout ?? ""),
        stderr: stripAnsi(result.stderr ?? "")
    };
}

describe("CLI error handling", () => {
    let repo: GitRepoFixture;
    let nonRepo: string;

    before(() => {
        repo = createGitRepo({
            "index.ts": "export const x = 1;\n",
            "tsconfig.json": '{\n  "compilerOptions": {\n    "module": "nodenext",\n    "moduleResolution": "nodenext",\n    "target": "es2020",\n    "strict": true\n  },\n  "include": ["*.ts"]\n}\n'
        });
        // Second commit so HEAD~1 resolves (weight validation happens after
        // the base branch check)
        writeFileSync(path.join(repo.dir, "extra.ts"), "export const y = 2;\n");
        git(repo.dir, "add", "-A");
        git(repo.dir, "commit", "-q", "-m", "second");
        nonRepo = mkdtempSync(path.join(os.tmpdir(), "impactwave-nonrepo-"));
    });

    after(() => {
        repo.cleanup();
        rmSync(nonRepo, { recursive: true, force: true });
    });

    it("fails when the directory is not a git repository", () => {
        // Behavior fix (1.1.0): previously this exited 0 silently; a missing
        // repository is a usage error like any other.
        const result = runCli(nonRepo, ["analyze", "-b", "HEAD~1"]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /is not a Git repository/);
    });

    it("fails when the base branch does not exist", () => {
        const result = runCli(repo.dir, ["analyze", "-b", "does-not-exist"]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /does not exist in this repository/);
    });

    it("fails on invalid JSON in --risk-weights", () => {
        const result = runCli(repo.dir, ["analyze", "-b", "HEAD~1", "--risk-weights", "{bad"]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /must be a valid JSON object/);
    });

    it("fails on unknown keys in --risk-weights", () => {
        const result = runCli(repo.dir, [
            "analyze", "-b", "HEAD~1",
            "--risk-weights", '{"bogus":40}'
        ]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /must only contain numeric keys/);
        assert.match(result.stderr, /callerImpact/);
    });

    it("fails on non-numeric weight values", () => {
        const result = runCli(repo.dir, [
            "analyze", "-b", "HEAD~1",
            "--risk-weights", '{"callerImpact":"high"}'
        ]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /must only contain numeric keys/);
    });

    it("fails on unknown commands", () => {
        // 'analyze' is the default command, so an unrecognized word is now
        // reported as an invalid argument of that command (still a hard,
        // clear failure with exit code 1).
        const result = runCli(repo.dir, ["frobnicate"]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /error: too many arguments for 'analyze'/);
        assert.match(result.stderr, /frobnicate/);
    });
});