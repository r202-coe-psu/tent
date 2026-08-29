import { describe, expect, it } from 'vitest';
import {
	DEFAULT_WEB_CONCURRENCY,
	resolveWorkerCount
} from '../../../server/resolve-worker-count.mjs';

describe('resolveWorkerCount', () => {
	it('defaults to 3 when env is unset, empty, or invalid', () => {
		expect(resolveWorkerCount(undefined, 8)).toBe(DEFAULT_WEB_CONCURRENCY);
		expect(resolveWorkerCount(null, 8)).toBe(DEFAULT_WEB_CONCURRENCY);
		expect(resolveWorkerCount('', 8)).toBe(DEFAULT_WEB_CONCURRENCY);
		expect(resolveWorkerCount('  ', 8)).toBe(DEFAULT_WEB_CONCURRENCY);
		expect(resolveWorkerCount('abc', 8)).toBe(DEFAULT_WEB_CONCURRENCY);
		expect(resolveWorkerCount('0', 8)).toBe(DEFAULT_WEB_CONCURRENCY);
		expect(resolveWorkerCount('-2', 8)).toBe(DEFAULT_WEB_CONCURRENCY);
	});

	it('honors a positive WEB_CONCURRENCY when below CPU count', () => {
		expect(resolveWorkerCount('2', 8)).toBe(2);
		expect(resolveWorkerCount('3', 8)).toBe(3);
	});

	it('clamps to available CPUs', () => {
		expect(resolveWorkerCount('8', 2)).toBe(2);
		expect(resolveWorkerCount('3', 1)).toBe(1);
	});

	it('never returns less than 1 even if cpus is bogus', () => {
		expect(resolveWorkerCount('3', 0)).toBe(1);
		expect(resolveWorkerCount('3', -1)).toBe(1);
		expect(resolveWorkerCount(undefined, Number.NaN)).toBe(1);
	});
});
