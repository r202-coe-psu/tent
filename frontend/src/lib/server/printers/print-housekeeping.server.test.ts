import { beforeEach, describe, expect, it } from 'vitest';
import type { PrintHousekeepingState } from './print-device.repo';
import {
	resetSweepThrottle,
	runHousekeeping,
	sweepIfDue,
	type HousekeepingDevices
} from './print-housekeeping.server';
import type {
	PrintJobDoc,
	PrintJobRetentionStore,
	PrintJobStatus,
	PrintJobStore
} from './print-queue.server';

const NOW = new Date('2026-11-01T12:00:00.000Z');
const HOUR_MS = 3_600_000;

function job(ulid: string, overrides: Partial<PrintJobDoc> = {}): PrintJobDoc {
	return {
		_id: `print_job:${ulid}`,
		_rev: '1-a',
		type: 'print_job',
		schema_v: 1,
		shelter_code: 'SH001',
		printer_id: 'print_device:printer-sh001-reg1',
		status: 'pending',
		label_count: 1,
		source: 'walk_in',
		created_at: '2026-11-01T11:00:00.000Z',
		created_by: 'staff-a',
		expires_at: '2026-11-01T11:02:00.000Z',
		claimed_at: null,
		lease_until: null,
		finished_at: null,
		printed: 0,
		error_code: null,
		...overrides
	};
}

/** Pending since an hour ago with a 2 minute expiry: due to be expired by the sweep. */
const overdue = (ulid: string) => job(ulid);

const finishedLongAgo = (ulid: string) =>
	job(ulid, { status: 'printed', finished_at: '2026-10-01T00:00:00.000Z' });

type Store = PrintJobStore & PrintJobRetentionStore;

/** In-memory fake of one shelter's DB, behind our own store ports. */
function fakeShelterDb(
	docs: PrintJobDoc[],
	opts: { failFind?: boolean; failRemove?: boolean } = {}
) {
	const stored = new Map(docs.map((d) => [d._id, d]));
	const calls: string[] = [];
	const store: Store = {
		async findJobs({ status }) {
			if (opts.failFind) throw new Error('couch down');
			return [...stored.values()].filter((d) => d.status === (status as PrintJobStatus));
		},
		async put(doc) {
			stored.set(doc._id, doc);
			return { ok: true, rev: '2-b' };
		},
		async findFinishedBefore(cutoff) {
			return [...stored.values()].filter((d) => d.finished_at !== null && d.finished_at < cutoff);
		},
		async purge(batch) {
			calls.push(`purge:${batch.length}`);
			if (opts.failRemove) throw new Error('bulk_docs rejected');
			for (const d of batch) stored.delete(d._id);
		},
		async compact() {
			calls.push('compact');
		},
		async get() {
			return null;
		},
		async getLabels() {
			return [];
		},
		async getWithLabels() {
			return null;
		},
		async pendingCursor() {
			return '0';
		},
		async waitForPending() {}
	};
	return { store, stored, calls };
}

function fakeDevices(initial: PrintHousekeepingState | null) {
	const written: PrintHousekeepingState[] = [];
	let compacts = 0;
	const devices: HousekeepingDevices = {
		async readHousekeepingState() {
			return initial;
		},
		async writeHousekeepingState(state) {
			written.push(state);
		},
		async compactDevicesDb() {
			compacts += 1;
		}
	};
	return { devices, written, compacts: () => compacts };
}

const stateAt = (retentionAt: string | null): PrintHousekeepingState => ({
	last_run_at: '2026-11-01T11:59:30.000Z',
	last_retention_at: retentionAt,
	last_error: null
});

