import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/couch-admin', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/couch-admin')>('$lib/server/couch-admin');
	return { ...actual, adminRaw: vi.fn() };
});

import { adminRaw } from '$lib/server/couch-admin';
import {
	claimNextImportItem,
	createImportJob,
	getImportJob,
	listRunnableImportJobs,
	recomputeImportJob,
	renewImportItemClaim,
	retryFailedImportItems,
	updateImportItem,
	MAX_IMPORT_ATTEMPTS,
	IMPORT_QUEUE_DB,
	IMPORT_AUDIT_DB,
	type ShelterImportItemSummary
} from './job-store';

const adminRawMock = vi.mocked(adminRaw);
const docs = new Map<string, Record<string, unknown>>();
const permanentlyConflictingIds = new Set<string>();
let securityWrites: unknown[] = [];

function docId(path: string): string {
	return decodeURIComponent(new URL(`http://test${path}`).pathname.split('/').slice(2).join('/'));
}

function allDocs(path: string): { rows: { id: string; doc: Record<string, unknown> }[] } {
	const url = new URL(`http://test${path}`);
	const start = JSON.parse(url.searchParams.get('startkey') ?? '""') as string;
	const end = JSON.parse(url.searchParams.get('endkey') ?? '"\\ufff0"') as string;
	return {
		rows: [...docs.entries()]
			.filter(([id]) => id >= start && id <= end)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([id, doc]) => ({ id, doc }))
	};
}

function itemMatchesJob(doc: Record<string, unknown>, jobId: string): boolean {
	if (doc.type !== 'shelter_import_item') return false;
	const fullJobId = jobId.startsWith('shelter_import_job:') ? jobId : `shelter_import_job:${jobId}`;
	const docJobId =
		(doc.job_id as string) ||
		(typeof doc._id === 'string' && doc._id.startsWith('shelter_import_item:')
			? `shelter_import_job:${doc._id.split(':')[1]}`
			: '');
	return docJobId === fullJobId;
}

