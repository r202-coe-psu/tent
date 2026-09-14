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
	recomputeImportJob,
	retryFailedImportItems,
	updateImportItem,
	MAX_IMPORT_ATTEMPTS,
	type ShelterImportItem
} from './job-store';

const adminRawMock = vi.mocked(adminRaw);
const docs = new Map<string, Record<string, unknown>>();

function docId(path: string): string {
	return decodeURIComponent(path.slice('/registry/'.length));
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

function setupCouchMock(): void {
	docs.clear();
	adminRawMock.mockImplementation(async (path, method, body) => {
		if (path === '/registry' && method === 'PUT') return { status: 201, data: { ok: true } };
		if (path.includes('/_all_docs?')) return { status: 200, data: allDocs(path) };
		const id = docId(path);
		if (method === 'GET') {
			const doc = docs.get(id);
			return doc ? { status: 200, data: doc } : { status: 404, data: { error: 'not_found' } };
		}
		if (method === 'DELETE') {
			const current = docs.get(id);
			if (!current) return { status: 404, data: { error: 'not_found' } };
			if ((body as { _rev?: string } | undefined)?._rev !== current._rev) {
				return { status: 409, data: { error: 'conflict' } };
			}
			docs.delete(id);
			return { status: 200, data: { ok: true, id } };
		}
		if (method === 'PUT') {
			const incoming = body as Record<string, unknown>;
			const current = docs.get(id);
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

async function createSingleJob(): Promise<{ jobId: string; item: ShelterImportItem }> {
	const job = await createImportJob({
		filename: 'shelters.xlsx',
		importedBy: 'admin',
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
			duplicateAction: 'skip',
			rows: [
				{ row: 1, name: 'ศูนย์ A', input: input('ศูนย์ A') as never, valid: true },
				{ row: 12, name: null, valid: false, errors: [{ column: 'name', message: 'required' }] }
			]
		});
		const summary = await getImportJob(job._id);

		expect(summary?.items[0]._id).toContain(':000001');
		expect(summary?.items[1]._id).toContain(':000012');
		expect(summary?.items.every((item) => item.job_id === job._id)).toBe(true);
		expect(summary?.items.every((item) => item.max_attempts === MAX_IMPORT_ATTEMPTS)).toBe(true);
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
		await adminRaw(`/registry/${encodeURIComponent(item._id)}`, 'PUT', failed);
		await recomputeImportJob(jobId);
		const summary = await retryFailedImportItems(jobId);
		expect(summary.items[0].status).toBe('failed');
		expect(summary.items[0].attempts).toBe(MAX_IMPORT_ATTEMPTS);
	});
});
