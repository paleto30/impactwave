export interface SymbolImpact {
    symbolName: string;
    filePath: string;
    consumers: {
        filePath: string;
        line: number;
        snippet: string;
        /**
         * True when the reference is only contract wiring (import /
         * export-from) instead of an active execution. Classified from the
         * AST when the consumer is collected — see usage-filter.
         */
        importOnly: boolean;
    }[];
}