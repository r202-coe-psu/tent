import { describe, expect, it } from 'vitest';
import {
	claimNextJob,
	failInFlight,
	PrintJobConflictError,
	reportResult,
	sweepJobs,
	waitForNextJob,
	type PrintJobDoc,
	type PrintJobPutResult,
	type PrintJobStore
} from './print-queue.server';

const PRINTER = 'print_device:printer-sh001-reg1';

function pendingJob(
	ulid: string,
	createdAt: string,
	overrides: Partial<PrintJobDoc> = {}
): PrintJobDoc {
	return {
		_id: `print_job:${ulid}`,
		_rev: '1-a',
		type: 'print_job',
		schema_v: 1,
		shelter_code: 'SH001',
		printer_id: PRINTER,
		status: 'pending',
		label_count: 2,
		source: 'walk_in',
		created_at: createdAt,
		created_by: 'staff-a',
		expires_at: '2026-10-22T03:10:00.000Z',
		claimed_at: null,
		lease_until: null,
		finished_at: null,
		printed: 0,
		error_code: null,
		...overrides
	};
}

interface WaitCall {
	printerId: string;
	since: string;
	timeoutMs: number;
}

/** In-memory fake of our own PrintJobStore port. Returns pending jobs in insertion order. */
function fakeStore(
	docs: PrintJobDoc[],
	labels: Record<string, string[]>,
	opts: {
		conflictOn?: string[];
		/** Runs while the store is "waiting for a change"; may add docs / advance the clock / abort. */
		onWait?: (call: WaitCall) => void;
	} = {}
) {
	const stored = new Map(docs.map((d) => [d._id, d]));
	const calls: string[] = [];
	const waitCalls: WaitCall[] = [];
	let seq = 0;
	const store: PrintJobStore = {
		async pendingCursor() {
			calls.push('pendingCursor');
			seq += 1;
			return `seq-${seq}`;
		},
		async waitForPending(printerId, since, { timeoutMs }) {
			calls.push('waitForPending');
			const call = { printerId, since, timeoutMs };
			waitCalls.push(call);
			opts.onWait?.(call);
		},
		async get(id) {
			calls.push('get');
			return stored.get(id) ?? null;
		},
		async findJobs({ status, printerId }) {
			calls.push('findJobs');
			return [...stored.values()].filter(
				(d) => d.status === status && (printerId === undefined || d.printer_id === printerId)
			);
		},
		async put(doc): Promise<PrintJobPutResult> {
			if (opts.conflictOn?.includes(doc._id)) return { conflict: true };
			stored.set(doc._id, doc);
			return { ok: true, rev: '2-b' };
		},
		async getLabels(jobId) {
			return labels[jobId] ?? [];
		}
	};
	return { store, stored, calls, waitCalls };
}

