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

/**
 * Parses one `git diff --name-status` line into a changed file.
 *
 * Renames and copies carry three columns ("R100\told\tnew"). A rename is
 * reported as a single modification of its new path, remembering where it
 * came from: splitting it into delete + add made the new path look like a
 * brand-new file whose every line was modified, marking every symbol in it
 * as touched. Unknown statuses (unmerged entries during a conflict) are
 * skipped instead of aborting the analysis.
 */
function parseChangedFileLine(line: string): ChangedFile | null {
    const parts = line.split("\t");
    const status = parts[0];

    if (!status) {
        throw new Error(`Invalid git diff line: ${line}`);
    }

    if (status.startsWith("R") || status.startsWith("C")) {
        const [, oldPath, newPath] = parts;

        if (!oldPath || !newPath) {
            throw new Error(`Invalid rename line: ${line}`);
        }

        // A copy leaves its source untouched, so only the new path is new.
        return status.startsWith("C")
            ? { path: newPath, status: FileStatus.Added }
            : {
                path: newPath,
                status: FileStatus.Modified,
                previousPath: oldPath
            };
    }

    const [, path] = parts;

    if (!path) {
        throw new Error(`Invalid git diff line: ${line}`);
    }

    switch (status) {
        case "A":
            return { path, status: FileStatus.Added };

        // A type change (file <-> symlink) still changes the content that
        // the analysis reads, so it is a modification like any other.
        case "M":
        case "T":
            return { path, status: FileStatus.Modified };

        case "D":
            return { path, status: FileStatus.Deleted };

        default:
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
        const changedFile = parseChangedFileLine(line);
        if (changedFile) changedFiles.push(changedFile);
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
 *
 * Line numbers refer to the file at `head`. Removals have no line of their
 * own there, so they are recorded at the position their code used to
 * occupy: otherwise a change that only deletes code (a dropped validation,
 * a removed branch) marked no symbol at all and its whole impact went
 * unreported.
 */
export async function getModifiedLines(
    git: SimpleGit,
    base: string,
    head: string,
    file: ChangedFile
): Promise<Set<number>> {
    const modifiedLines = new Set<number>();
    const paths = file.previousPath ? [file.previousPath, file.path] : [file.path];

    try {
        // -M plus both paths so a renamed file diffs against its previous
        // content instead of reporting every line as added.
        const diff = await git.diff([base, head, "-M", "--", ...paths]);
        const lines = diff.split("\n");

        let currentLine = 0;

        for (const line of lines) {
            if (line.startsWith("@@")) {
                // Git diff chunk format: @@ -l,s +l,s @@
                const match = line.match(/\+([0-9]+)(?:,([0-9]+))?/);
                if (match && match[1]) {
                    currentLine = parseInt(match[1], 10);
                }
                continue;
            }

            // File headers look like content lines; they are not.
            if (line.startsWith("+++") || line.startsWith("---")) continue;

            if (line.startsWith("+")) {
                // Added or modified line
                modifiedLines.add(currentLine);
                currentLine++;
            } else if (line.startsWith("-")) {
                // Removed line: mark the line that now sits in its place.
                modifiedLines.add(currentLine);
            } else if (line.startsWith(" ")) {
                // Context line (no change)
                currentLine++;
            }
        }
    } catch (error) {
        // If the diff fails, return an empty set by safety
    }
    return modifiedLines;
}