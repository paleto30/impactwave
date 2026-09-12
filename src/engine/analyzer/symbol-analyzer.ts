import path from "node:path";
import { type Project, type SourceFile, type Node, type ReferencedSymbol, InterfaceDeclaration, TypeAliasDeclaration, ClassDeclaration, FunctionDeclaration, EnumDeclaration, VariableDeclaration, Scope } from "ts-morph";
import { getProject } from "../project.js";
import { isImportOnlyReference } from "./usage-filter.js";
import type { SymbolImpact } from "./symbol-impact.interface.js";
import type { FileAnalysis } from "../parser/file-analysis.interface.js";

type ExportableNode =
    | InterfaceDeclaration
    | TypeAliasDeclaration
    | ClassDeclaration
    | FunctionDeclaration
    | EnumDeclaration
    | VariableDeclaration;

type ReferenceableNode = {
    findReferences(): ReferencedSymbol[];
};

function rangeIntersectsModifiedLines(
    startLine: number,
    endLine: number,
    modifiedLines: Set<number>
): boolean {
    for (let line = startLine; line <= endLine; line++) {
        if (modifiedLines.has(line)) return true;
    }
    return false;
}

export class SymbolAnalyzer {

    private project: Project;
    private projectRoot: string;

    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
        this.project = getProject(projectRoot);
    }

    /**
     * Resolves the real AST node of an exported symbol by name.
     * Shared between analyzeSymbolImpact and getModifiedSymbolNames
     * to avoid duplicating the lookup chain.
     */
    private getExportNode(sourceFile: SourceFile, symbolName: string): ExportableNode | undefined {
        return (
            sourceFile.getInterface(symbolName) ||
            sourceFile.getTypeAlias(symbolName) ||
            sourceFile.getClass(symbolName) ||
            sourceFile.getFunction(symbolName) ||
            sourceFile.getEnum(symbolName) ||
            sourceFile.getVariableDeclaration(symbolName)
        );
    }

    /**
     * Determines, from a list of exported symbols, which ones have their line
     * range physically overlapping the lines modified by Git. It does not
     * search references (an expensive operation) — only range intersection,
     * for reporting purposes (what to mark as "modified").
     */
    public getModifiedSymbolNames(
        relativePath: string,
        symbolNames: string[],
        modifiedLines: Set<number>
    ): Set<string> {
        const modified = new Set<string>();

        const absolutePath = path.resolve(this.projectRoot, relativePath);
        const sourceFile = this.project.getSourceFile(absolutePath);

        if (!sourceFile || modifiedLines.size === 0) {
            return modified;
        }

        for (const symbolName of symbolNames) {
            const exportNode = this.getExportNode(sourceFile, symbolName);
            if (!exportNode) continue;

            const startLine = exportNode.getStartLineNumber();
            const endLine = exportNode.getEndLineNumber();

            if (rangeIntersectsModifiedLines(startLine, endLine, modifiedLines)) {
                modified.add(symbolName);
            }
        }

        return modified;
    }

    /**
     * Returns the count of modified lines that fall within each symbol's range.
     * Only symbols with at least one modified line intersecting their range
     * are included in the map.
     */
    public getModifiedSymbolLineCounts(
        relativePath: string,
        symbolNames: string[],
        modifiedLines: Set<number>
    ): Map<string, number> {
        const counts = new Map<string, number>();

        const absolutePath = path.resolve(this.projectRoot, relativePath);
        const sourceFile = this.project.getSourceFile(absolutePath);

        if (!sourceFile || modifiedLines.size === 0) {
            return counts;
        }

        for (const symbolName of symbolNames) {
            const exportNode = this.getExportNode(sourceFile, symbolName);
            if (!exportNode) continue;

            const startLine = exportNode.getStartLineNumber();
            const endLine = exportNode.getEndLineNumber();

            let count = 0;
            for (const line of modifiedLines) {
                if (line >= startLine && line <= endLine) {
                    count++;
                }
            }
            if (count > 0) {
                counts.set(symbolName, count);
            }
        }

        return counts;
    }

    /**
     * Returns the modified method names for each exported class.
     * For each class in the source file, determines which methods have their
     * line range intersecting with the modified lines from Git.
     * Returns a Map<className, [methodName1, methodName2, ...]>.
     */
    public getModifiedClassMethods(
        relativePath: string,
        analysis: FileAnalysis,
        modifiedLines: Set<number>
    ): Map<string, string[]> {
        const modifiedMethods = new Map<string, string[]>();

        const absolutePath = path.resolve(this.projectRoot, relativePath);
        const sourceFile = this.project.getSourceFile(absolutePath);

        if (!sourceFile || modifiedLines.size === 0 || !analysis.exports.classes) {
            return modifiedMethods;
        }

        for (const clazz of analysis.exports.classes) {
            const className = clazz.name;
            const methods: string[] = [];

            const classDeclaration = sourceFile.getClass(className);
            if (!classDeclaration) continue;

            for (const method of classDeclaration.getMethods()) {
                const methodName = method.getName();
                if (!methodName) continue;
                // Only report public API surface: skip private/protected and
                // ECMAScript-private (#foo) methods — they cannot affect consumers.
                if (methodName.startsWith('#')) continue;
                if (method.getScope() !== Scope.Public) continue;

                const methodStart = method.getStartLineNumber();
                const methodEnd = method.getEndLineNumber();

                // Check if any modified line falls within this method's range
                for (const line of modifiedLines) {
                    if (line >= methodStart && line <= methodEnd) {
                        methods.push(methodName);
                        break; // only add once per method
                    }
                }
            }

            if (methods.length > 0) {
                modifiedMethods.set(className, methods);
            }
        }

        return modifiedMethods;
    }

    /**
     * Collects the real usages of a referenceable node (class, function,
     * method...) across the project: file, line and source snippet of every
     * non-definition reference, deduplicated by position.
     */
    private collectConsumers(referenceable: ReferenceableNode): SymbolImpact["consumers"] {
        const consumersMap = new Map<string, SymbolImpact["consumers"][number]>();

        for (const ref of referenceable.findReferences()) {
            for (const refNode of ref.getReferences()) {
                const refSourceFile = refNode.getSourceFile();
                const refFilePath = path.relative(this.projectRoot, refSourceFile.getFilePath());

                if (refNode.isDefinition()) continue;

                const node = refNode.getNode();
                const line = refSourceFile.getLineAndColumnAtPos(node.getStart()).line;
                const snippet = refSourceFile.getFullText().split('\n')[line - 1]?.trim() || '';

                const key = `${refFilePath}:${line}`;
                if (!consumersMap.has(key)) {
                    consumersMap.set(key, {
                        filePath: refFilePath,
                        line,
                        snippet,
                        importOnly: isImportOnlyReference(node)
                    });
                }
            }
        }

        return Array.from(consumersMap.values());
    }

    public analyzeSymbolImpact(
        relativePath: string,
        symbolNames: string[],
        modifiedLines?: Set<number>
    ): SymbolImpact[] {
        const absolutePath = path.resolve(this.projectRoot, relativePath);
        const sourceFile = this.project.getSourceFile(absolutePath);

        if (!sourceFile || symbolNames.length === 0) {
            return []
        }

        const impacts: SymbolImpact[] = [];

        for (const symbolName of symbolNames) {
            const exportNode = this.getExportNode(sourceFile, symbolName);

            if (!exportNode) continue;

            if (modifiedLines && modifiedLines.size > 0) {
                const startLine = exportNode.getStartLineNumber();
                const endLine = exportNode.getEndLineNumber();

                if (!rangeIntersectsModifiedLines(startLine, endLine, modifiedLines)) {
                    continue;
                }
            }

            impacts.push({
                symbolName: symbolName,
                filePath: relativePath,
                consumers: this.collectConsumers(exportNode)
            });
        }

        return impacts;
    }

    /**
     * Finds the consumers of each specific modified class method (not the
     * whole class). Class-level references (constructor injection, type
     * annotations) do not include call sites like "service.calculate()";
     * resolving references on the MethodDeclaration itself is what reveals
     * them, enabling the method-level cascade described in §12-13.
     */
    public getModifiedMethodImpacts(
        relativePath: string,
        modifiedClassMethods: Map<string, string[]>
    ): SymbolImpact[] {
        const absolutePath = path.resolve(this.projectRoot, relativePath);
        const sourceFile = this.project.getSourceFile(absolutePath);

        if (!sourceFile || modifiedClassMethods.size === 0) {
            return [];
        }

        const impacts: SymbolImpact[] = [];

        for (const [className, methodNames] of modifiedClassMethods) {
            const classDeclaration = sourceFile.getClass(className);
            if (!classDeclaration) continue;

            for (const methodName of methodNames) {
                const method = classDeclaration.getMethod(methodName);
                if (!method) continue;

                impacts.push({
                    symbolName: `${className}.${methodName}`,
                    filePath: relativePath,
                    consumers: this.collectConsumers(method)
                });
            }
        }

        return impacts;
    }
}