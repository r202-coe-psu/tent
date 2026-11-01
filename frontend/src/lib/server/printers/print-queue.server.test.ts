import { describe, expect, it } from 'vitest';
import { labelPngBase64 } from '$lib/testing/label-png';
import {
	applyRetention,
	claimNextJob,
	failInFlight,
	PrintJobConflictError,
	reportResult,
	sweepJobs,
	waitForNextJob,
	type PrintJobDoc,
	type PrintJobPutResult,
	type PrintJobRetentionStore,
	type PrintJobStore
} from './print-queue.server';

const PRINTER = 'print_device:printer-sh001-reg1';
const SHELTER = 'SH001';
const LABEL = labelPngBase64();
const LABEL_B = labelPngBase64({ size: 40 });
const labelsOf = (count: number) => Array.from({ length: count }, () => LABEL);

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
			calls.push('getLabels');
			return labels[jobId] ?? [];
		},
		async getWithLabels(id) {
			calls.push('getWithLabels');
			const doc = stored.get(id);
			return doc ? { doc, labels: labels[id] ?? [] } : null;
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
			{ 'print_job:01JB0000000000000000000001': [LABEL, LABEL_B] }
		);

		const claimed = await claimNextJob(store, PRINTER, {
			now: new Date('2026-10-22T03:01:00.000Z'),
			shelterCode: SHELTER
		});

		expect(claimed).toEqual({
			job: {
				id: '01JB0000000000000000000001',
				label_count: 2,
				lease_sec: 100,
				lease_until: '2026-10-22T03:02:40.000Z'
			},
			labels: [LABEL, LABEL_B]
		});
		expect(stored.get('print_job:01JB0000000000000000000001')).toMatchObject({
			status: 'printing',
			claimed_at: '2026-10-22T03:01:00.000Z',
			lease_until: '2026-10-22T03:02:40.000Z'
		});
	});

	it('leases a bigger job for longer, so a slow 20-label print does not lose its lease', async () => {
		const { store } = fakeStore(
			[pendingJob('01JB0000000000000000000001', '2026-10-22T03:00:01.000Z', { label_count: 20 })],
			{ 'print_job:01JB0000000000000000000001': labelsOf(20) }
		);

		const claimed = await claimNextJob(store, PRINTER, {
			now: new Date('2026-10-22T03:01:00.000Z'),
			shelterCode: SHELTER
		});

		expect(claimed?.job).toMatchObject({ lease_sec: 190, lease_until: '2026-10-22T03:04:10.000Z' });
	});

	it('falls through to the next oldest pending job when the oldest was claimed by another agent', async () => {
		const { store, stored } = fakeStore(
			[
				pendingJob('01JB0000000000000000000001', '2026-10-22T03:00:01.000Z'),
				pendingJob('01JB0000000000000000000002', '2026-10-22T03:00:05.000Z')
			],
			{
				'print_job:01JB0000000000000000000001': labelsOf(2),
				'print_job:01JB0000000000000000000002': [LABEL, LABEL_B]
			},
			{ conflictOn: ['print_job:01JB0000000000000000000001'] }
		);

		const claimed = await claimNextJob(store, PRINTER, {
			now: new Date('2026-10-22T03:01:00.000Z'),
			shelterCode: SHELTER
		});

		expect(claimed).toEqual({
			job: {
				id: '01JB0000000000000000000002',
				label_count: 2,
				lease_sec: 100,
				lease_until: '2026-10-22T03:02:40.000Z'
			},
			labels: [LABEL, LABEL_B]
		});
		expect(stored.get('print_job:01JB0000000000000000000001')?.status).toBe('pending');
	});

	it('returns null when every pending job conflicts', async () => {
		const { store } = fakeStore(
			[
				pendingJob('01JB0000000000000000000001', '2026-10-22T03:00:01.000Z'),
				pendingJob('01JB0000000000000000000002', '2026-10-22T03:00:05.000Z')
			],
			{
				'print_job:01JB0000000000000000000001': labelsOf(2),
				'print_job:01JB0000000000000000000002': labelsOf(2)
			},
			{
				conflictOn: ['print_job:01JB0000000000000000000001', 'print_job:01JB0000000000000000000002']
			}
		);

		const claimed = await claimNextJob(store, PRINTER, {
			now: new Date('2026-10-22T03:01:00.000Z'),
			shelterCode: SHELTER
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
			{ 'print_job:01JB0000000000000000000002': labelsOf(2) }
		);

		const claimed = await claimNextJob(store, PRINTER, {
			now: new Date('2026-10-22T03:01:00.000Z'),
			shelterCode: SHELTER
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
			{ 'print_job:01JB0000000000000000000001': labelsOf(2) }
		);

		await claimNextJob(store, PRINTER, {
			now: new Date('2026-10-22T03:01:00.000Z'),
			shelterCode: SHELTER
		});

		expect(stored.get('print_job:01JB0000000000000000000001')).toMatchObject({
			status: 'printing',
			_attachments: { 'label-000.png': { content_type: 'image/png', stub: true } }
		});
	});
});

