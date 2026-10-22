import type { PrintJobStatus } from './print-job.schema';

/** Stop polling for a job after this long and tell the user the printer did not answer. */
export const PRINT_JOB_POLL_TIMEOUT_MS = 60_000;

export function isTerminalJobStatus(status: PrintJobStatus): boolean {
	return status === 'printed' || status === 'failed' || status === 'expired';
}

export interface PollInput {
	/** Latest known status; undefined until the first response arrives. */
	status: PrintJobStatus | undefined;
	startedAtMs: number;
	nowMs: number;
}

export function shouldKeepPolling({ status, startedAtMs, nowMs }: PollInput): boolean {
	if (status !== undefined && isTerminalJobStatus(status)) return false;
	return nowMs - startedAtMs < PRINT_JOB_POLL_TIMEOUT_MS;
}
