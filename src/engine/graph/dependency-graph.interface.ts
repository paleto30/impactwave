export interface DependencyGraph {
    // "imported file" -> "files that import it" (who depends on this)
    dependents: Map<string, string[]>;
    // "file" -> "files it imports" (what does this affect directly)
    imports: Map<string, string[]>;
}