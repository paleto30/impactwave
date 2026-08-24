/**
 * A reference whose line is pure contract wiring does not represent an
 * active execution of the symbol:
 *
 * - import declarations in every shape (`import {X} from`, `import * as`,
 *   `import type`, side-effect `import "x"`)
 * - re-export declarations (`export {X} from`, `export {X as Y} from`,
 *   `export {default as X} from`, `export * from`, `export * as NS from`)
 * - bare export specifier lists (`export {X}`) — the second half of the
 *   two-statement pass-through idiom; binding a name executes nothing
 *
 * Everything else counts as an active usage, most importantly dynamic
 * imports on the line (`await import("./x")`) and exports whose
 * initializer USES the symbol (`export default build(X)`).
 *
 * Single source of truth shared by the impact assessment (risk counting)
 * and the console reporter (usage listing) so both can never diverge.
 *
 * Heuristic limits (documented): operates on single-line snippets — a
 * multi-line re-export formatted with the specifier list on its own line
 * is not recognized; CJS-style `exports.X = ...` wiring is out of scope.
 */

// "import" must be followed by whitespace, a quote or a brace: this keeps
// dynamic calls like `import("./x")` classified as active.
const IMPORT_DECLARATION = /^\s*import(?:\s|\{|"|')/;

// Re-export declarations and bare export specifier lists. The module
// specifier after `from` is optional: bare `export {X}` closes the
// two-statement pass-through idiom.
const QUOTED = "(?:\"[^\"]*\"|'[^']*'|`[^`]*`)";
const RE_EXPORT = new RegExp(
    "^\\s*export\\s+" +
    "(?:\\*(?:\\s+as\\s+[\\w$]+)?|\\{[^}]*\\})" +
    "(?:\\s+from\\s+" + QUOTED + ")?" +
    "\\s*;?\\s*$"
);

export function isImportOnlyUsage(snippet: string): boolean {
    const line = snippet.trim();
    return IMPORT_DECLARATION.test(line) || RE_EXPORT.test(line);
}
