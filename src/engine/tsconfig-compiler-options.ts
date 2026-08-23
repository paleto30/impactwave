import { readFileSync } from "node:fs";
import path from "node:path";
import {
    ModuleKind,
    ModuleResolutionKind,
    NewLineKind,
    ScriptTarget
} from "ts-morph";

/**
 * Minimal tsconfig reader that extracts compilerOptions WITHOUT letting
 * TypeScript enumerate the filesystem.
 *
 * Why hand-rolled instead of ts-morph/ts APIs?
 * Constructing a Project with `tsConfigFilePath` makes TypeScript expand the
 * config's include patterns (default: every file under the project root) by
 * walking each directory on disk. Unreadable directories (e.g. Docker data
 * folders like pg_data owned by another uid) then crash the whole analysis
 * with EACCES. Reading the JSON ourselves keeps compilerOptions (path aliases,
 * decorators, target, ...) while file discovery stays fully under our
 * control — see project-files.ts.
 */

const COMPILER_OPTIONS_KEY = "compilerOptions";
const MAX_EXTENDS_DEPTH = 16;

/**
 * Options whose JSON values are enum names ("es2020", "commonjs", ...).
 * createProgram rejects raw strings, so they must be converted to their
 * numeric value before reaching the Project.
 */
const ENUM_OPTION_MAPS: Record<string, Record<string, number>> = {
    target: ScriptTarget as unknown as Record<string, number>,
    module: ModuleKind as unknown as Record<string, number>,
    moduleResolution: ModuleResolutionKind as unknown as Record<string, number>,
    newLine: NewLineKind as unknown as Record<string, number>
};

function normalizeEnumValues(options: Record<string, unknown>): Record<string, unknown> {
    const normalized = { ...options };

    for (const [key, enumMap] of Object.entries(ENUM_OPTION_MAPS)) {
        const value = normalized[key];
        if (typeof value !== "string") continue;

        const match = Object.entries(enumMap).find(
            ([name, numeric]) =>
                typeof numeric === "number" &&
                name.toLowerCase() === value.toLowerCase()
        );

        if (match) {
            normalized[key] = match[1];
        } else {
            // Unknown value for this option: drop it rather than hand an
            // invalid string to createProgram later
            delete normalized[key];
        }
    }

    return normalized;
}

export function readTsConfigCompilerOptions(
    tsconfigPath: string
): Record<string, unknown> {
    const resolved = path.resolve(tsconfigPath);
    const config = resolveConfig(resolved, new Set<string>(), 0);
    const options = config[COMPILER_OPTIONS_KEY];
    if (typeof options !== "object" || options === null) {
        return {};
    }
    return normalizeEnumValues(options as Record<string, unknown>);
}

function resolveConfig(
    filePath: string,
    seen: Set<string>,
    depth: number
): Record<string, unknown> {
    // Malformed cycles or pathological chains degrade to empty options
    // instead of crashing: a bad tsconfig must never block the analysis.
    if (depth > MAX_EXTENDS_DEPTH || seen.has(filePath)) {
        return {};
    }
    seen.add(filePath);

    let parsed: unknown;
    try {
        parsed = JSON.parse(stripJsonComments(readFileSync(filePath, "utf8")));
    } catch {
        return {};
    }
    if (typeof parsed !== "object" || parsed === null) {
        return {};
    }

    const config = parsed as Record<string, unknown>;
    const extendsSpec = config.extends;
    let parent: Record<string, unknown> = {};
    if (typeof extendsSpec === "string") {
        parent = resolveConfig(
            resolveExtendsTarget(extendsSpec, filePath),
            seen,
            depth + 1
        );
    }

    const parentOptions = parent[COMPILER_OPTIONS_KEY];
    const ownOptions = config[COMPILER_OPTIONS_KEY];

    return {
        ...parent,
        ...config,
        [COMPILER_OPTIONS_KEY]: {
            ...(typeof parentOptions === "object" && parentOptions !== null
                ? (parentOptions as Record<string, unknown>)
                : {}),
            ...(typeof ownOptions === "object" && ownOptions !== null
                ? (ownOptions as Record<string, unknown>)
                : {})
        }
    };
}

function resolveExtendsTarget(specifier: string, fromFile: string): string {
    const withoutSuffix = specifier.endsWith(".json")
        ? specifier
        : `${specifier}.json`;

    if (path.isAbsolute(withoutSuffix)) {
        return withoutSuffix;
    }

    if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const direct = path.resolve(path.dirname(fromFile), withoutSuffix);
        if (exists(direct)) {
            return direct;
        }
        return path.resolve(path.dirname(fromFile), specifier, "tsconfig.json");
    }

    // Bare specifier ("@tsconfig/node22"): walk up node_modules like Node
    const baseDir = path.dirname(fromFile);
    let cursor = baseDir;
    for (;;) {
        for (const candidate of [
            path.join(cursor, "node_modules", withoutSuffix),
            path.join(cursor, "node_modules", specifier, "tsconfig.json")
        ]) {
            if (exists(candidate)) {
                return candidate;
            }
        }
        const parent = path.dirname(cursor);
        if (parent === cursor) {
            break;
        }
        cursor = parent;
    }
    return path.resolve(baseDir, withoutSuffix);
}

function exists(candidate: string): boolean {
    try {
        readFileSync(candidate);
        return true;
    } catch {
        return false;
    }
}

/**
 * Removes // and /* *\/ comments plus trailing commas so strict JSON.parse
 * accepts real-world tsconfigs. String literals are respected.
 */
function stripJsonComments(source: string): string {
    let result = "";
    let index = 0;

    while (index < source.length) {
        const char = source[index];

        if (char === '"') {
            const end = findStringEnd(source, index);
            result += source.slice(index, end);
            index = end;
            continue;
        }

        if (char === "/" && source[index + 1] === "/") {
            index = source.indexOf("\n", index);
            if (index === -1) break;
            continue;
        }

        if (char === "/" && source[index + 1] === "*") {
            const end = source.indexOf("*/", index + 2);
            if (end === -1) break;
            index = end + 2;
            continue;
        }

        result += char;
        index += 1;
    }

    return result.replace(/,\s*([}\]])/g, "$1");
}

/** Returns the index right after the closing quote of the string at start. */
function findStringEnd(source: string, start: number): number {
    let index = start + 1;
    while (index < source.length) {
        if (source[index] === "\\") {
            index += 2;
            continue;
        }
        if (source[index] === '"') {
            return index + 1;
        }
        index += 1;
    }
    return source.length;
}
