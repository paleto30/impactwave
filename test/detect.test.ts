import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { createGitRepo, git, type GitRepoFixture } from "./helpers/git-repo.js";
import { getChangedFiles, getModifiedLines } from "../src/engine/git/detect.js";
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