function setupCouchMock(): void {
	docs.clear();
	permanentlyConflictingIds.clear();
	securityWrites = [];
	adminRawMock.mockImplementation(async (path, method, body) => {
		if (
			(path === '/registry' || path === `/${IMPORT_QUEUE_DB}` || path === `/${IMPORT_AUDIT_DB}`) &&
			method === 'PUT'
		) {
			return { status: 201, data: { ok: true } };
		}
		if (
			(path === `/${IMPORT_QUEUE_DB}/_security` || path === `/${IMPORT_AUDIT_DB}/_security`) &&
			method === 'GET'
		) {
			return {
				status: 200,
				data: {
					admins: { names: ['legacy-admin'], roles: ['system_admin', '_admin'] },
					members: { names: ['legacy-member'], roles: ['shelter:SH001'] }
				}
			};
		}
		if (
			(path === `/${IMPORT_QUEUE_DB}/_security` || path === `/${IMPORT_AUDIT_DB}/_security`) &&
			method === 'PUT'
		) {
			securityWrites.push(body);
			return { status: 200, data: { ok: true } };
		}
		if (path.includes('/_view/jobs_by_runnable')) {
			const matching = [...docs.values()]
				.filter((doc): doc is Record<string, unknown> => {
					if (doc.type !== 'shelter_import_job') return false;
					return (
						doc.retry_pending === true ||
						doc.status === 'queued' ||
						doc.status === 'running' ||
						((doc.status === 'completed' || doc.status === 'completed_with_errors') &&
							doc.audit_logged !== true)
					);
				})
				.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
			return {
				status: 200,
				data: {
					rows: matching.map((doc) => ({
						id: doc._id as string,
						key: [doc.retry_pending ? 'retry_pending' : doc.status, doc.created_at, doc._id],
						doc
					}))
				}
			};
		}
		if (path.includes('/_view/items_by_job_row')) {
			const url = new URL(`http://test${path}`);
			const startkey = JSON.parse(url.searchParams.get('startkey') ?? '[]') as [string, number];
			const jobId = startkey[0];
			const matching = [...docs.values()]
				.filter((doc): doc is Record<string, unknown> => {
					return itemMatchesJob(doc, jobId);
				})
				.sort((a, b) => Number(a.row) - Number(b.row));
			return {
				status: 200,
				data: {
					rows: matching.map((doc) => ({
						id: doc._id as string,
						key: [doc.job_id, doc.row],
						doc
					}))
				}
			};
		}
		if (path.includes('/_view/items_by_job_status_row')) {
			const url = new URL(`http://test${path}`);
			const startkey = JSON.parse(url.searchParams.get('startkey') ?? '[]') as [
				string,
				string,
				number
			];
			const jobId = startkey[0];
			const status = startkey[1];
			const limit = parseInt(url.searchParams.get('limit') ?? '1', 10);
			const matching = [...docs.values()]
				.filter((doc): doc is Record<string, unknown> => {
					return itemMatchesJob(doc, jobId) && doc.status === status;
				})
				.sort((a, b) => Number(a.row) - Number(b.row))
				.slice(0, limit);
			return {
				status: 200,
				data: {
					rows: matching.map((doc) => ({
						id: doc._id as string,
						key: [doc.job_id, doc.status, doc.row],
						doc
					}))
				}
			};
		}
		if (path.includes('/_view/running_items_by_lease')) {
			const url = new URL(`http://test${path}`);
			const endkey = JSON.parse(url.searchParams.get('endkey') ?? '[]') as [
				string,
				string,
				unknown
			];
			const jobId = endkey[0];
			const cutoffIso = typeof endkey[1] === 'string' ? endkey[1] : '';
			const limit = parseInt(url.searchParams.get('limit') ?? '1', 10);
			const matching = [...docs.values()]
				.filter((doc): doc is Record<string, unknown> => {
					return (
						itemMatchesJob(doc, jobId) &&
						doc.status === 'running' &&
						Boolean(doc.lease_until && String(doc.lease_until) <= cutoffIso)
					);
				})
				.sort((a, b) => Number(a.row) - Number(b.row))
				.slice(0, limit);
			return {
				status: 200,
				data: {
					rows: matching.map((doc) => ({
						id: doc._id as string,
						key: [doc.job_id, doc.lease_until, doc.row],
						doc
					}))
				}
			};
		}
		if (path.includes('/_view/items_by_job_status_count')) {
			const url = new URL(`http://test${path}`);
			const startkey = JSON.parse(url.searchParams.get('startkey') ?? '[]') as [string, unknown];
			const jobId = startkey[0];
			const counts: Record<string, number> = {};
			for (const doc of docs.values()) {
				if (itemMatchesJob(doc, jobId)) {
					const status = doc.status as string;
					counts[status] = (counts[status] ?? 0) + 1;
				}
			}
			return {
				status: 200,
				data: {
					rows: Object.entries(counts).map(([status, count]) => ({
						key: [jobId, status],
						value: count
					}))
				}
			};
		}
		if (path.includes('/_design/')) {
			const id = docId(path);
			if (method === 'GET') {
				const doc = docs.get(id);
				return doc ? { status: 200, data: doc } : { status: 404, data: { error: 'not_found' } };
			}
			if (method === 'PUT') {
				const incoming = body as Record<string, unknown>;
				docs.set(id, { ...incoming, _rev: '1-design' });
				return { status: 201, data: { ok: true, id, rev: '1-design' } };
			}
		}
		if (path.includes('/_all_docs?')) return { status: 200, data: allDocs(path) };
		const url = new URL(`http://test${path}`);
		const id = docId(path);
		if (method === 'GET') {
			const doc = docs.get(id);
			return doc ? { status: 200, data: doc } : { status: 404, data: { error: 'not_found' } };
		}
		if (method === 'DELETE') {
			const current = docs.get(id);
			if (!current) return { status: 404, data: { error: 'not_found' } };
			const revision = url.searchParams.get('rev') ?? (body as { _rev?: string } | undefined)?._rev;
			if (revision !== current._rev) {
				return { status: 409, data: { error: 'conflict' } };
			}
			docs.delete(id);
			return { status: 200, data: { ok: true, id } };
		}
		if (method === 'PUT') {
			const incoming = body as Record<string, unknown>;
			const current = docs.get(id);
			if (permanentlyConflictingIds.has(id)) {
				return { status: 409, data: { error: 'conflict' } };
			}
			if (current && incoming._rev !== current._rev) {
				return { status: 409, data: { error: 'conflict' } };
			}
			const revision = `${Number(String(current?._rev ?? '0').split('-')[0]) + 1}-mock`;
			const saved = { ...incoming, _rev: revision };
			docs.set(id, saved);
			return { status: 201, data: { ok: true, id, rev: revision } };
		}
		return { status: 500, data: { error: 'unsupported' } };
	});
}

