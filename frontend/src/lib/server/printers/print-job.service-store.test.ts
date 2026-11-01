import { beforeEach, describe, expect, it, vi } from 'vitest';

const printingRaw = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/couch-printing-service', () => ({ printingRaw }));
vi.mock('$lib/server/printers/printing-provision', () => ({
	ensurePrintingDevicesDb: vi.fn(),
	ensureShelterPrintingDb: vi.fn()
}));

import { PrintDependencyError } from './device-credentials';
import { printJobStoreFor } from './print-job.service-store';
import type { PrintJobDoc } from './print-queue.server';

type Reply = { status: number; data?: unknown };

let calls: { path: string; method: string; body: unknown; signal: AbortSignal | undefined }[];
let replies: Reply[];

/** Queue the next CouchDB answers, in call order. */
function reply(...next: Reply[]) {
	replies.push(...next);
}

beforeEach(() => {
	calls = [];
	replies = [];
	printingRaw.mockReset();
	printingRaw.mockImplementation(
		(path: string, method: string, body?: unknown, signal?: AbortSignal) => {
			calls.push({ path, method, body, signal });
			const next = replies.shift() ?? { status: 500 };
			return Promise.resolve({ status: next.status, data: next.data ?? null });
		}
	);
});

function job(overrides: Partial<PrintJobDoc> = {}): PrintJobDoc {
	return {
		_id: 'print_job:01',
		_rev: '1-a',
		type: 'print_job',
		schema_v: 1,
		shelter_code: 'SH01',
		printer_id: 'print_device:pi-1',
		status: 'pending',
		label_count: 1,
		source: 'walk_in',
		created_at: '2026-11-01T00:00:00.000Z',
		created_by: 'staff',
		expires_at: '2026-11-01T00:02:00.000Z',
		claimed_at: null,
		lease_until: null,
		finished_at: null,
		printed: 0,
		error_code: null,
		...overrides
	};
}

describe('shelter print job store: database routing', () => {
	it('talks only to the lower-case printing_{code} database of its shelter', async () => {
		reply({ status: 200, data: job() }, { status: 200, data: { docs: [] } });
		const store = printJobStoreFor('SH01');

		await store.get('print_job:01');
		await store.findJobs({ status: 'pending' });

		expect(calls.map((c) => c.path)).toEqual([
			'/printing_sh01/print_job%3A01',
			'/printing_sh01/_find'
		]);
	});

	it('routes another shelter to its own database, never the legacy printing db', async () => {
		reply({ status: 200, data: { docs: [] } });

		await printJobStoreFor('ab2').findJobs({ status: 'pending' });

		expect(calls[0]?.path).toBe('/printing_ab2/_find');
	});

	it('rejects a shelter code that cannot form a database name', () => {
		expect(() => printJobStoreFor('bad/code')).toThrow();
	});
});

describe('shelter print job store: queue reads and writes', () => {
	it('finds one printer pending jobs through the printer/status/created index', async () => {
		reply({ status: 200, data: { docs: [job()] } });

		const docs = await printJobStoreFor('SH01').findJobs({
			status: 'pending',
			printerId: 'print_device:pi-1'
		});

		expect(docs).toHaveLength(1);
		expect(calls[0]?.body).toEqual({
			selector: {
				type: 'print_job',
				printer_id: 'print_device:pi-1',
				status: 'pending',
				created_at: { $gt: null }
			},
			limit: 100
		});
	});

	it('finds jobs by status alone through the status/expires index', async () => {
		reply({ status: 200, data: { docs: [] } });

		await printJobStoreFor('SH01').findJobs({ status: 'pending' });

		expect(calls[0]?.body).toEqual({
			selector: { type: 'print_job', status: 'pending', expires_at: { $gt: null } },
			limit: 100
		});
	});

	it('get returns null for a missing job and put reports a stale rev as conflict', async () => {
		reply({ status: 404 }, { status: 201, data: { rev: '2-b' } }, { status: 409 });
		const store = printJobStoreFor('SH01');

		expect(await store.get('print_job:nope')).toBeNull();
		expect(await store.put(job())).toEqual({ ok: true, rev: '2-b' });
		expect(await store.put(job())).toEqual({ conflict: true });
		expect(calls[1]).toMatchObject({
			path: '/printing_sh01/print_job%3A01',
			method: 'PUT',
			body: job()
		});
	});

	it('reads the newest job of a printer for the back-office list', async () => {
		reply({ status: 200, data: { docs: [job({ status: 'printed' })] } });

		const last = await printJobStoreFor('SH01').lastJobOf('print_device:pi-1');

		expect(last?.status).toBe('printed');
		expect(calls[0]?.body).toMatchObject({
			selector: { type: 'print_job', printer_id: 'print_device:pi-1', created_at: { $gt: null } },
			sort: [{ printer_id: 'desc' }, { created_at: 'desc' }],
			limit: 1
		});
	});

	it('starts compaction of the shelter database', async () => {
		reply({ status: 202 });
		await printJobStoreFor('SH01').compact();
		expect(calls[0]).toMatchObject({ path: '/printing_sh01/_compact', method: 'POST' });
	});
});

