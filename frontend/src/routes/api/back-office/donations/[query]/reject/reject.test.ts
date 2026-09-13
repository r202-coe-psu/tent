import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { adminRaw, requireShelterScopeOrSA } from '$lib/server/couch-admin';
import type { PublicDonationDoc } from '$lib/features/donations';

type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	requireShelterScopeOrSA: vi.fn()
}));

/**
 * R-16.3 — turning a donation away.
 *
 * Reachable from BOTH review steps: before the goods arrive (`pending_review`) and
 * while staff have the boxes open at the counter (`verifying`), which is where the
 * expired tin and the wrong size actually turn up. Either way the refusal must leave
 * no `stock_ledger` row behind — not writing one is what keeps the goods out of stock.
 */

const baseDonation = {
	_id: 'donation:123',
	_rev: '1-abc',
	type: 'donation',
	schema_v: 5,
	status: 'pending_review',
	shelter_code: 'SH001',
	booking_ref: 'DN-999999',
	tracking_token_hash: 'secret-hash',
	donor: { name: 'John Donor', phone: '0812345678' },
	items: [{ item_id: 'item:rice', qty: '10', unit: 'kg' }]
} as unknown as PublicDonationDoc;

function mockCouch(donation: PublicDonationDoc) {
	vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
		if (method === 'GET' && path.includes('/registry/')) {
			return Promise.resolve({
				status: 200,
				data: { rows: [{ id: 'shelter:SH001', doc: { code: 'SH001' } }] }
			});
		}
		if (method === 'GET' && path.includes('donation:')) {
			return Promise.resolve({
				status: 200,
				data: { rows: path.includes('shelter_sh001') ? [{ doc: donation }] : [] }
			});
		}
		if (method === 'POST' && path.includes('_bulk_docs')) {
			return Promise.resolve({ status: 201, data: [{ ok: true }] });
		}
		if (method === 'PUT') {
			return Promise.resolve({ status: 201, data: { ok: true } });
		}
		return Promise.resolve({ status: 404, data: {} });
	});
}

type WrittenDoc = { type: string; reason?: string; context?: Record<string, unknown> };

function writtenDocs(): WrittenDoc[] {
	return vi
		.mocked(adminRaw)
		.mock.calls.filter((c) => String(c[0]).includes('_bulk_docs'))
		.flatMap((c) => (c[2] as { docs: WrittenDoc[] }).docs);
}

const putBody = () =>
	vi.mocked(adminRaw).mock.calls.find((c) => c[1] === 'PUT')?.[2] as
		Record<string, unknown> | undefined;

function postEvent(body: unknown, query = 'DN-999999'): PostEvent {
	return {
		params: { query },
		request: { headers: { get: () => 'session-cookie' }, json: () => Promise.resolve(body) }
	} as unknown as PostEvent;
}

describe('POST /api/back-office/donations/[query]/reject', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'warehouse',
			roles: ['shelter:SH001', 'warehouse_staff'],
			isSA: false,
			shelterCode: 'SH001'
		});
	});

	it('rejects a booking that has not arrived yet', async () => {
		mockCouch(baseDonation);

		const response = await POST(postEvent({ reason: 'พื้นที่จัดเก็บไม่พอ' }));

		expect(response.status).toBe(200);
		expect(putBody()).toMatchObject({ status: 'rejected' });
	});

	it('rejects a delivery already open on the counter, and writes no stock', async () => {
		mockCouch({ ...baseDonation, status: 'verifying' } as PublicDonationDoc);

		const response = await POST(postEvent({ reason: 'ของหมดอายุ' }));

		expect(response.status).toBe(200);
		expect(putBody()).toMatchObject({ status: 'rejected' });
		expect(writtenDocs().filter((d) => d.type === 'stock_ledger')).toHaveLength(0);
	});

	it('keeps the reason on the audit entry, not just in the UI', async () => {
		mockCouch({ ...baseDonation, status: 'verifying' } as PublicDonationDoc);

		await POST(postEvent({ reason: 'ของหมดอายุ' }));

		const audits = writtenDocs().filter((d) => d.type === 'audit');
		expect(audits).toHaveLength(1);
		expect(JSON.stringify(audits[0])).toContain('ของหมดอายุ');
	});

	it('demands a reason — a blank one changes nothing', async () => {
		mockCouch(baseDonation);

		for (const reason of [undefined, '', '   ']) {
			vi.mocked(adminRaw).mockClear();
			mockCouch(baseDonation);
			const response = await POST(postEvent({ reason }));
			expect(response.status).toBe(422);
			expect(writtenDocs()).toHaveLength(0);
			expect(putBody()).toBeUndefined();
		}
	});

	it('refuses a donation whose goods are already on the shelf', async () => {
		mockCouch({ ...baseDonation, status: 'received' } as PublicDonationDoc);

		const response = await POST(postEvent({ reason: 'เปลี่ยนใจ' }));

		expect(response.status).toBe(422);
		expect((await response.json()).error_code).toBe('INVALID_TRANSITION');
		expect(writtenDocs()).toHaveLength(0);
	});

	it('refuses to touch another shelter donation', async () => {
		mockCouch({ ...baseDonation, shelter_code: 'SH002' } as PublicDonationDoc);

		const response = await POST(postEvent({ reason: 'ของหมดอายุ' }));

		expect(response.status).toBe(403);
		expect(writtenDocs()).toHaveLength(0);
	});
});