function input(name: string): Record<string, unknown> {
	return { name, capacity: 100 };
}

async function createSingleJob(): Promise<{ jobId: string; item: ShelterImportItemSummary }> {
	const job = await createImportJob({
		filename: 'shelters.xlsx',
		importedBy: 'admin',
		idempotencyKey: 'single-job-key',
		duplicateAction: 'skip',
		rows: [{ row: 1, name: 'ศูนย์ A', input: input('ศูนย์ A') as never, valid: true }]
	});
	const summary = await getImportJob(job._id);
	if (!summary) throw new Error('test job was not persisted');
	return { jobId: job._id.slice('shelter_import_job:'.length), item: summary.items[0] };
}

describe('shelter import job lifecycle', () => {
	beforeEach(() => {
		setupCouchMock();
	});

	it('uses full job references, padded item ids, and bounded attempts', async () => {
		const job = await createImportJob({
			filename: 'shelters.xlsx',
			importedBy: 'admin',
			idempotencyKey: 'bounded-attempts-key',
			duplicateAction: 'skip',
			rows: [
				{ row: 1, name: 'ศูนย์ A', input: input('ศูนย์ A') as never, valid: true },
				{ row: 12, name: null, valid: false, errors: [{ column: 'name', message: 'required' }] }
			]
		});
		const summary = await getImportJob(job._id);

		expect(summary?.items[0]._id).toContain(':000001');
		expect(summary?.items[1]._id).toContain(':000012');
		expect(summary?.items.every((item) => !('input' in item))).toBe(true);
		expect(summary?.items.every((item) => item.max_attempts === MAX_IMPORT_ATTEMPTS)).toBe(true);
	});

	it('projects worker fencing and private item fields out of status summaries', async () => {
		const { jobId } = await createSingleJob();
		const storedItem = [...docs.values()].find((doc) => doc.type === 'shelter_import_item');
		if (!storedItem) throw new Error('test item was not persisted');
		Object.assign(storedItem, {
			lease_until: new Date(Date.now() + 300_000).toISOString(),
			worker_id: 'worker-secret',
			claim_token: 'claim-secret'
		});

		const summary = await getImportJob(jobId);
		const item = summary?.items[0];
		if (!item) throw new Error('test item summary was not returned');

		for (const field of [
			'input',
			'job_id',
			'created_by',
			'lease_until',
			'worker_id',
			'claim_token'
		]) {
			expect(item).not.toHaveProperty(field);
		}
	});

	it('keeps the import queue private to CouchDB server admins', async () => {
		await createSingleJob();

		expect(securityWrites.at(-1)).toEqual({
			admins: { names: ['legacy-admin'], roles: ['system_admin', '_admin'] },
			members: { names: [], roles: [] }
		});
	});

	it('does not call _all_docs on the worker hot path (list, claim, recompute)', async () => {
		const { jobId } = await createSingleJob();
		const calledPaths: string[] = [];
		const currentImpl = adminRawMock.getMockImplementation()!;
		adminRawMock.mockImplementation(async (path, method, body) => {
			calledPaths.push(`${method} ${path}`);
			return currentImpl(path, method, body);
		});

		calledPaths.length = 0;
		// 1. List runnable jobs
		const jobs = await listRunnableImportJobs();
		expect(jobs.length).toBeGreaterThan(0);

		// 2. Claim next item
		const claimed = await claimNextImportItem(jobId, 'worker-1');
		expect(claimed).not.toBeNull();

		// 3. Recompute job
		await recomputeImportJob(jobId);

		// Verify none of the calls on the queue db used _all_docs
		const queueAllDocsCalls = calledPaths.filter((p) =>
			p.includes(`/${IMPORT_QUEUE_DB}/_all_docs`)
		);
		expect(queueAllDocsCalls).toEqual([]);
	});

	it('fails closed when security ACL setup fails', async () => {
		adminRawMock.mockImplementation(async (path) => {
			if (path === `/${IMPORT_QUEUE_DB}/_security`) {
				return { status: 500, data: { error: 'database_error' } };
			}
			return { status: 200, data: {} };
		});
		await expect(createSingleJob()).rejects.toMatchObject({
			code: 'INTERNAL'
		});
	});

	it('replays an idempotent request and rejects key reuse with a different body', async () => {
		const args = {
			filename: 'shelters.xlsx',
			importedBy: 'admin',
			idempotencyKey: 'replay-key',
			duplicateAction: 'skip' as const,
			rows: [{ row: 1, name: 'ศูนย์ A', input: input('ศูนย์ A') as never, valid: true }]
		};
		const first = await createImportJob(args);
		const second = await createImportJob(args);

		expect(second._id).toBe(first._id);
		expect([...docs.values()].filter((doc) => doc.type === 'shelter_import_item')).toHaveLength(1);
		await expect(createImportJob({ ...args, filename: 'different.xlsx' })).rejects.toMatchObject({
			code: 'CONFLICT'
		});
	});

	it('only retries failed items after completed_with_errors and appends a new audit attempt', async () => {
		const { jobId, item: snapshot } = await createSingleJob();
		const claimed = await claimNextImportItem(jobId, 'worker-a');
		if (!claimed) throw new Error('test item was not claimed');
		await updateImportItem(claimed, {
			status: 'failed',
			errors: [{ column: '-', message: 'temporary failure' }],
			lease_until: undefined,
			worker_id: undefined,
			claim_token: undefined
		});
		const completed = await recomputeImportJob(jobId);
		expect(completed.status).toBe('completed_with_errors');
		expect(completed.audit_logged).toBe(true);
		const firstLogs = [...docs.values()].filter((doc) => doc.type === 'shelter_import_log');
		expect(firstLogs).toHaveLength(1);

		const retried = await retryFailedImportItems(jobId);
		expect(retried.job.status).toBe('running');
		expect(retried.job.attempt).toBe(2);
		expect(retried.items[0].status).toBe('pending');
		expect(retried.items[0].attempts).toBe(1);

		const secondClaim = await claimNextImportItem(jobId, 'worker-b');
		if (!secondClaim) throw new Error('retried item was not claimed');
		await updateImportItem(secondClaim, {
			status: 'failed',
			errors: [{ column: '-', message: 'still failing' }],
			lease_until: undefined,
			worker_id: undefined,
			claim_token: undefined
		});
		await recomputeImportJob(jobId);

		const logs = [...docs.values()].filter((doc) => doc.type === 'shelter_import_log');
		expect(logs).toHaveLength(2);
		expect(new Set(logs.map((log) => log._id)).size).toBe(2);
		expect(logs.map((log) => log.attempt).sort()).toEqual([1, 2]);
		expect(snapshot._id).toBe(retried.items[0]._id);
	});

	it('does not allow retry while a job is still running', async () => {
		const { jobId } = await createSingleJob();
		await expect(retryFailedImportItems(jobId)).rejects.toMatchObject({ code: 'CONFLICT' });
	});

	it('fences an expired worker claim when another worker takes over', async () => {
		const { jobId } = await createSingleJob();
		const first = await claimNextImportItem(jobId, 'worker-a', 1);
		if (!first) throw new Error('first worker did not claim');
		const stored = docs.get(first._id);
		if (!stored) throw new Error('claimed item missing from test store');
		stored.lease_until = new Date(Date.now() - 1).toISOString();
		const second = await claimNextImportItem(jobId, 'worker-b', 60_000);
		if (!second) throw new Error('second worker did not reclaim');

		const result = await updateImportItem(first, { status: 'created', code: 'SH001' });
		expect(result.claim_token).toBe(second.claim_token);
		expect(result.worker_id).toBe('worker-b');
		expect(result.status).toBe('running');
	});

	it('allows only one winner when workers claim the same item concurrently', async () => {
		const { jobId } = await createSingleJob();
		const [first, second] = await Promise.all([
			claimNextImportItem(jobId, 'worker-a'),
			claimNextImportItem(jobId, 'worker-b')
		]);

		expect([first, second].filter(Boolean)).toHaveLength(1);
		const winner = first ?? second;
		expect(winner?.worker_id).toMatch(/worker-[ab]/);
		expect([first, second].filter((claim) => claim === null)).toHaveLength(1);
	});

	it('renews only the current claim and rejects a reclaimed token', async () => {
		const { jobId } = await createSingleJob();
		const claimed = await claimNextImportItem(jobId, 'worker-a');
		if (!claimed) throw new Error('item was not claimed');

		const renewed = await renewImportItemClaim(claimed, 60_000);
		expect(Date.parse(renewed.lease_until!)).toBeGreaterThan(Date.now());
		const stored = docs.get(claimed._id);
		if (!stored) throw new Error('claimed item missing from test store');
		stored.claim_token = 'successor-token';

		await expect(renewImportItemClaim(claimed)).rejects.toMatchObject({ code: 'CONFLICT' });
	});

	it('keeps retry pending when a failed item cannot win its requeue CAS', async () => {
		const { jobId, item: snapshot } = await createSingleJob();
		const claimed = await claimNextImportItem(jobId, 'worker-a');
		if (!claimed) throw new Error('item was not claimed');
		await updateImportItem(claimed, {
			status: 'failed',
			errors: [{ column: '-', message: 'temporary failure' }],
			lease_until: undefined,
			worker_id: undefined,
			claim_token: undefined
		});
		await recomputeImportJob(jobId);
		permanentlyConflictingIds.add(snapshot._id);

		await expect(retryFailedImportItems(jobId)).rejects.toMatchObject({ code: 'CONFLICT' });
		const recovered = await getImportJob(jobId);
		expect(recovered?.job.retry_pending).toBe(true);
		expect(recovered?.job.status).toBe('running');
		expect(recovered?.items[0].status).toBe('failed');
	});

	it('does not accept an unrelated document on an audit-log conflict', async () => {
		const { jobId } = await createSingleJob();
		const claimed = await claimNextImportItem(jobId, 'worker-a');
		if (!claimed) throw new Error('item was not claimed');
		await updateImportItem(claimed, {
			status: 'created',
			code: 'SH001',
			lease_until: undefined,
			worker_id: undefined,
			claim_token: undefined
		});
		const completed = await recomputeImportJob(jobId);
		const log = [...docs.values()].find((doc) => doc.type === 'shelter_import_log');
		if (!log) throw new Error('audit log was not created');
		const jobDocument = docs.get(`shelter_import_job:${jobId}`);
		if (!jobDocument) throw new Error('job document missing');
		jobDocument.audit_logged = false;
		log.results = [{ row: 99, name: 'unexpected', status: 'server_error' }];

		await expect(recomputeImportJob(jobId)).rejects.toMatchObject({ code: 'CONFLICT' });
		expect(completed.audit_logged).toBe(true);
	});

	it('does not terminalize a job when a staged item document is missing', async () => {
		const { jobId, item } = await createSingleJob();
		docs.delete(item._id);

		await expect(recomputeImportJob(jobId)).rejects.toMatchObject({ code: 'CONFLICT' });
	});

	it('does not requeue a dead-lettered item after the attempt limit', async () => {
		const { jobId } = await createSingleJob();
		const item = (await getImportJob(jobId))?.items[0];
		if (!item) throw new Error('test item missing');
		const failed = {
			...item,
			status: 'failed' as const,
			attempts: MAX_IMPORT_ATTEMPTS,
			max_attempts: MAX_IMPORT_ATTEMPTS,
			dead_lettered_at: new Date().toISOString()
		};
		await adminRaw(`/${IMPORT_QUEUE_DB}/${encodeURIComponent(item._id)}`, 'PUT', failed);
		await recomputeImportJob(jobId);
		const summary = await retryFailedImportItems(jobId);
		expect(summary.items[0].status).toBe('failed');
		expect(summary.items[0].attempts).toBe(MAX_IMPORT_ATTEMPTS);
	});
});
