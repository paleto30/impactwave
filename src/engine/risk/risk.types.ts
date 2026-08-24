export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskWeights {
    callerImpact: number;
    affectedFiles: number;
    dependencyDepth: number;
    testGaps: number;
    changeSize: number;
    /**
     * Optional separate weight for consumers that are TEST files.
     *
     * When absent (undefined), scoring runs in legacy mode: test consumers
     * are counted inside callerImpact exactly like production ones
     * (pre-1.2 behavior). When present - even explicitly 0 - callerImpact
     * counts only production consumers and test consumers saturate this
     * weight independently.
     */
    testCallerImpact?: number;
}

export interface RiskFactors {
    uniqueConsumers: number;
    /**
     * How many of uniqueConsumers are test files. Subset of
     * uniqueConsumers; ignored when weights run in legacy mode.
     */
    testConsumers?: number;
    transitiveFiles: number;
    maxDepth: number;
    affectedComponents: number;
    uncoveredComponents: number;
    changedLines: number;
}

export interface RiskReason {
    label: string;
    points: number;
}

export interface RiskAssessment {
    score: number;
    level: RiskLevel;
    reasons: RiskReason[];
}