describe('claimNextJob rechecks the job it hands out (FR-11, FR-12, FR-12a)', () => {
	const NOW = new Date('2026-10-22T03:01:00.000Z');
	const BAD = 'print_job:01JB0000000000000000000001';
	const GOOD = 'print_job:01JB0000000000000000000002';
	const claim = (store: PrintJobStore) =>
		claimNextJob(store, PRINTER, { now: NOW, shelterCode: SHELTER });

	function badThenGood(bad: Partial<PrintJobDoc>, badLabels: string[]) {
		return fakeStore(
			[
				pendingJob('01JB0000000000000000000001', '2026-10-22T03:00:01.000Z', {
					...bad,
					_attachments: { 'label-000.png': { content_type: 'image/png', stub: true } }
				}),
				pendingJob('01JB0000000000000000000002', '2026-10-22T03:00:05.000Z')
			],
			{ [BAD]: badLabels, [GOOD]: labelsOf(2) }
		);
	}

	it('fails a job whose label PNG has the wrong size as invalid_label and claims the next good job in the same call', async () => {
		const { store, stored } = badThenGood({ label_count: 1 }, [labelPngBase64({ width: 640 })]);

		const claimed = await claim(store);

		expect(claimed?.job.id).toBe('01JB0000000000000000000002');
		expect(claimed?.labels).toEqual(labelsOf(2));
		const bad = stored.get(BAD);
		expect(bad).toMatchObject({
			status: 'failed',
			error_code: 'invalid_label',
			finished_at: '2026-10-22T03:01:00.000Z'
		});
		expect(bad).not.toHaveProperty('_attachments');
	});

	it('returns no labels at all when the only job has an invalid one', async () => {
		const { store } = fakeStore(
			[pendingJob('01JB0000000000000000000001', '2026-10-22T03:00:01.000Z', { label_count: 1 })],
			{ [BAD]: ['not-a-png'] }
		);

		expect(await claim(store)).toBeNull();
	});

	it('fails a job with fewer attachments than label_count as invalid_label', async () => {
		const { store, stored } = badThenGood({ label_count: 3 }, labelsOf(2));

		await claim(store);

		expect(stored.get(BAD)).toMatchObject({ status: 'failed', error_code: 'invalid_label' });
	});

	it.each([
		['0 labels', 0],
		['21 labels', 21]
	])('fails a job declaring %s as invalid_label', async (_l, count) => {
		const { store, stored } = badThenGood({ label_count: count }, labelsOf(count));

		await claim(store);

		expect(stored.get(BAD)).toMatchObject({ status: 'failed', error_code: 'invalid_label' });
	});

	it("fails a job written into this shelter's DB for another shelter as invalid_label", async () => {
		const { store, stored } = badThenGood({ shelter_code: 'SH002' }, labelsOf(2));

		const claimed = await claim(store);

		expect(stored.get(BAD)).toMatchObject({ status: 'failed', error_code: 'invalid_label' });
		expect(claimed?.job.id).toBe('01JB0000000000000000000002');
	});

	it('fails a job that is no longer for this printer when it is re-read, as invalid_label', async () => {
		const { store, stored } = badThenGood({}, labelsOf(2));
		const read = store.getWithLabels;
		store.getWithLabels = async (id) => {
			const found = await read(id);
			return found && id === BAD
				? { ...found, doc: { ...found.doc, printer_id: 'print_device:other' } }
				: found;
		};

		await claim(store);

		expect(stored.get(BAD)).toMatchObject({ status: 'failed', error_code: 'invalid_label' });
	});

	it.each(['printing', 'failed', 'expired'] as const)(
		'skips a candidate that is no longer pending when re-read (status %s) and claims the next one',
		async (status) => {
			const { store, stored } = badThenGood({}, labelsOf(2));
			const read = store.getWithLabels;
			store.getWithLabels = async (id) => {
				const found = await read(id);
				return found && id === BAD ? { ...found, doc: { ...found.doc, status } } : found;
			};

			const claimed = await claim(store);

			// Another actor moved BAD between the find and the read: it must not be claimed again or rewritten.
			expect(stored.get(BAD)).toMatchObject({ status: 'pending' });
			expect(claimed?.job.id).toBe('01JB0000000000000000000002');
		}
	);

	it('expires a job whose forged expires_at is far in the future once created_at + 120 s has passed', async () => {
		const { store, stored } = badThenGood(
			{ expires_at: '2099-01-01T00:00:00.000Z', created_at: '2026-10-22T02:58:00.000Z' },
			labelsOf(2)
		);

		const claimed = await claim(store);

		expect(stored.get(BAD)).toMatchObject({ status: 'expired' });
		expect(claimed?.job.id).toBe('01JB0000000000000000000002');
	});

	it('expires a job whose created_at lies in the future instead of waiting for it', async () => {
		const { store, stored } = fakeStore(
			[
				pendingJob('01JB0000000000000000000001', '2026-10-22T03:30:00.000Z', {
					expires_at: '2026-10-22T03:31:00.000Z'
				})
			],
			{ [BAD]: labelsOf(2) }
		);

		expect(await claim(store)).toBeNull();

		expect(stored.get(BAD)).toMatchObject({ status: 'expired' });
	});

	it('hands out the labels it already read, without a second read, and writes at the read _rev', async () => {
		const { store, stored, calls } = fakeStore(
			[pendingJob('01JB0000000000000000000001', '2026-10-22T03:00:01.000Z')],
			{ [BAD]: [LABEL, LABEL_B] }
		);
		const read = store.getWithLabels;
		store.getWithLabels = async (id) => {
			const found = await read(id);
			return found && { ...found, doc: { ...found.doc, _rev: '7-fresh' } };
		};

		const claimed = await claim(store);

		expect(claimed?.labels).toEqual([LABEL, LABEL_B]);
		expect(stored.get(BAD)).toMatchObject({ status: 'printing', _rev: '7-fresh' });
		expect(calls).not.toContain('getLabels');
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
			{ 'print_job:01JB0000000000000000000001': labelsOf(2) },
			{
				onWait: () => {
					clk.advance(3000);
					const job = pendingJob('01JB0000000000000000000001', '2026-10-22T03:01:02.000Z');
					stored.set(job._id, job);
				}
			}
		);

		const claimed = await waitForNextJob(store, PRINTER, {
			shelterCode: SHELTER,
			now: clk.now,
			waitMs: 25000,
			signal: new AbortController().signal
		});

		expect(claimed?.job).toEqual({
			id: '01JB0000000000000000000001',
			label_count: 2,
			lease_sec: 100,
			lease_until: '2026-10-22T03:02:43.000Z'
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
			shelterCode: SHELTER,
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
			shelterCode: SHELTER,
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
			shelterCode: SHELTER,
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

	it('caps the reported printed count at label_count', async () => {
		const { store, stored } = fakeStore([printingJob()], {});

		await reportResult(store, PRINTER, ULID, { printed: 99 }, NOW);

		expect(stored.get(`print_job:${ULID}`)).toMatchObject({ status: 'printed', printed: 2 });
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
		return pendingJob(ulid, '2026-10-22T03:03:30.000Z', {
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

	it('expires a pending job whose forged expires_at is far away once created_at + 120 s has passed', async () => {
		const { store, stored } = fakeStore(
			[
				pendingJob('01JB0000000000000000000006', '2026-10-22T03:02:00.000Z', {
					expires_at: '2099-01-01T00:00:00.000Z'
				}),
				pendingJob('01JB0000000000000000000007', '2026-10-22T03:03:30.000Z', {
					expires_at: '2099-01-01T00:00:00.000Z'
				}),
				pendingJob('01JB0000000000000000000008', '2026-10-22T04:00:00.000Z', {
					expires_at: '2026-10-22T04:01:00.000Z'
				})
			],
			{}
		);

		const counts = await sweepJobs(store, NOW);

		expect(counts).toEqual({ failed: 0, expired: 2 });
		expect(stored.get('print_job:01JB0000000000000000000006')?.status).toBe('expired');
		expect(stored.get('print_job:01JB0000000000000000000007')?.status).toBe('pending');
		expect(stored.get('print_job:01JB0000000000000000000008')?.status).toBe('expired');
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

describe('applyRetention', () => {
	const NOW = new Date('2026-10-22T03:00:00.000Z');

	function finished(ulid: string, status: PrintJobDoc['status'], finishedAt: string) {
		return pendingJob(ulid, '2026-10-01T00:00:00.000Z', { status, finished_at: finishedAt });
	}

	/** Mimics a Mango `_find` capped at `batch` docs, so purging has to loop. */
	function fakeRetentionStore(docs: PrintJobDoc[], batch = 2) {
		const stored = new Map(docs.map((d) => [d._id, d]));
		const calls: string[] = [];
		const cutoffs: string[] = [];
		const store: PrintJobRetentionStore = {
			async findFinishedBefore(cutoff) {
				cutoffs.push(cutoff);
				return [...stored.values()]
					.filter((d) => d.finished_at !== null && d.finished_at < cutoff)
					.slice(0, batch);
			},
			async purge(batchDocs) {
				calls.push(`purge:${batchDocs.length}`);
				for (const d of batchDocs) stored.delete(d._id);
				return batchDocs.length;
			},
			async compact() {
				calls.push('compact');
			}
		};
		return { store, stored, calls, cutoffs };
	}

	it('purges every finished job older than 7 days, then compacts', async () => {
		const { store, stored, calls, cutoffs } = fakeRetentionStore([
			finished('01JB0000000000000000000001', 'printed', '2026-10-14T00:00:00.000Z'),
			finished('01JB0000000000000000000002', 'failed', '2026-10-14T12:00:00.000Z'),
			finished('01JB0000000000000000000003', 'expired', '2026-10-15T02:59:59.999Z'),
			finished('01JB0000000000000000000004', 'printed', '2026-10-15T03:00:00.000Z'),
			finished('01JB0000000000000000000005', 'printed', '2026-10-21T00:00:00.000Z')
		]);

		const purged = await applyRetention(store, NOW);

		expect(purged).toBe(3);
		expect(cutoffs[0]).toBe('2026-10-15T03:00:00.000Z');
		expect([...stored.keys()]).toEqual([
			'print_job:01JB0000000000000000000004',
			'print_job:01JB0000000000000000000005'
		]);
		expect(calls).toEqual(['purge:2', 'purge:1', 'compact']);
	});

	it('still compacts when nothing is old enough, so old revisions lose their label images', async () => {
		const { store, calls } = fakeRetentionStore([
			finished('01JB0000000000000000000001', 'printed', '2026-10-21T00:00:00.000Z')
		]);

		expect(await applyRetention(store, NOW)).toBe(0);
		expect(calls).toEqual(['compact']);
	});

	it('purges at most 100 docs per request (CouchDB max_document_id_number)', async () => {
		const old = Array.from({ length: 250 }, (_, i) =>
			finished(`01JB${String(i).padStart(22, '0')}`, 'printed', '2026-10-01T00:00:00.000Z')
		);
		const { store, stored, calls } = fakeRetentionStore(old, 300);

		expect(await applyRetention(store, NOW)).toBe(250);
		expect(stored.size).toBe(0);
		expect(calls).toEqual(['purge:100', 'purge:100', 'purge:50', 'compact']);
	});

	it('counts what the store reports as removed, not the batch size', async () => {
		const { store, calls } = fakeRetentionStore(
			[
				finished('01JB0000000000000000000001', 'printed', '2026-10-01T00:00:00.000Z'),
				finished('01JB0000000000000000000002', 'printed', '2026-10-01T00:00:00.000Z')
			],
			5
		);
		// One of the two docs had a stale _rev: CouchDB reports a conflict for it and keeps it.
		let round = 0;
		store.purge = async (batchDocs) => {
			calls.push(`purge:${batchDocs.length}`);
			round += 1;
			return round === 1 ? 1 : 0;
		};

		expect(await applyRetention(store, NOW)).toBe(1);
		// The stale doc is found again, but a round that removed nothing ends the loop.
		expect(calls).toEqual(['purge:2', 'purge:2', 'compact']);
	});

	it('still compacts when a purge fails, then reports the failure', async () => {
		const { store, calls } = fakeRetentionStore([
			finished('01JB0000000000000000000001', 'printed', '2026-10-01T00:00:00.000Z')
		]);
		store.purge = async () => {
			calls.push('purge:failed');
			throw new Error('purge rejected');
		};

		await expect(applyRetention(store, NOW)).rejects.toThrow('purge rejected');
		expect(calls).toEqual(['purge:failed', 'compact']);
	});
});