describe('runHousekeeping', () => {
	it('sweeps every registered shelter and goes on with the next one when a shelter fails, recording the error', async () => {
		const a = fakeShelterDb([], { failFind: true });
		const b = fakeShelterDb([overdue('01JB0000000000000000000001')]);
		const dev = fakeDevices(stateAt('2026-11-01T11:59:00.000Z'));

		const result = await runHousekeeping({
			listShelters: async () => ['SH001', 'SH002'],
			storeFor: (code) => (code === 'SH001' ? a.store : b.store),
			devices: dev.devices,
			now: NOW
		});

		expect(b.stored.get('print_job:01JB0000000000000000000001')?.status).toBe('expired');
		expect(result).toMatchObject({ swept: 1, errors: 1 });
		expect(dev.written).toHaveLength(1);
		expect(dev.written[0].last_error).toContain('SH001');
		expect(dev.written[0].last_error).toContain('couch down');
	});

	it('skips retention and compaction while the last retention was less than an hour ago, but still sweeps', async () => {
		const db = fakeShelterDb([
			overdue('01JB0000000000000000000001'),
			finishedLongAgo('01JB0000000000000000000002')
		]);
		const recent = new Date(NOW.getTime() - HOUR_MS + 1).toISOString();
		const dev = fakeDevices(stateAt(recent));

		const result = await runHousekeeping({
			listShelters: async () => ['SH001'],
			storeFor: () => db.store,
			devices: dev.devices,
			now: NOW
		});

		expect(db.stored.get('print_job:01JB0000000000000000000001')?.status).toBe('expired');
		expect(db.stored.has('print_job:01JB0000000000000000000002')).toBe(true);
		expect(db.calls).toEqual([]);
		expect(dev.compacts()).toBe(0);
		expect(result).toEqual({ swept: 1, purged: 0, compacted: 0, errors: 0 });
		expect(dev.written[0].last_retention_at).toBe(recent);
	});

	it.each([
		['an hour ago', new Date(NOW.getTime() - HOUR_MS).toISOString()],
		['never', null]
	])(
		'removes old finished jobs and compacts each shelter DB and the devices DB when retention last ran %s',
		async (_l, last) => {
			const a = fakeShelterDb([finishedLongAgo('01JB0000000000000000000001')]);
			const b = fakeShelterDb([
				finishedLongAgo('01JB0000000000000000000002'),
				finishedLongAgo('01JB0000000000000000000003')
			]);
			const dev = fakeDevices(last === null ? null : stateAt(last));

			const result = await runHousekeeping({
				listShelters: async () => ['SH001', 'SH002'],
				storeFor: (code) => (code === 'SH001' ? a.store : b.store),
				devices: dev.devices,
				now: NOW
			});

			expect(a.stored.size + b.stored.size).toBe(0);
			expect(a.calls).toEqual(['purge:1', 'compact']);
			expect(b.calls).toEqual(['purge:2', 'compact']);
			expect(dev.compacts()).toBe(1);
			expect(result).toEqual({ swept: 0, purged: 3, compacted: 3, errors: 0 });
			expect(dev.written[0].last_retention_at).toBe(NOW.toISOString());
		}
	);

	it('still compacts a shelter DB when removing its old jobs fails, records it and carries on', async () => {
		const a = fakeShelterDb([finishedLongAgo('01JB0000000000000000000001')], {
			failRemove: true
		});
		const b = fakeShelterDb([finishedLongAgo('01JB0000000000000000000002')]);
		const dev = fakeDevices(null);

		const result = await runHousekeeping({
			listShelters: async () => ['SH001', 'SH002'],
			storeFor: (code) => (code === 'SH001' ? a.store : b.store),
			devices: dev.devices,
			now: NOW
		});

		expect(a.calls).toEqual(['purge:1', 'compact']);
		expect(b.stored.size).toBe(0);
		expect(result).toEqual({ swept: 0, purged: 1, compacted: 3, errors: 1 });
		expect(dev.written[0].last_error).toContain('SH001');
	});

	it('writes last_run_at, last_retention_at and an empty last_error after a clean run', async () => {
		const db = fakeShelterDb([]);
		const dev = fakeDevices(null);

		await runHousekeeping({
			listShelters: async () => ['SH001'],
			storeFor: () => db.store,
			devices: dev.devices,
			now: NOW
		});

		expect(dev.written).toEqual([
			{ last_run_at: NOW.toISOString(), last_retention_at: NOW.toISOString(), last_error: null }
		]);
	});

	it('records an error and still writes the state when the shelter registry cannot be listed', async () => {
		const dev = fakeDevices(stateAt('2026-11-01T11:00:00.000Z'));

		const result = await runHousekeeping({
			listShelters: async () => {
				throw new Error('registry down');
			},
			storeFor: () => fakeShelterDb([]).store,
			devices: dev.devices,
			now: NOW
		});

		expect(result.errors).toBe(1);
		expect(dev.written).toEqual([
			{
				last_run_at: NOW.toISOString(),
				last_retention_at: '2026-11-01T11:00:00.000Z',
				last_error: expect.stringContaining('registry down')
			}
		]);
	});
});

describe('sweepIfDue', () => {
	beforeEach(() => resetSweepThrottle());

	it('sweeps a shelter at most once per 30 s and again when the window has passed', async () => {
		const db = fakeShelterDb([]);
		let sweeps = 0;
		const original = db.store.findJobs;
		db.store.findJobs = async (query) => {
			if (query.status === 'printing') sweeps += 1;
			return original(query);
		};

		await sweepIfDue(db.store, 'SH001', NOW);
		await sweepIfDue(db.store, 'SH001', new Date(NOW.getTime() + 29_999));
		expect(sweeps).toBe(1);

		await sweepIfDue(db.store, 'SH001', new Date(NOW.getTime() + 30_000));
		expect(sweeps).toBe(2);
	});

	it('throttles each shelter on its own', async () => {
		const a = fakeShelterDb([overdue('01JB0000000000000000000001')]);
		const b = fakeShelterDb([overdue('01JB0000000000000000000001')]);

		await sweepIfDue(a.store, 'SH001', NOW);
		await sweepIfDue(b.store, 'SH002', NOW);

		expect(a.stored.get('print_job:01JB0000000000000000000001')?.status).toBe('expired');
		expect(b.stored.get('print_job:01JB0000000000000000000001')?.status).toBe('expired');
	});

	it('never throws when the sweep fails and does not retry it inside the window', async () => {
		const db = fakeShelterDb([], { failFind: true });

		await expect(sweepIfDue(db.store, 'SH001', NOW)).resolves.toBeUndefined();
		db.store.findJobs = async () => {
			throw new Error('should not be called');
		};
		await expect(
			sweepIfDue(db.store, 'SH001', new Date(NOW.getTime() + 1000))
		).resolves.toBeUndefined();
	});
});
