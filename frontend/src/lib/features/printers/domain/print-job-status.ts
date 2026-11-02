import type { PrintJobStatus } from './print-job.schema';
import { PRINT_JOB_POLL_TIMEOUT_MS } from './print-job-timing';

export { PRINT_JOB_POLL_TIMEOUT_MS };

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

/** Failed status fetches in a row after which the tablet stops waiting for a job. */
export const MAX_CONSECUTIVE_STATUS_ERRORS = 3;

/**
 * Folds one status-fetch result into the run of consecutive failures. `giveUp` once the status
 * route has failed `MAX_CONSECUTIVE_STATUS_ERRORS` times in a row (403/404, network down), so the
 * tablet stops spinning until the poll timeout; a success starts the count over.
 */
export function trackStatusErrors(
	consecutive: number,
	fetchFailed: boolean
): { consecutive: number; giveUp: boolean } {
	if (!fetchFailed) return { consecutive: 0, giveUp: false };
	const next = consecutive + 1;
	return { consecutive: next, giveUp: next >= MAX_CONSECUTIVE_STATUS_ERRORS };
}
