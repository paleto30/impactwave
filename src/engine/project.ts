import path from "node:path";
import { existsSync } from "node:fs";
import { Project, type CompilerOptions } from "ts-morph";
import { addProjectSourceFiles } from "./project-files.js";
import { readTsConfigCompilerOptions } from "./tsconfig-compiler-options.js";

let sharedProject: Project | undefined;
let sharedProjectRoot: string | undefined;

/**
 * Returns a single Project instance per project root.
 *
 * parser, dependency and symbol-analyzer share the same AST tree and the same
 * tsconfig settings (path aliases, target/module), avoiding parsing the same
 * files multiple times with different projects.
 *
 * A root tsconfig.json contributes ONLY compilerOptions (read manually, see
 * tsconfig-compiler-options): source files are always discovered by an
 * explicit resilient walk (see project-files) instead of letting TypeScript
 * enumerate the tree — unreadable directories like Docker data folders must
 * not crash the analysis, so include/exclude are intentionally not honored.
 */
export function getProject(projectRoot: string): Project {
    if (!sharedProject || sharedProjectRoot !== projectRoot) {
        const tsconfigPath = path.join(projectRoot, "tsconfig.json");

        sharedProject = existsSync(tsconfigPath)
            ? new Project({
                // raw JSON values (string enums, arrays) are valid here and
                // avoid any TypeScript-side filesystem enumeration
                compilerOptions: readTsConfigCompilerOptions(
                    tsconfigPath
                ) as CompilerOptions
            })
            : new Project();

        addProjectSourceFiles(sharedProject, projectRoot);

        sharedProjectRoot = projectRoot;
    }
    return sharedProject;
}