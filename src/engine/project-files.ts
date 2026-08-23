import path from "node:path";
import { readdirSync } from "node:fs";
import type { Project } from "ts-morph";

/**
 * Directories that never contain analyzable source code. Skipping them
 * keeps the walk fast and away from generated output.
 */
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "build"]);

const TYPESCRIPT_FILE = /\.tsx?$/i;

/**
 * Depth-first collection of TypeScript source files.
 *
 * Unreadable directories (e.g. Docker-owned data folders like pg_data with
 * 0700 permissions) are skipped silently: a permission error must never
 * crash the whole analysis. Symlinks are not followed to avoid cycles.
 */
function collectTypeScriptFiles(directory: string, files: string[]): void {
    let entries;
    try {
        entries = readdirSync(directory, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);

        if (entry.isSymbolicLink()) continue;

        if (entry.isDirectory()) {
            if (
                entry.name.startsWith(".") ||
                SKIPPED_DIRECTORIES.has(entry.name)
            ) {
                continue;
            }
            collectTypeScriptFiles(fullPath, files);
        } else if (entry.isFile() && TYPESCRIPT_FILE.test(entry.name)) {
            files.push(fullPath);
        }
    }
}

/**
 * Adds every analyzable TypeScript file under projectRoot to the shared
 * Project, tolerating unreadable directories along the way.
 *
 * Used instead of ts-morph's automatic tsconfig file loading / globbing so
 * that hostile directories cannot abort the whole analysis.
 */
export function addProjectSourceFiles(project: Project, projectRoot: string): void {
    const files: string[] = [];
    collectTypeScriptFiles(projectRoot, files);

    for (const file of files) {
        project.addSourceFileAtPathIfExists(file);
    }
}
