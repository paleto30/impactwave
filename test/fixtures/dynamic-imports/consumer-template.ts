export function loadFromTemplate(): number {
    const mod = require(`./b`);
    return mod.b();
}
