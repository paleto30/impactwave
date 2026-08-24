export function loadB(flag: boolean): number {
    if (flag) {
        const mod = require("./b");
        return mod.b();
    }
    return 0;
}
