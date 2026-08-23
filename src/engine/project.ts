import path from "node:path";
import { existsSync } from "node:fs";
import { Project } from "ts-morph";
import { addProjectSourceFiles } from "./project-files.js";

let sharedProject: Project | undefined;
let sharedProjectRoot: string | undefined;

/**
 * Returns a single Project instance per project root.
 *
 * parser, dependency and symbol-analyzer share the same AST tree and the same
 * tsconfig settings (path aliases, target/module), avoiding parsing the same
 * files multiple times with different projects.
 *
 * A root tsconfig.json is optional: monorepo workspaces usually have one
 * tsconfig per package and none at the root. Either way, source files are
 * discovered by an explicit resilient walk (see project-files) instead of
 * letting TypeScript enumerate the tree — unreadable directories like
 * Docker data folders must not crash the analysis.
 */
export function getProject(projectRoot: string): Project {
    if (!sharedProject || sharedProjectRoot !== projectRoot) {
        const tsconfigPath = path.join(projectRoot, "tsconfig.json");

        sharedProject = existsSync(tsconfigPath)
            ? new Project({
                tsConfigFilePath: tsconfigPath,
                skipAddingFilesFromTsConfig: true
            })
            : new Project();

        addProjectSourceFiles(sharedProject, projectRoot);

        sharedProjectRoot = projectRoot;
    }
    return sharedProject;
}