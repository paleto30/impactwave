import { simpleGit, type SimpleGit } from "simple-git";
import { FileStatus } from "./file-status.js";
import type { ChangedFile } from "./changed-file.interface.js";

export async function detectRepo(
    projectRoot: string = process.cwd()
): Promise<SimpleGit | null> {
    const git: SimpleGit = simpleGit(projectRoot);

    const isRepo = await git.checkIsRepo();

    if (!isRepo) {
        console.log("This directory is not a Git repository.");
        return null;
    }

    return git;
}

export async function detectBaseBranch(git: SimpleGit): Promise<string | null> {
    try {
        const remoteHead = await git.raw([
            "symbolic-ref",
            "refs/remotes/origin/HEAD"
        ]);

        // refs/remotes/origin/main -> main
        return remoteHead.trim().split("/").pop() ?? null;

    } catch (error) {
        const branchSummary = await git.branchLocal();

        if (branchSummary.all.includes("main"))
            return "main";

        if (branchSummary.all.includes("master"))
            return "master";

        return null;
    }
}

export async function getChangedFiles(
    git: SimpleGit,
    base: string,
    current: string
): Promise<ChangedFile[]> {

    const output = await git.diff(["--name-status", base, current]);

    const changedFiles: ChangedFile[] = [];

    const lines = output
        .split("\n")
        .filter((line) => line.trim() !== "");

    for (const line of lines) {
        const parts = line.split("\t");
        const status = parts[0];

        if (!status) {
            throw new Error(`Invalid git diff line: ${line}`);
        }

        // Renames: "R100\told/path.ts\tnew/path.ts" -> 3 columns
        if (status.startsWith("R")) {
            const [, oldPath, newPath] = parts;

            if (!oldPath || !newPath) {
                throw new Error(`Invalid rename line: ${line}`);
            }

            changedFiles.push({ path: oldPath, status: FileStatus.Deleted });
            changedFiles.push({ path: newPath, status: FileStatus.Added });
            continue;
        }

        // Normal cases: "M\tpath.ts" -> 2 columns
        const [, path] = parts;

        if (!path) {
            throw new Error(`Invalid git diff line: ${line}`);
        }

        switch (status) {
            case "A":
                changedFiles.push({ path, status: FileStatus.Added });
                break;

            case "M":
                changedFiles.push({ path, status: FileStatus.Modified });
                break;

            case "D":
                changedFiles.push({ path, status: FileStatus.Deleted });
                break;

            default:
                throw new Error(`Unsupported git status: ${status}`);
        }
    }

    return changedFiles;
}

export async function branchExists(git: SimpleGit, ref: string) {
    try {
        await git.raw(["rev-parse", "--verify", ref]);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Returns the set of line numbers modified in a file relative to the base branch.
 */
export async function getModifiedLines(git: SimpleGit, base: string, head: string, filePath: string): Promise<Set<number>> {
    const modifiedLines = new Set<number>();
    try {
        // Get the unified diff for the specific file
        const diff = await git.diff([base, head, "--", filePath]);
        const lines = diff.split("\n");

        let currentLine = 0;

        for (const line of lines) {
            if (line.startsWith("@@")) {
                // Git diff chunk format: @@ -l,s +l,s @@
                const match = line.match(/\+([0-9]+)(?:,([0-9]+))?/);
                if (match && match[1]) {
                    currentLine = parseInt(match[1], 10);
                }
            } else if (line.startsWith("+") && !line.startsWith("+++")) {
                // Added or modified line
                modifiedLines.add(currentLine);
                currentLine++;
            } else if (line.startsWith(" ") && !line.startsWith("---")) {
                // Context line (no change)
                currentLine++;
            }
            // Lines starting with '-' do not advance the new-file counter
        }
    } catch (error) {
        // If the diff fails, return an empty set by safety
    }
    return modifiedLines;
}