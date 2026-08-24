import path from "node:path";
import { Node, SyntaxKind, ts, type CallExpression,
    type Project, type SourceFile } from "ts-morph";
import { getProject } from "../project.js";
import type { DependencyGraph } from "./dependency-graph.interface.js";
import type { TransitiveImpact } from "./transitive-impact.interface.js";

/**
 * Extracts the module specifier of a dynamic call (`import(...)`,
 * `require(...)`, `require.resolve(...)`) when its first argument is a
 * statically known string: string literals AND substitution-free template
 * literals (`import(`+"`"+`./x`+"`"+`)`) both count as static.
 *
 * Returns undefined for anything data-driven (template literals with
 * `${}`, concatenation, identifiers, spreads): those cannot be resolved
 * without executing the program.
 */
function getStaticSpecifierText(argument: Node | undefined): string | undefined {
    if (
        argument !== undefined &&
        (Node.isStringLiteral(argument) ||
            Node.isNoSubstitutionTemplateLiteral(argument))
    ) {
        return argument.getLiteralText();
    }
    return undefined;
}

/**
 * Classifies a call expression as one of the dynamic module-loading forms
 * tracked by the graph, or undefined when it is any other call.
 *
 * Assumption (same heuristic bundlers use): every identifier spelled
 * "require" is CommonJS require. A local function named `require` that
 * takes strings would be misread — accepted trade-off, documented.
 */
function getDynamicCallKind(call: CallExpression):
    "import" | "require" | "require.resolve" | undefined {
    const expression = call.getExpression();

    if (expression.getKind() === SyntaxKind.ImportKeyword) return "import";

    if (Node.isIdentifier(expression)) {
        return expression.getText() === "require" ? "require" : undefined;
    }

    if (Node.isPropertyAccessExpression(expression)) {
        const object = expression.getExpression();
        if (
            expression.getName() === "resolve" &&
            Node.isIdentifier(object) &&
            object.getText() === "require"
        ) {
            return "require.resolve";
        }
    }

    return undefined;
}

/**
 * Indexes every loaded source file by normalized absolute path so dynamic
 * specifiers can be resolved without re-parsing anything on disk.
 */
function buildLoadedFilesIndex(project: Project): Map<string, SourceFile> {
    const index = new Map<string, SourceFile>();
    for (const file of project.getSourceFiles()) {
        index.set(path.normalize(file.getFilePath()), file);
    }
    return index;
}

/**
 * Absolute-path candidates for a relative specifier: direct .ts/.tsx,
 * the ESM `.js -> .ts` spelling (and friends), and directory indexes.
 */
function getCandidatePaths(specifier: string, importerDirectory: string): string[] {
    const base = path.resolve(importerDirectory, specifier);
    const extension = path.extname(base).toLowerCase();

    const candidates: string[] = [];
    if (extension === ".ts" || extension === ".tsx") {
        candidates.push(base);
    } else if (/^\.(js|jsx|mjs|cjs)$/.test(extension)) {
        const mapped = extension.endsWith(".jsx")
            ? ".tsx"
            : extension === ".js" ? ".ts"
            : extension === ".mjs" ? ".mts" : ".cts";
        candidates.push(base.slice(0, base.length - extension.length) + mapped);
    } else {
        candidates.push(`${base}.ts`, `${base}.tsx`);
    }

    candidates.push(path.join(base, "index.ts"), path.join(base, "index.tsx"));
    return candidates;
}

/**
 * Resolves a relative dynamic specifier to a loaded source file.
 *
 * 1. TypeScript's own module resolution (honors compilerOptions such as
 *    moduleResolution/paths), then
 * 2. candidate probing against the already-loaded file set — covers
 *    extensionless CommonJS-style specifiers TypeScript may reject under
 *    ESM settings but that still exist in real projects.
 *
 * Only files loaded into the project can be graph nodes, so a resolution
 * landing outside them (node_modules, .d.ts, sibling projects) is "no
 * target" here.
 */
function resolveRelativeSpecifier(
    specifier: string,
    importer: SourceFile,
    project: Project,
    loadedFiles: Map<string, SourceFile>
): SourceFile | undefined {
    const { resolvedModule } = ts.resolveModuleName(
        specifier,
        importer.getFilePath(),
        project.getCompilerOptions(),
        ts.sys
    );

    if (resolvedModule) {
        const resolved = loadedFiles.get(
            path.normalize(resolvedModule.resolvedFileName)
        );
        if (resolved) return resolved;
    }

    for (const candidate of getCandidatePaths(
        specifier,
        path.dirname(importer.getFilePath())
    )) {
        const hit = loadedFiles.get(path.normalize(candidate));
        if (hit) return hit;
    }

    return undefined;
}

export function buildDependencyGraph(projectRoot: string): DependencyGraph {
    const project = getProject(projectRoot);

    // All project source files are already loaded by getProject through the
    // resilient walk (idempotent: files already added are reused, not
    // re-parsed)
    const loadedFiles = buildLoadedFilesIndex(project);

    const dependents = new Map<string, string[]>();
    const imports = new Map<string, string[]>();

    // Files whose dynamic calls have non-static arguments. They DO depend
    // on unknown modules; recording them (instead of dropping silently)
    // keeps the graph honest about what it could not see.
    const unresolvedDynamicImports = new Map<string, number>();

    /**
     * Registers "filePath depends on importedPath" in both directions,
     * deduplicated (one edge per file pair).
     */
    const addEdge = (importedPath: string, filePath: string): void => {
        const dependentsList = dependents.get(importedPath) ?? [];
        if (!dependentsList.includes(filePath)) dependentsList.push(filePath);
        dependents.set(importedPath, dependentsList);

        const importedByThis = imports.get(filePath) ?? [];
        if (!importedByThis.includes(importedPath)) importedByThis.push(importedPath);
        imports.set(filePath, importedByThis);
    };

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

            addEdge(importedPath, filePath);
        }

        // Dynamic module loading (`import(...)`, `require(...)`,
        // `require.resolve(...)`). These calls appear anywhere in the tree
        // (conditionals, async functions, `.then()` chains), so the scan is
        // position-independent instead of declaration-based.
        for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
            if (!getDynamicCallKind(call)) continue;

            const specifierText = getStaticSpecifierText(call.getArguments()[0]);

            if (specifierText === undefined) {
                // Non-static argument: a real dependency we cannot point at
                // a file. Counted, never silently dropped.
                unresolvedDynamicImports.set(
                    filePath,
                    (unresolvedDynamicImports.get(filePath) ?? 0) + 1
                );
                continue;
            }

            // Same policy as static imports: bare specifiers are packages,
            // outside the intra-project blast radius.
            if (!specifierText.startsWith(".")) continue;

            const importedSourceFile = resolveRelativeSpecifier(
                specifierText,
                sourceFile,
                project,
                loadedFiles
            );

            if (!importedSourceFile) {
                // Relative but unresolvable (points outside the analyzed
                // sources, exotic resolution): recorded as uncertainty too.
                unresolvedDynamicImports.set(
                    filePath,
                    (unresolvedDynamicImports.get(filePath) ?? 0) + 1
                );
                continue;
            }

            const importedPath = path.relative(projectRoot, importedSourceFile.getFilePath());
            addEdge(importedPath, filePath);
        }
    }

    return { dependents, imports, unresolvedDynamicImports };
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
