export async function loadG(): Promise<number> {
    const mod = await import("./cycle-b");
    return mod.g();
}
