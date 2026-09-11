import type { FileStatus } from "./file-status.js";

export interface ChangedFile {
    path: string;
    status: FileStatus;
    /**
     * Where a renamed file came from. Present only for renames, so the diff
     * can be taken against the previous content instead of treating the new
     * path as a file where everything changed.
     */
    previousPath?: string;
}