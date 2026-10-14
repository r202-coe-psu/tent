import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	bulkTransition,
	BULK_TRANSITION_CONCURRENCY,
	BULK_TRANSITION_MAX_IDS
} from './referral.bulk-transition';
import type { Referral } from '../domain/referral.schema';

const adminRaw = vi.fn();

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: (...args: unknown[]) => adminRaw(...args)
}));

function makeReferral(n: number | string, overrides: Partial<Referral> = {}): Referral {
	return {
		_id: `referral:${n}`,
		_rev: '1-a',
		type: 'referral',
		schema_v: 1,
		shelter_code: 'SH001',
		created_at: '2026-07-11T05:00:00.000Z',
		updated_at: '2026-07-11T05:00:00.000Z',
		created_by: 'Staff A',
		evacuee_id: 'evacuee:01F8MECHEVACUEEID1234567',
		referral_type: 'medical-emergency',
		to_org: { name: 'General Hospital', kind: 'hospital' },
		reason: 'Needs care',
		urgency: 'normal',
		status: 'sent',
		timeline: { sent: { at: '2026-07-11T05:00:00.000Z', by: 'Staff A' } },
		...overrides
	} as Referral;
}

/** Stateful fake of `central_ops`; tracks the peak number of concurrent CouchDB calls. */
function fakeCouch(
	docs: Referral[],
	options: { delayMs?: number; conflictOnce?: Set<string> } = {}
) {
	const store = new Map(docs.map((d) => [d._id, d]));
	const conflicted = new Set<string>();
	const stats = { inFlight: 0, peak: 0 };

	adminRaw.mockImplementation(async (path: string, method: string, body?: Referral) => {
		stats.inFlight += 1;
		stats.peak = Math.max(stats.peak, stats.inFlight);
		try {
			if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
			const decoded = decodeURIComponent(path);
			if (method === 'PUT' && body === undefined) return { status: 201, data: { ok: true } };
			if (method === 'POST') return { status: 200, data: { result: 'exists' } };
			if (method === 'GET') {
				const id = decoded.replace('/central_ops/', '');
				const found = store.get(id);
				return found ? { status: 200, data: found } : { status: 404, data: { error: 'not_found' } };
			}
			if (method === 'PUT' && body) {
				if (options.conflictOnce?.has(body._id) && !conflicted.has(body._id)) {
					conflicted.add(body._id);
					return { status: 409, data: { error: 'conflict' } };
				}
				store.set(body._id, body);
				return { status: 201, data: { ok: true, id: body._id, rev: '2-b' } };
			}
			return { status: 500, data: { error: 'unexpected' } };
		} finally {
			stats.inFlight -= 1;
		}
	});

	return { store, stats };
}

