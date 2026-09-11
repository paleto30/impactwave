import { Node } from "ts-morph";

/**
 * A reference is contract wiring — not an active execution of the symbol —
 * when it lives inside an import or export declaration:
 *
 * - import declarations in every shape (`import {X} from`, `import * as`,
 *   `import type`, and their multi-line spellings)
 * - re-export declarations (`export {X} from`, `export {X as Y} from`,
 *   `export {default as X} from`, `export * from`, `export * as NS from`)
 * - bare export specifier lists (`export {X}`) — the second half of the
 *   two-statement pass-through idiom; binding a name executes nothing
 *
 * Everything else counts as an active usage, most importantly dynamic
 * imports (`await import("./x")`, a CallExpression) and exports whose
 * initializer USES the symbol (`export default build(X)`, an
 * ExportAssignment).
 *
 * The classification reads the AST rather than the text of the reference's
 * line. A line-based rule could not see that
 *
 *     import {
 *         PaymentService,
 *     } from "./payment.service.js";
 *
 * is one import: the reference lands on the line "PaymentService," and was
 * counted as a real consumer, inflating the blast radius with files that
 * merely import the symbol.
 *
 * Single source of truth: consumers are classified once, when collected,
 * and every later stage (risk counting, console listing, JSON output)
 * reads the resulting flag.
 */
export function isImportOnlyReference(node: Node): boolean {
    return (
        node.getFirstAncestor(
            ancestor =>
                Node.isImportDeclaration(ancestor) ||
                Node.isExportDeclaration(ancestor)
        ) !== undefined
    );
}
