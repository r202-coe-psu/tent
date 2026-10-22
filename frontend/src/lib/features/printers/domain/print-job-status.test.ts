import { describe, expect, it } from 'vitest';
import {
	isTerminalJobStatus,
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
