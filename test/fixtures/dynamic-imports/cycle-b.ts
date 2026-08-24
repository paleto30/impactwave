import { loadG } from "./cycle-a.js";

export function g(): number {
    return typeof loadG === "function" ? 7 : 0;
}
