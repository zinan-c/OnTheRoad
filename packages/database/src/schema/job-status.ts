export const JOB_RUN_STATUSES = [
  "pending",
  "running",
  "retry_wait",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number];

const TRANSITIONS: Readonly<Record<JobRunStatus, readonly JobRunStatus[]>> = {
  pending: ["running", "cancelled"],
  running: ["retry_wait", "succeeded", "failed", "cancelled"],
  retry_wait: ["running", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export function canTransitionJob(from: JobRunStatus, to: JobRunStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertJobTransition(from: JobRunStatus, to: JobRunStatus): void {
  if (!canTransitionJob(from, to)) {
    throw new Error(`Invalid job status transition: ${from} -> ${to}`);
  }
}
