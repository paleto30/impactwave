export interface DependencyGraph {
    // "imported file" -> "files that import it" (who depends on this)
    dependents: Map<string, string[]>;
    // "file" -> "files it imports" (what does this affect directly).
    // Includes static import/export-from declarations AND statically
    // resolvable dynamic calls (import("..."), require("..."),
    // require.resolve("...")).
    imports: Map<string, string[]>;
    // "file" -> number of dynamic module loads whose argument is not a
    // static string (template literals with substitutions, concatenation,
    // relative specifiers that resolve nowhere). These are real
    // dependencies the graph cannot point at a file: recorded instead of
    // silently dropped so consumers of the graph know what it could not see.
    unresolvedDynamicImports: Map<string, number>;
}