describe('bulkTransition', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('accounts for every id in a mixed batch and persists the successes', async () => {
		const { store } = fakeCouch([
			makeReferral('ok1'),
			makeReferral('ok2', { status: 'accepted' }),
			makeReferral('foreign', { shelter_code: 'SH009' }),
			makeReferral('done', {
				status: 'closed',
				timeline: { closed: { at: '2026-07-11T05:00:00.000Z', by: 'x' } }
			})
		]);

		const result = await bulkTransition(
			['referral:ok1', 'referral:ok2', 'referral:foreign', 'referral:done', 'referral:missing'],
			'closed',
			'ปิดงาน',
			'sm_user',
			'SH001'
		);

		expect(result.succeeded.map((d) => d._id)).toEqual(['referral:ok1', 'referral:ok2']);
		expect(result.succeeded.every((d) => d.status === 'closed' && d._rev === '2-b')).toBe(true);
		expect(result.failed.map((f) => f.id)).toEqual([
			'referral:foreign',
			'referral:done',
			'referral:missing'
		]);
		expect(result.failed.find((f) => f.id === 'referral:foreign')?.error).toMatch(/originating/);
		expect(result.failed.find((f) => f.id === 'referral:done')?.error).toBe(
			'Invalid referral transition'
		);
		expect(result.failed.find((f) => f.id === 'referral:missing')?.error).toBe(
			'Referral not found'
		);

		// Successes were written (no rollback); failures were not touched.
		for (const id of ['referral:ok1', 'referral:ok2']) {
			expect(store.get(id)).toMatchObject({
				status: 'closed',
				close_reason: 'ปิดงาน',
				schema_v: 2,
				_rev: '1-a'
			});
			expect(store.get(id)?.timeline.closed?.by).toBe('sm_user');
		}
		expect(store.get('referral:foreign')?.status).toBe('sent');
	});

	it('keeps response_reason when closing an accepted referral', async () => {
		const { store } = fakeCouch([
			makeReferral('a', { status: 'accepted', response_reason: 'ปลายทางตอบรับ' })
		]);

		await bulkTransition(['referral:a'], 'closed', 'ปิด', 'sm_user', 'SH001');

		expect(store.get('referral:a')).toMatchObject({
			response_reason: 'ปลายทางตอบรับ',
			close_reason: 'ปิด'
		});
	});

	it('retries a 409 per item (same behavior as the single-item endpoint)', async () => {
		const { store } = fakeCouch([makeReferral('c1'), makeReferral('c2')], {
			conflictOnce: new Set(['referral:c1'])
		});

		const result = await bulkTransition(
			['referral:c1', 'referral:c2'],
			'closed',
			undefined,
			'sm_user',
			'SH001'
		);

		expect(result.succeeded.map((d) => d._id)).toEqual(['referral:c1', 'referral:c2']);
		expect(result.failed).toEqual([]);
		expect(store.get('referral:c1')?.status).toBe('closed');
	});

	it('reports a persistent 409 as failed after 3 attempts without blocking other ids', async () => {
		const conflicts = vi.fn();
		fakeCouch([makeReferral('x'), makeReferral('y')]);
		const base = adminRaw.getMockImplementation()!;
		adminRaw.mockImplementation(async (path: string, method: string, body?: Referral) => {
			if (method === 'PUT' && body?._id === 'referral:x') {
				conflicts();
				return { status: 409, data: { error: 'conflict' } };
			}
			return base(path, method, body);
		});

		const result = await bulkTransition(
			['referral:x', 'referral:y'],
			'closed',
			undefined,
			'sm',
			'SH001'
		);

		expect(result.succeeded.map((d) => d._id)).toEqual(['referral:y']);
		expect(result.failed).toEqual([
			{ id: 'referral:x', error: 'Conflict: transition failed after 3 attempts' }
		]);
		expect(conflicts).toHaveBeenCalledTimes(3);
	});

	it('never exceeds the concurrency limit of in-flight CouchDB calls for 200 ids', async () => {
		const docs = Array.from({ length: BULK_TRANSITION_MAX_IDS }, (_, i) => makeReferral(i));
		const { store, stats } = fakeCouch(docs, { delayMs: 2 });

		const result = await bulkTransition(
			docs.map((d) => d._id),
			'closed',
			undefined,
			'sm_user',
			'SH001'
		);

		expect(result.succeeded).toHaveLength(BULK_TRANSITION_MAX_IDS);
		expect(result.failed).toEqual([]);
		expect(stats.peak).toBeGreaterThan(1);
		expect(stats.peak).toBeLessThanOrEqual(BULK_TRANSITION_CONCURRENCY);
		expect([...store.values()].every((d) => d.status === 'closed')).toBe(true);
	});

	it('honours a custom concurrency and de-duplicates ids', async () => {
		const docs = [0, 1, 2, 3].map((i) => makeReferral(i));
		const { stats } = fakeCouch(docs, { delayMs: 2 });

		const result = await bulkTransition(
			[...docs.map((d) => d._id), docs[0]._id],
			'closed',
			undefined,
			'sm_user',
			'SH001',
			{ concurrency: 2 }
		);

		expect(result.succeeded).toHaveLength(4);
		expect(stats.peak).toBeLessThanOrEqual(2);
	});

	it('handles an empty id list', async () => {
		fakeCouch([]);
		await expect(bulkTransition([], 'closed', undefined, 'sm', 'SH001')).resolves.toEqual({
			succeeded: [],
			failed: []
		});
	});
});
