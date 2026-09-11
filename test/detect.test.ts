import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { createGitRepo, git, type GitRepoFixture } from "./helpers/git-repo.js";
import {
    branchExists,
    detectBaseBranch,
    getChangedFiles,
    getModifiedLines
} from "../src/engine/git/detect.js";
import { FileStatus } from "../src/engine/git/file-status.js";

const CORE = [
    "export function uno(): number {",
    "    return 1;",
    "}",
    "",
    "export function dos(): number {",
    "    return 2;",
    "}",
    ""
].join("\n");

describe("changed files: renames", () => {
    let repo: GitRepoFixture;

    after(() => repo?.cleanup());

    it("reports a rename as one modification of its new path", async () => {
        repo = createGitRepo({ "core.ts": CORE });

        git(repo.dir, "mv", "core.ts", "nucleo.ts");
        writeFileSync(
            path.join(repo.dir, "nucleo.ts"),
            CORE.replace("return 1;", "return 11;")
        );
        git(repo.dir, "add", "-A");
        git(repo.dir, "commit", "-q", "-m", "rename and edit");

        const files = await getChangedFiles(simpleGit(repo.dir), "HEAD~1", "HEAD");

        assert.equal(files.length, 1, "a rename is one changed file, not two");
        assert.equal(files[0]?.path, "nucleo.ts");
        assert.equal(files[0]?.status, FileStatus.Modified);
        assert.equal(files[0]?.previousPath, "core.ts");
    });

    it("diffs a renamed file against its previous content", async () => {
        // Without rename detection the new path looked brand new and every
        // line counted as modified, marking every symbol in it as touched.
        const files = await getChangedFiles(simpleGit(repo.dir), "HEAD~1", "HEAD");
        const lines = await getModifiedLines(
            simpleGit(repo.dir),
            "HEAD~1",
            "HEAD",
            files[0]!
        );

        assert.deepEqual([...lines], [2], "only the edited line changed");
    });
});

describe("changed lines: deletions", () => {
    let repo: GitRepoFixture;

    after(() => repo?.cleanup());

    it("marks the position of code removed by the change", async () => {
        const validator = [
            "export function valida(x: number): number {",
            '    if (x < 0) throw new Error("negativo");',
            '    if (x > 100) throw new Error("grande");',
            "    return x;",
            "}",
            ""
        ].join("\n");

        repo = createGitRepo({ "core.ts": validator });

        writeFileSync(
            path.join(repo.dir, "core.ts"),
            validator.replace('    if (x > 100) throw new Error("grande");\n', "")
        );
        git(repo.dir, "add", "-A");
        git(repo.dir, "commit", "-q", "-m", "drop a validation");

        const files = await getChangedFiles(simpleGit(repo.dir), "HEAD~1", "HEAD");
        const lines = await getModifiedLines(
            simpleGit(repo.dir),
            "HEAD~1",
            "HEAD",
            files[0]!
        );

        // Line 3 of the new file ("return x;") now occupies the place of the
        // removed validation, so the enclosing symbol is seen as modified.
        assert.deepEqual([...lines], [3]);
    });
});

describe("base branch detection", () => {
    let origin: GitRepoFixture;
    let cloneDir: string;

    after(() => {
        origin?.cleanup();
        if (cloneDir) rmSync(cloneDir, { recursive: true, force: true });
    });

    it("keeps the remote prefix and slashes, and resolves in a CI-style clone", async () => {
        origin = createGitRepo({ "a.ts": "export const a = 1;\n" });
        git(origin.dir, "branch", "-M", "release/2.0");

        cloneDir = path.join(
            mkdtempSync(path.join(os.tmpdir(), "impactwave-clone-")),
            "checkout"
        );
        git(os.tmpdir(), "clone", "-q", origin.dir, cloneDir);

        const detected = await detectBaseBranch(simpleGit(cloneDir));

        // "release/2.0" would lose the remote and its slash; the last path
        // segment ("2.0") resolves to nothing at all.
        assert.equal(detected, "origin/release/2.0");

        // CI checks out a working branch and may keep no local base branch.
        git(cloneDir, "checkout", "-q", "-b", "work");
        git(cloneDir, "branch", "-q", "-D", "release/2.0");

        assert.equal(
            await branchExists(simpleGit(cloneDir), detected!),
            true,
            "the detected ref must exist without a local branch"
        );
    });
});
