export async function loadC(): Promise<number> {
    const mod = await import("./c");
    return mod.c();
}

export async function loadCAgain(): Promise<number> {
    const { c } = await import("./c.js");
    return c();
}
