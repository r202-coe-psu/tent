import { describe, expect, it } from 'vitest';
import {
	isTerminalJobStatus,
	trackStatusErrors,
	PRINT_JOB_POLL_TIMEOUT_MS,
	shouldKeepPolling
} from './print-job-status';

describe('isTerminalJobStatus', () => {
	it.each([
		['pending', false],
		['printing', false],
		['printed', true],
		['failed', true],
		['expired', true]
	] as const)('%s -> %s', (status, expected) => {
		expect(isTerminalJobStatus(status)).toBe(expected);
	});
});

describe('shouldKeepPolling', () => {
	const startedAtMs = 1_000_000;

	it('keeps polling a printing job within the timeout', () => {
		expect(
			shouldKeepPolling({
				status: 'printing',
				startedAtMs,
				nowMs: startedAtMs + PRINT_JOB_POLL_TIMEOUT_MS - 1
			})
		).toBe(true);
	});

	it('keeps polling before the first status arrives', () => {
		expect(shouldKeepPolling({ status: undefined, startedAtMs, nowMs: startedAtMs })).toBe(true);
	});

	it('stops polling at the timeout', () => {
		expect(
			shouldKeepPolling({
				status: 'pending',
				startedAtMs,
				nowMs: startedAtMs + PRINT_JOB_POLL_TIMEOUT_MS
			})
		).toBe(false);
	});

	it('stops polling once the job is terminal', () => {
		expect(shouldKeepPolling({ status: 'printed', startedAtMs, nowMs: startedAtMs + 1_000 })).toBe(
			false
		);
	});
});

describe('trackStatusErrors', () => {
	it('tolerates two failed status fetches in a row and gives up on the third', () => {
		expect(trackStatusErrors(0, true)).toEqual({ consecutive: 1, giveUp: false });
		expect(trackStatusErrors(1, true)).toEqual({ consecutive: 2, giveUp: false });
		expect(trackStatusErrors(2, true)).toEqual({ consecutive: 3, giveUp: true });
	});

	it('forgets earlier failures once a status fetch succeeds', () => {
		expect(trackStatusErrors(2, false)).toEqual({ consecutive: 0, giveUp: false });
	});
});