describe('claimNextJob', () => {
	it('claims the oldest pending job for the printer and leases it from the injected now', async () => {
		const { store, stored } = fakeStore(
			[
				pendingJob('01JB0000000000000000000002', '2026-10-22T03:00:05.000Z'),
				pendingJob('01JB0000000000000000000001', '2026-10-22T03:00:01.000Z'),
				pendingJob('01JB0000000000000000000003', '2026-10-22T03:00:09.000Z')
			],
			{ 'print_job:01JB0000000000000000000001': ['AAA=', 'BBB='] }
		);

		const claimed = await claimNextJob(store, PRINTER, {
			now: new Date('2026-10-22T03:01:00.000Z')
		});

		expect(claimed).toEqual({
			job: {
				id: '01JB0000000000000000000001',
				label_count: 2,
				lease_until: '2026-10-22T03:02:30.000Z'
			},
			labels: ['AAA=', 'BBB=']
		});
		expect(stored.get('print_job:01JB0000000000000000000001')).toMatchObject({
			status: 'printing',
			claimed_at: '2026-10-22T03:01:00.000Z',
			lease_until: '2026-10-22T03:02:30.000Z'
		});
	});

	it('falls through to the next oldest pending job when the oldest was claimed by another agent', async () => {
		const { store, stored } = fakeStore(
			[
				pendingJob('01JB0000000000000000000001', '2026-10-22T03:00:01.000Z'),
				pendingJob('01JB0000000000000000000002', '2026-10-22T03:00:05.000Z')
			],
			{ 'print_job:01JB0000000000000000000002': ['CCC='] },
			{ conflictOn: ['print_job:01JB0000000000000000000001'] }
		);

		const claimed = await claimNextJob(store, PRINTER, {
			now: new Date('2026-10-22T03:01:00.000Z')
		});

		expect(claimed).toEqual({
			job: {
				id: '01JB0000000000000000000002',
				label_count: 2,
				lease_until: '2026-10-22T03:02:30.000Z'
			},
			labels: ['CCC=']
		});
		expect(stored.get('print_job:01JB0000000000000000000001')?.status).toBe('pending');
	});

	it('returns null when every pending job conflicts', async () => {
		const { store } = fakeStore(
			[
				pendingJob('01JB0000000000000000000001', '2026-10-22T03:00:01.000Z'),
				pendingJob('01JB0000000000000000000002', '2026-10-22T03:00:05.000Z')
			],
			{},
			{
				conflictOn: ['print_job:01JB0000000000000000000001', 'print_job:01JB0000000000000000000002']
			}
		);

		const claimed = await claimNextJob(store, PRINTER, {
			now: new Date('2026-10-22T03:01:00.000Z')
		});

		expect(claimed).toBeNull();
	});

	it('expires a pending job whose expires_at has passed (dropping its attachments) and claims the next valid one', async () => {
		const { store, stored } = fakeStore(
			[
				pendingJob('01JB0000000000000000000001', '2026-10-22T03:00:01.000Z', {
					expires_at: '2026-10-22T03:01:00.000Z',
					_attachments: { 'label-000.png': { content_type: 'image/png', stub: true } }
				}),
				pendingJob('01JB0000000000000000000002', '2026-10-22T03:00:05.000Z')
			],
			{ 'print_job:01JB0000000000000000000002': ['DDD='] }
		);

		const claimed = await claimNextJob(store, PRINTER, {
			now: new Date('2026-10-22T03:01:00.000Z')
		});

		expect(claimed?.job.id).toBe('01JB0000000000000000000002');
		const expired = stored.get('print_job:01JB0000000000000000000001');
		expect(expired).toMatchObject({
			status: 'expired',
			finished_at: '2026-10-22T03:01:00.000Z'
		});
		expect(expired).not.toHaveProperty('_attachments');
	});

	it('keeps the label attachments on the doc while it is claimed as printing', async () => {
		const { store, stored } = fakeStore(
			[
				pendingJob('01JB0000000000000000000001', '2026-10-22T03:00:01.000Z', {
					_attachments: { 'label-000.png': { content_type: 'image/png', stub: true } }
				})
			],
			{}
		);

		await claimNextJob(store, PRINTER, { now: new Date('2026-10-22T03:01:00.000Z') });

		expect(stored.get('print_job:01JB0000000000000000000001')).toMatchObject({
			status: 'printing',
			_attachments: { 'label-000.png': { content_type: 'image/png', stub: true } }
		});
	});
});

describe('waitForNextJob', () => {
	function clock(startIso: string) {
		let t = Date.parse(startIso);
		return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
	}

	it('returns a job that arrives while waiting, passing the cursor and remaining time to the store', async () => {
		const clk = clock('2026-10-22T03:01:00.000Z');
		const { store, stored, waitCalls } = fakeStore(
			[],
			{},
			{
				onWait: () => {
					clk.advance(3000);
					const job = pendingJob('01JB0000000000000000000001', '2026-10-22T03:01:02.000Z');
					stored.set(job._id, job);
				}
			}
		);

		const claimed = await waitForNextJob(store, PRINTER, {
			now: clk.now,
			waitMs: 25000,
			signal: new AbortController().signal
		});

		expect(claimed?.job).toEqual({
			id: '01JB0000000000000000000001',
			label_count: 2,
			lease_until: '2026-10-22T03:02:33.000Z'
		});
		expect(waitCalls).toEqual([{ printerId: PRINTER, since: 'seq-1', timeoutMs: 25000 }]);
	});

	it('keeps waiting with the remaining time and returns null once waitMs is exhausted', async () => {
		const clk = clock('2026-10-22T03:01:00.000Z');
		let round = 0;
		const { store, waitCalls } = fakeStore(
			[],
			{},
			{
				onWait: ({ timeoutMs }) => {
					round += 1;
					clk.advance(round === 1 ? 10000 : timeoutMs);
				}
			}
		);

		const claimed = await waitForNextJob(store, PRINTER, {
			now: clk.now,
			waitMs: 25000,
			signal: new AbortController().signal
		});

		expect(claimed).toBeNull();
		expect(waitCalls).toEqual([
			{ printerId: PRINTER, since: 'seq-1', timeoutMs: 25000 },
			{ printerId: PRINTER, since: 'seq-2', timeoutMs: 15000 }
		]);
	});

	it('returns null without touching the store again when the signal aborts during the wait', async () => {
		const clk = clock('2026-10-22T03:01:00.000Z');
		const controller = new AbortController();
		const { store, calls } = fakeStore(
			[],
			{},
			{
				onWait: () => {
					clk.advance(1000);
					controller.abort();
				}
			}
		);

		const claimed = await waitForNextJob(store, PRINTER, {
			now: clk.now,
			waitMs: 25000,
			signal: controller.signal
		});

		expect(claimed).toBeNull();
		expect(calls).toEqual(['pendingCursor', 'findJobs', 'waitForPending']);
	});

	it('returns null without any store call when the signal is already aborted', async () => {
		const clk = clock('2026-10-22T03:01:00.000Z');
		const controller = new AbortController();
		controller.abort();
		const { store, calls } = fakeStore([], {});

		const claimed = await waitForNextJob(store, PRINTER, {
			now: clk.now,
			waitMs: 25000,
			signal: controller.signal
		});

		expect(claimed).toBeNull();
		expect(calls).toEqual([]);
	});
});

