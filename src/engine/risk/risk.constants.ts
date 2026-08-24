import type { RiskWeights } from "./risk.types.js";

export const DEFAULT_RISK_WEIGHTS: RiskWeights = {
    callerImpact: 30,
    affectedFiles: 20,
    dependencyDepth: 15,
    testGaps: 20,
    changeSize: 15
};

// Valid keys for --risk-weights. testCallerImpact is optional: when it is
// not configured, scoring stays bit-compatible with the pre-split behavior.
export const RISK_WEIGHT_KEYS = [
    "callerImpact",
    "affectedFiles",
    "dependencyDepth",
    "testGaps",
    "changeSize",
    "testCallerImpact"
] as const;

// Saturation thresholds for each factor (proportional scoring)
export const CALLER_IMPACT_THRESHOLD = 10;
export const AFFECTED_FILES_THRESHOLD = 15;
export const DEPENDENCY_DEPTH_THRESHOLD = 4;
export const CHANGE_SIZE_THRESHOLD = 200;

// Level boundaries and max score
export const LOW_MAX = 25;
export const MEDIUM_MAX = 50;
export const HIGH_MAX = 75;
export const MAX_SCORE = 100;

// Calibration reference: see docs/RISK_CALIBRATION.md at the repo root.
// Typical commits score LOW (0-25); 2-4 untested consumers reach MEDIUM;
// only massive scaffolding/architecture changes reach HIGH/CRITICAL.