describe('shelter print job store: labels', () => {
	it('getLabels returns base64 label images in label-NNN order', async () => {
		reply({
			status: 200,
			data: {
				_attachments: {
					'label-001.png': { data: 'BBBB' },
					'label-000.png': { data: 'AAAA' },
					'notes.txt': { data: 'ZZZZ' }
				}
			}
		});

		const labels = await printJobStoreFor('SH01').getLabels('print_job:01');

		expect(labels).toEqual(['AAAA', 'BBBB']);
		expect(calls[0]?.path).toBe('/printing_sh01/print_job%3A01?attachments=true');
	});

	it('getWithLabels returns the doc and its labels from a single request', async () => {
		reply({
			status: 200,
			data: {
				...job(),
				_attachments: {
					'label-001.png': { content_type: 'image/png', revpos: 1, digest: 'd1', data: 'BBBB' },
					'label-000.png': { content_type: 'image/png', revpos: 1, digest: 'd0', data: 'AAAA' }
				}
			}
		});

		const result = await printJobStoreFor('SH01').getWithLabels('print_job:01');

		expect(calls).toHaveLength(1);
		expect(calls[0]?.path).toBe('/printing_sh01/print_job%3A01?attachments=true');
		expect(result?.labels).toEqual(['AAAA', 'BBBB']);
		expect(result?.doc._id).toBe('print_job:01');
	});

	it('getWithLabels hands back attachment stubs so a following PUT keeps the images', async () => {
		reply({
			status: 200,
			data: {
				...job(),
				_attachments: {
					'label-000.png': { content_type: 'image/png', revpos: 1, digest: 'd0', data: 'AAAA' }
				}
			}
		});

		const result = await printJobStoreFor('SH01').getWithLabels('print_job:01');

		expect(result?.doc._attachments).toEqual({
			'label-000.png': { content_type: 'image/png', revpos: 1, digest: 'd0', stub: true }
		});
	});

	it('getWithLabels is null for a missing job', async () => {
		reply({ status: 404 });
		expect(await printJobStoreFor('SH01').getWithLabels('print_job:nope')).toBeNull();
	});
});

describe('shelter print job store: change feed', () => {
	it('reads update_seq of the shelter database as the pending cursor', async () => {
		reply({ status: 200, data: { update_seq: '12-abc' } });

		expect(await printJobStoreFor('SH01').pendingCursor()).toBe('12-abc');
		expect(calls[0]).toMatchObject({ path: '/printing_sh01', method: 'GET' });
	});

	it('long-polls _changes for pending jobs of the printer and passes the abort signal', async () => {
		reply({ status: 200, data: { results: [] } });
		const controller = new AbortController();

		await printJobStoreFor('SH01').waitForPending('print_device:pi-1', '12-abc', {
			timeoutMs: 25_000.7,
			signal: controller.signal
		});

		const url = new URL(calls[0]!.path, 'http://x');
		expect(url.pathname).toBe('/printing_sh01/_changes');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			feed: 'longpoll',
			filter: '_selector',
			since: '12-abc',
			timeout: '25000'
		});
		expect(calls[0]).toMatchObject({
			method: 'POST',
			body: { selector: { type: 'print_job', printer_id: 'print_device:pi-1', status: 'pending' } },
			signal: controller.signal
		});
	});

	it('returns quietly when the client hung up mid-poll', async () => {
		const controller = new AbortController();
		printingRaw.mockImplementation(() => {
			controller.abort();
			return Promise.reject(new Error('aborted'));
		});

		await expect(
			printJobStoreFor('SH01').waitForPending('print_device:pi-1', '1', {
				timeoutMs: 1000,
				signal: controller.signal
			})
		).resolves.toBeUndefined();
	});
});