describe('reportResult', () => {
	const NOW = new Date('2026-10-22T03:01:40.000Z');
	const ULID = '01JB0000000000000000000001';

	function printingJob(overrides: Partial<PrintJobDoc> = {}): PrintJobDoc {
		return pendingJob(ULID, '2026-10-22T03:00:01.000Z', {
			status: 'printing',
			claimed_at: '2026-10-22T03:01:00.000Z',
			lease_until: '2026-10-22T03:02:30.000Z',
			_attachments: { 'label-000.png': { content_type: 'image/png', stub: true } },
			...overrides
		});
	}

	it('marks a printing job of the printer as printed with the reported count and drops its attachments', async () => {
		const { store, stored } = fakeStore([printingJob()], {});

		const status = await reportResult(store, PRINTER, ULID, { printed: 2 }, NOW);

		expect(status).toBe('printed');
		const doc = stored.get(`print_job:${ULID}`);
		expect(doc).toMatchObject({
			status: 'printed',
			printed: 2,
			error_code: null,
			finished_at: '2026-10-22T03:01:40.000Z'
		});
		expect(doc).not.toHaveProperty('_attachments');
	});

	it('marks the job failed with the reported error_code and the count printed so far', async () => {
		const { store, stored } = fakeStore([printingJob()], {});

		const status = await reportResult(
			store,
			PRINTER,
			ULID,
			{ printed: 1, error_code: 'printer_timeout' },
			NOW
		);

		expect(status).toBe('failed');
		const doc = stored.get(`print_job:${ULID}`);
		expect(doc).toMatchObject({
			status: 'failed',
			printed: 1,
			error_code: 'printer_timeout',
			finished_at: '2026-10-22T03:01:40.000Z'
		});
		expect(doc).not.toHaveProperty('_attachments');
	});

	it.each([
		['the job belongs to another printer', [printingJob({ printer_id: 'print_device:other' })], []],
		['the job is not printing yet', [printingJob({ status: 'pending' })], []],
		['the job already reached a final status', [printingJob({ status: 'printed' })], []],
		['the job does not exist', [], []],
		['the PUT conflicts', [printingJob()], [`print_job:${ULID}`]]
	])('throws PrintJobConflictError when %s', async (_name, docs, conflictOn) => {
		const { store, stored } = fakeStore(docs, {}, { conflictOn });
		const before = stored.get(`print_job:${ULID}`);

		await expect(reportResult(store, PRINTER, ULID, { printed: 2 }, NOW)).rejects.toBeInstanceOf(
			PrintJobConflictError
		);

		expect(stored.get(`print_job:${ULID}`)).toBe(before);
	});
});

