import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLazySweep, retainIfDue, startPrintHousekeeping } from './lazy-sweep';
import type { PrintJobRetentionStore, PrintJobStore } from './print-queue.server';

/** Records which housekeeping calls reached the store; every query finds nothing. */
function recordingStore() {
	const calls: string[] = [];
	const store: PrintJobStore & PrintJobRetentionStore = {
		async findJobs({ status }) {
			calls.push(`findJobs:${status}`);
			return [];
		},
		async get() {
			return null;
		},
		async put() {
			return { conflict: true };
		},
		async getLabels() {
			return [];
		},
		async pendingCursor() {
			return '0';
		},
		async waitForPending() {},
		async findFinishedBefore() {
			calls.push('findFinishedBefore');
			return [];
		},
		async purge() {},
		async compact() {
			calls.push('compact');
		}
	};
	return { store, calls };
}

beforeEach(() => resetLazySweep());
afterEach(() => {
	resetLazySweep();
	vi.useRealTimers();
});

describe('retainIfDue', () => {
	it('runs retention at most once an hour', async () => {
		const { store, calls } = recordingStore();
		const t0 = new Date('2026-10-22T03:00:00.000Z');

		await retainIfDue(store, t0);
		await retainIfDue(store, new Date(t0.getTime() + 59 * 60_000));
		expect(calls.filter((c) => c === 'compact')).toHaveLength(1);

		await retainIfDue(store, new Date(t0.getTime() + 60 * 60_000));
		expect(calls.filter((c) => c === 'compact')).toHaveLength(2);
	});

	it('never throws when the store fails', async () => {
		const { store } = recordingStore();
		store.findFinishedBefore = async () => {
			throw new Error('couch down');
		};

		await expect(retainIfDue(store, new Date())).resolves.toBeUndefined();
	});
});

describe('startPrintHousekeeping', () => {
	it('sweeps and applies retention on a timer, without any Pi polling', async () => {
		vi.useFakeTimers({ now: new Date('2026-10-22T03:00:00.000Z') });
		const { store, calls } = recordingStore();

		startPrintHousekeeping(store, { isProvisioned: async () => true });
		expect(calls).toEqual([]);
		await vi.advanceTimersByTimeAsync(30_000);

		expect(calls).toEqual(
			expect.arrayContaining([
				'findJobs:printing',
				'findJobs:pending',
				'findFinishedBefore',
				'compact'
			])
		);
	});

	it('leaves the database alone until DB `printing` exists', async () => {
		vi.useFakeTimers();
		const { store, calls } = recordingStore();

		startPrintHousekeeping(store, { isProvisioned: async () => false });
		await vi.advanceTimersByTimeAsync(90_000);

		expect(calls).toEqual([]);
	});

	it('starts one timer per process however often it is called', async () => {
		vi.useFakeTimers();
		const { store, calls } = recordingStore();

		startPrintHousekeeping(store, { isProvisioned: async () => true });
		startPrintHousekeeping(store, { isProvisioned: async () => true });
		await vi.advanceTimersByTimeAsync(30_000);

		expect(calls.filter((c) => c === 'findJobs:printing')).toHaveLength(1);
	});
});
