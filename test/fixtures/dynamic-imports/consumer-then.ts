export function loadE(): Promise<number> {
    return import("./e").then(mod => mod.e());
}