describe('failInFlight', () => {
	const NOW = new Date('2026-10-22T03:05:00.000Z');
	const attachments = { 'label-000.png': { content_type: 'image/png', stub: true } };

	function printing(ulid: string, printerId: string): PrintJobDoc {
		return pendingJob(ulid, '2026-10-22T03:00:01.000Z', {
			printer_id: printerId,
			status: 'printing',
			claimed_at: '2026-10-22T03:01:00.000Z',
			lease_until: '2026-10-22T03:02:30.000Z',
			_attachments: attachments
		});
	}

	it("fails every printing job of the printer as agent_restart and leaves other printers' jobs alone", async () => {
		const { store, stored } = fakeStore(
			[
				printing('01JB0000000000000000000001', PRINTER),
				printing('01JB0000000000000000000002', PRINTER),
				printing('01JB0000000000000000000003', 'print_device:other'),
				pendingJob('01JB0000000000000000000004', '2026-10-22T03:00:09.000Z')
			],
			{}
		);

		const count = await failInFlight(store, PRINTER, NOW);

		expect(count).toBe(2);
		for (const ulid of ['01JB0000000000000000000001', '01JB0000000000000000000002']) {
			const doc = stored.get(`print_job:${ulid}`);
			expect(doc).toMatchObject({
				status: 'failed',
				error_code: 'agent_restart',
				finished_at: '2026-10-22T03:05:00.000Z'
			});
			expect(doc).not.toHaveProperty('_attachments');
		}
		expect(stored.get('print_job:01JB0000000000000000000003')).toMatchObject({
			status: 'printing',
			_attachments: attachments
		});
		expect(stored.get('print_job:01JB0000000000000000000004')?.status).toBe('pending');
	});
});

describe('sweepJobs', () => {
	const NOW = new Date('2026-10-22T03:05:00.000Z');
	const attachments = { 'label-000.png': { content_type: 'image/png', stub: true } };

	function printing(ulid: string, leaseUntil: string, printerId = PRINTER): PrintJobDoc {
		return pendingJob(ulid, '2026-10-22T03:00:01.000Z', {
			printer_id: printerId,
			status: 'printing',
			claimed_at: '2026-10-22T03:03:00.000Z',
			lease_until: leaseUntil,
			_attachments: attachments
		});
	}

	function pending(ulid: string, expiresAt: string): PrintJobDoc {
		return pendingJob(ulid, '2026-10-22T03:00:01.000Z', {
			expires_at: expiresAt,
			_attachments: attachments
		});
	}

	it('fails printing jobs whose lease ran out and expires overdue pending jobs, dropping attachments', async () => {
		const { store, stored } = fakeStore(
			[
				printing('01JB0000000000000000000001', '2026-10-22T03:05:00.000Z'),
				printing('01JB0000000000000000000002', '2026-10-22T03:05:00.001Z'),
				printing('01JB0000000000000000000003', '2026-10-22T03:04:00.000Z', 'print_device:other'),
				pending('01JB0000000000000000000004', '2026-10-22T03:05:00.000Z'),
				pending('01JB0000000000000000000005', '2026-10-22T03:05:00.001Z')
			],
			{}
		);

		const counts = await sweepJobs(store, NOW);

		expect(counts).toEqual({ failed: 2, expired: 1 });
		expect(stored.get('print_job:01JB0000000000000000000001')).toMatchObject({
			status: 'failed',
			error_code: 'lease_expired',
			finished_at: '2026-10-22T03:05:00.000Z'
		});
		expect(stored.get('print_job:01JB0000000000000000000003')?.status).toBe('failed');
		expect(stored.get('print_job:01JB0000000000000000000004')).toMatchObject({
			status: 'expired',
			finished_at: '2026-10-22T03:05:00.000Z'
		});
		for (const ulid of ['01', '03', '04'].map((n) => `01JB00000000000000000000${n}`)) {
			expect(stored.get(`print_job:${ulid}`)).not.toHaveProperty('_attachments');
		}
		expect(stored.get('print_job:01JB0000000000000000000002')?.status).toBe('printing');
		expect(stored.get('print_job:01JB0000000000000000000005')?.status).toBe('pending');
	});

	it('skips jobs someone else already moved (PUT conflict) without counting them', async () => {
		const { store, stored } = fakeStore(
			[
				printing('01JB0000000000000000000001', '2026-10-22T03:04:00.000Z'),
				pending('01JB0000000000000000000004', '2026-10-22T03:04:00.000Z'),
				pending('01JB0000000000000000000005', '2026-10-22T03:04:00.000Z')
			],
			{},
			{
				conflictOn: ['print_job:01JB0000000000000000000001', 'print_job:01JB0000000000000000000004']
			}
		);

		const counts = await sweepJobs(store, NOW);

		expect(counts).toEqual({ failed: 0, expired: 1 });
		expect(stored.get('print_job:01JB0000000000000000000001')?.status).toBe('printing');
		expect(stored.get('print_job:01JB0000000000000000000005')?.status).toBe('expired');
	});
});
