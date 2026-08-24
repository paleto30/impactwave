export async function loadNamed(name: string): Promise<number> {
    const mod = await import(`./c-${name}`);
    const other = await import(`./prefix/${name}/sub`);
    const concatenated = require("./dir" + name);
    const bare = import("lodash-es");
    return mod.n + other.n + concatenated.n + (bare ? 0 : 1);
}