describe('shelter print job store: retention', () => {
	it('finds finished jobs before the cutoff, one batch per terminal status', async () => {
		reply(
			{ status: 200, data: { docs: [job({ _id: 'print_job:a', status: 'printed' })] } },
			{ status: 200, data: { docs: [job({ _id: 'print_job:b', status: 'failed' })] } },
			{ status: 200, data: { docs: [] } }
		);

		const docs = await printJobStoreFor('SH01').findFinishedBefore('2026-10-25T00:00:00.000Z');

		expect(docs.map((d) => d._id).sort()).toEqual(['print_job:a', 'print_job:b']);
		expect(
			calls.map((c) => (c.body as { selector: { status: string } }).selector.status).sort()
		).toEqual(['expired', 'failed', 'printed']);
		expect(calls[0]?.body).toMatchObject({
			selector: { finished_at: { $gt: null, $lt: '2026-10-25T00:00:00.000Z' } }
		});
	});

	it('purge deletes through _bulk_docs tombstones and never calls _purge', async () => {
		reply({
			status: 201,
			data: [
				{ ok: true, id: 'print_job:a', rev: '2-x' },
				{ id: 'print_job:b', error: 'conflict' }
			]
		});

		const removed = await printJobStoreFor('SH01').purge([
			job({ _id: 'print_job:a', _rev: '1-a' }),
			job({ _id: 'print_job:b', _rev: '1-b' })
		]);

		expect(removed).toBe(1); // b conflicted: only the actual deletions are reported

		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			path: '/printing_sh01/_bulk_docs',
			method: 'POST',
			body: {
				docs: [
					{ _id: 'print_job:a', _rev: '1-a', _deleted: true },
					{ _id: 'print_job:b', _rev: '1-b', _deleted: true }
				]
			}
		});
		expect(calls.some((c) => c.path.includes('_purge'))).toBe(false);
	});

	it('removeFinished returns how many documents were actually deleted', async () => {
		reply({
			status: 201,
			data: [
				{ ok: true, id: 'print_job:a', rev: '2-x' },
				{ id: 'print_job:b', error: 'conflict' }
			]
		});

		const removed = await printJobStoreFor('SH01').removeFinished([
			{ _id: 'print_job:a', _rev: '1-a' },
			{ _id: 'print_job:b', _rev: '1-b' }
		]);

		expect(removed).toBe(1);
	});

	it('removeFinished with nothing to delete makes no request', async () => {
		expect(await printJobStoreFor('SH01').removeFinished([])).toBe(0);
		expect(calls).toHaveLength(0);
	});

	it('removeFinished fails with a dependency error when _bulk_docs is refused', async () => {
		reply({ status: 500 });
		await expect(
			printJobStoreFor('SH01').removeFinished([{ _id: 'print_job:a', _rev: '1-a' }])
		).rejects.toBeInstanceOf(PrintDependencyError);
	});
});

describe('shelter print job store: shelter database missing (closed shelter)', () => {
	const missing = { status: 404, data: { error: 'not_found', reason: 'Database does not exist.' } };

	it('behaves as no jobs for every read', async () => {
		reply(...Array.from({ length: 9 }, () => missing));
		const store = printJobStoreFor('SH01');

		expect(await store.findJobs({ status: 'pending' })).toEqual([]);
		expect(await store.findFinishedBefore('2026-10-25T00:00:00.000Z')).toEqual([]);
		expect(await store.lastJobOf('print_device:pi-1')).toBeNull();
		expect(await store.get('print_job:01')).toBeNull();
		expect(await store.getWithLabels('print_job:01')).toBeNull();
		expect(await store.getLabels('print_job:01')).toEqual([]);
		expect(await store.pendingCursor()).toBe('0');
	});

	it('has nothing to compact or remove', async () => {
		reply(missing, missing);
		const store = printJobStoreFor('SH01');

		await expect(store.compact()).resolves.toBeUndefined();
		expect(await store.removeFinished([{ _id: 'print_job:a', _rev: '1-a' }])).toBe(0);
	});
});
