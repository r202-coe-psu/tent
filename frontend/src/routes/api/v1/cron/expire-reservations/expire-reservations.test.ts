import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { adminRaw } from '$lib/server/couch-admin';
import { listShelterMasters } from '$lib/server/shelters.admin';

type BulkBody = { docs: Array<{ _id: string; status: string }> };

vi.mock('$lib/server/couch-admin', () => ({ adminRaw: vi.fn() }));
vi.mock('$lib/server/shelters.admin', () => ({ listShelterMasters: vi.fn() }));

describe('POST /api/v1/cron/expire-reservations', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(listShelterMasters).mockResolvedValue([
			{ code: 'SH001', name: 'Test Shelter' }
		] as unknown as Awaited<ReturnType<typeof listShelterMasters>>);
	});

	it('expires only declared donations past their TTL (quota returns on expiry)', async () => {
		const past = new Date(Date.now() - 3600_000).toISOString();
		const future = new Date(Date.now() + 3600_000).toISOString();
		const docs = [
			{ _id: 'donation:expired-me', type: 'donation', status: 'declared', expires_at: past },
			{ _id: 'donation:still-live', type: 'donation', status: 'declared', expires_at: future },
			{ _id: 'donation:already-received', type: 'donation', status: 'received', expires_at: past },
			{ _id: 'stock_ledger:x', type: 'stock_ledger' }
		];

		let bulkBody: BulkBody | null = null;
		vi.mocked(adminRaw).mockImplementation((path: string, method: string, body?: unknown) => {
			if (method === 'GET' && path.includes('_all_docs')) {
				return Promise.resolve({ status: 200, data: { rows: docs.map((doc) => ({ doc })) } });
			}
			if (method === 'POST' && path.includes('_bulk_docs')) {
				bulkBody = body as BulkBody;
				return Promise.resolve({ status: 201, data: [{ ok: true }] });
			}
			return Promise.resolve({ status: 404, data: {} });
		});

		const response = await POST();
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(data.summary.SH001.expired).toBe(1);
		// Only the past-TTL declared donation is written back, flipped to expired.
		// The future-TTL declared and the already-received donation are left untouched.
		expect(bulkBody).not.toBeNull();
		expect(bulkBody!.docs).toHaveLength(1);
		expect(bulkBody!.docs[0]._id).toBe('donation:expired-me');
		expect(bulkBody!.docs[0].status).toBe('expired');
	});

	it('writes nothing when no donation is past its TTL', async () => {
		const future = new Date(Date.now() + 3600_000).toISOString();
		const docs = [
			{ _id: 'donation:live', type: 'donation', status: 'declared', expires_at: future }
		];
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('_all_docs')) {
				return Promise.resolve({ status: 200, data: { rows: docs.map((doc) => ({ doc })) } });
			}
			return Promise.resolve({ status: 404, data: {} });
		});

		const response = await POST();
		const data = await response.json();

		expect(data.summary.SH001.expired).toBe(0);
		const bulkCalls = vi
			.mocked(adminRaw)
			.mock.calls.filter(([p, m]) => m === 'POST' && p.includes('_bulk_docs'));
		expect(bulkCalls).toHaveLength(0);
	});
});
