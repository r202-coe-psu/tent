import { describe, expect, it } from 'vitest';
import { MAX_LABELS_PER_JOB } from './print-job.schema';
import {
	JOB_TTL_SEC,
	leaseSecFor,
	PRINT_JOB_POLL_TIMEOUT_MS,
	SWEEP_INTERVAL_SEC
} from './print-job-timing';

describe('leaseSecFor', () => {
	it('grows with the number of labels in the job', () => {
		expect(leaseSecFor(1)).toBe(95);
		expect(leaseSecFor(MAX_LABELS_PER_JOB)).toBe(190);
	});
});

describe('PRINT_JOB_POLL_TIMEOUT_MS', () => {
	it('outlasts the longest a full job can stay open on the server, so retry never doubles a live job', () => {
		const longestOpenSec = JOB_TTL_SEC + leaseSecFor(MAX_LABELS_PER_JOB) + SWEEP_INTERVAL_SEC;
		expect(PRINT_JOB_POLL_TIMEOUT_MS).toBeGreaterThan(longestOpenSec * 1000);
	});
});
