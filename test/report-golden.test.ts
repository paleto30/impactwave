import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createGitRepo, git, type GitRepoFixture } from "./helpers/git-repo.js";

const TSX = path.resolve("node_modules/.bin/tsx");
const CLI = path.resolve("src/cli.ts");
const SIMPLE = path.resolve("test/fixtures/simple-project");
const GOLDEN = path.resolve("test/__snapshots__/report.golden.txt");

/**
 * Runs the CLI without any output normalization: the golden file captures
 * the exact bytes (ANSI codes included) so any visual regression fails.
 * Regenerate intentionally with UPDATE_GOLDEN=1 (npm run golden:update).
 */
function runCliRaw(cwd: string, args: string[]) {
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

/**
 * Finds the first character position where two outputs differ and reports
 * its line number plus a window of surrounding content, so a visual
 * regression points at the exact broken line instead of dumping both blobs.
 */
function firstDivergence(actual: string, expected: string): string {
    const min = Math.min(actual.length, expected.length);
    let index = 0;
    while (index < min && actual[index] === expected[index]) index++;

    const upto = actual.slice(0, index);
    const line = (upto.match(/\n/g) ?? []).length + 1;
    const window = (text: string) =>
        JSON.stringify(text.slice(Math.max(0, index - 40), index + 40));

    return [
        `Console output diverges from golden at line ${line} (char ${index}).`,
        `  actual  : ${window(actual)}`,
        `  expected: ${window(expected)}`
    ].join("\n");
}

describe("report golden output", () => {
    let repo: GitRepoFixture;

    before(() => {
        repo = createGitRepo({
            "A.ts": readFileSync(path.join(SIMPLE, "A.ts"), "utf8"),
            "B.ts": readFileSync(path.join(SIMPLE, "B.ts"), "utf8"),
            "C.ts": readFileSync(path.join(SIMPLE, "C.ts"), "utf8"),
            "tsconfig.json": readFileSync(
                path.join(SIMPLE, "tsconfig.json"),
                "utf8"
            )
        });

        // Deterministic branch name across environments (git's
        // init.defaultBranch varies), so the golden file is portable.
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
    });

    after(() => repo.cleanup());

    it("matches the captured console report byte-for-byte", () => {
        const { status, stdout, stderr } = runCliRaw(repo.dir, [
            "analyze",
            "-b",
            "HEAD~1"
        ]);
        assert.equal(status, 0, stderr);
        // Channel discipline: the human report owns stdout; nothing else
        // may leak there or into stderr on a clean run.
        assert.equal(stderr, "");

        if (process.env.UPDATE_GOLDEN) {
            mkdirSync(path.dirname(GOLDEN), { recursive: true });
            writeFileSync(GOLDEN, stdout);
            return;
        }

        const expected = readFileSync(GOLDEN, "utf8");
        if (stdout !== expected) {
            assert.fail(firstDivergence(stdout, expected));
        }
    });
});
