export async function lazyFormat(cents: number): Promise<string> {
    const mod = await import("./service.js");
    return mod.formatAmount(cents);
}
