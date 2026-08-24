import path from "node:path";
import { getProject } from "../project.js";
import type { DependencyGraph } from "./dependency-graph.interface.js";
import type { TransitiveImpact } from "./transitive-impact.interface.js";

export function buildDependencyGraph(projectRoot: string): DependencyGraph {
    const project = getProject(projectRoot);

    // All project source files are already loaded by getProject through the
    // resilient walk (idempotent: files already added are reused, not
    // re-parsed)

    const dependents = new Map<string, string[]>();
    const imports = new Map<string, string[]>();

    for (const sourceFile of project.getSourceFiles()) {
        const filePath = path.relative(projectRoot, sourceFile.getFilePath());

        const importedByThis = imports.get(filePath) ?? [];
        imports.set(filePath, importedByThis);

        // Review each import and re-export this file makes. Re-exports
        // ("export ... from") are what barrel files are made of; skipping
        // them hides real consumers behind an index and produces false
        // negatives in the blast radius.
        for (const ref of [
            ...sourceFile.getImportDeclarations(),
            ...sourceFile.getExportDeclarations()
        ]) {
            const moduleSpecifier = ref.getModuleSpecifierValue();
            if (!moduleSpecifier || !moduleSpecifier.startsWith(".")) continue;

            // Resolve the path of the imported file
            const importedSourceFile = ref.getModuleSpecifierSourceFile();
            if (!importedSourceFile) continue;

            const importedPath = path.relative(projectRoot, importedSourceFile.getFilePath());

            // Add the current file to the dependents of the imported file
            const dependentsList = dependents.get(importedPath) ?? [];
            if (!dependentsList.includes(filePath)) dependentsList.push(filePath);
            dependents.set(importedPath, dependentsList);

            // Add the imported file to the imports of the current file
            if (!importedByThis.includes(importedPath)) importedByThis.push(importedPath);
        }
    }

    return { dependents, imports };
}

/**
 * Traverses the transitive dependents graph (BFS) from a source file to
 * answer "what does A affect?" (§13 of the original document).
 *
 * - files: all direct and indirect dependents (without the source file)
 * - depthMap: distance in import hops from the source
 * - maxDepth: maximum depth reached
 *
 * The visited set protects against circular dependencies.
 */
export function findTransitiveDependents(
    graph: DependencyGraph,
    sourceFile: string
): TransitiveImpact {
    const visited = new Set<string>([sourceFile]);
    const depthMap = new Map<string, number>();
    let maxDepth = 0;

    let queue: string[] = [sourceFile];

    while (queue.length > 0) {
        const next: string[] = [];

        for (const file of queue) {
            const parentDepth = depthMap.get(file) ?? 0;

            for (const dependent of graph.dependents.get(file) ?? []) {
                if (visited.has(dependent)) continue;

                visited.add(dependent);
                const depth = parentDepth + 1;
                depthMap.set(dependent, depth);
                maxDepth = Math.max(maxDepth, depth);
                next.push(dependent);
            }
        }

        queue = next;
    }

    const files = Array.from(visited).filter(f => f !== sourceFile);

    return { files, maxDepth, depthMap };
}