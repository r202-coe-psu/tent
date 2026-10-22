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

/** `ledgerFind` answers the stock_ledger `_find` — no rows by default (nothing keyed). */
function mockCouch(
	donation: PublicDonationDoc,
	ledgerFind: { status: number; data: unknown } = { status: 200, data: { docs: [] } }
) {
	vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
		if (method === 'POST' && path.endsWith('/_find')) {
			return Promise.resolve(ledgerFind);
		}
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
	// Decisions carry the `_rev` the screen was loaded at (CR-174); fixtures are `1-abc`.
	const sent =
		body && typeof body === 'object' && !('expected_rev' in body)
			? { expected_rev: '1-abc', ...body }
			: body;
	return {
		params: { query },
		request: { headers: { get: () => 'session-cookie' }, json: () => Promise.resolve(sent) }
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

		const response = await POST(
			postEvent({ reason_code: 'not_needed', note: 'พื้นที่จัดเก็บไม่พอ' })
		);

		expect(response.status).toBe(200);
		expect(putBody()).toMatchObject({ status: 'rejected' });
	});

	it('rejects a delivery already open on the counter, and writes no stock', async () => {
		mockCouch({ ...baseDonation, status: 'verifying' } as PublicDonationDoc);

		const response = await POST(postEvent({ reason_code: 'expired' }));

		expect(response.status).toBe(200);
		expect(putBody()).toMatchObject({ status: 'rejected' });
		expect(writtenDocs().filter((d) => d.type === 'stock_ledger')).toHaveLength(0);
	});

	// CR-172 FR-8 — the donor reads it on the tracking page; the audit still says who and when.
	it('keeps the reason on the donation and on the audit entry', async () => {
		mockCouch({ ...baseDonation, status: 'verifying' } as PublicDonationDoc);

		await POST(postEvent({ reason_code: 'expired', note: 'นมกล่องหมดอายุ 2 กล่อง' }));

		expect(putBody()).toMatchObject({
			status: 'rejected',
			reject_reason: 'หมดอายุ — นมกล่องหมดอายุ 2 กล่อง',
			reject_reason_code: 'expired'
		});
		const audits = writtenDocs().filter((d) => d.type === 'audit');
		expect(audits).toHaveLength(1);
		expect(audits[0]).toMatchObject({
			reason: 'หมดอายุ — นมกล่องหมดอายุ 2 กล่อง',
			context: { rejected_by: 'warehouse', reject_reason_code: 'expired' }
		});
	});

	it('demands a reason — a missing code or a blank "other" changes nothing', async () => {
		for (const body of [
			{},
			{ reason: 'ข้อความแบบเดิม' },
			{ reason_code: 'other' },
			{ reason_code: 'other', note: '   ' },
			{ reason_code: 'bogus' },
			{ reason_code: 'expired', note: 'x'.repeat(401) }
		]) {
			vi.mocked(adminRaw).mockReset();
			mockCouch(baseDonation);
			const response = await POST(postEvent(body));
			expect(response.status).toBe(422);
			expect(writtenDocs()).toHaveLength(0);
			expect(putBody()).toBeUndefined();
		}
	});

	// CR-174 FR-12 / AC-15 — approved campaign lines go with the booking.
	it('rejects every line of a per-line reviewed booking, keeping earlier line reasons', async () => {
		mockCouch({
			...baseDonation,
			status: 'verifying',
			items: [
				{ item_id: 'item:rice', qty: '10', unit: 'kg', review_status: 'approved' },
				{
					free_text: 'ผ้าห่ม',
					qty: '1',
					unit: 'ผืน',
					review_status: 'rejected',
					review_reason: 'หมดอายุ'
				}
			]
		} as unknown as PublicDonationDoc);

		await POST(postEvent({ reason_code: 'not_needed' }));

		const items = putBody()?.items as { review_status: string; review_reason?: string }[];
		expect(items.map((i) => i.review_status)).toEqual(['rejected', 'rejected']);
		expect(items[0].review_reason).toBeUndefined();
		expect(items[1].review_reason).toBe('หมดอายุ');
	});

	it('refuses to reject a booking the donor has edited since it was opened', async () => {
		mockCouch({ ...baseDonation, _rev: '2-edited' } as PublicDonationDoc);

		const response = await POST(postEvent({ reason_code: 'expired' }));

		expect(response.status).toBe(409);
		expect(writtenDocs()).toHaveLength(0);
		expect(putBody()).toBeUndefined();
	});

	it('refuses a rejection that does not say which version it was made on', async () => {
		mockCouch(baseDonation);

		const response = await POST(postEvent({ reason_code: 'expired', expected_rev: undefined }));

		expect(response.status).toBe(422);
		expect(putBody()).toBeUndefined();
	});

	it('refuses a donation whose goods are already on the shelf', async () => {
		mockCouch({ ...baseDonation, status: 'received' } as PublicDonationDoc);

		const response = await POST(postEvent({ reason_code: 'other', note: 'เปลี่ยนใจ' }));

		expect(response.status).toBe(422);
		expect((await response.json()).error_code).toBe('INVALID_TRANSITION');
		expect(writtenDocs()).toHaveLength(0);
	});

	// Full-branch review W3 — a receipt keyed rows but never closed the booking.
	it('refuses a delivery whose goods are already keyed into stock', async () => {
		mockCouch({ ...baseDonation, status: 'verifying' } as PublicDonationDoc, {
			status: 200,
			data: { docs: [{ _id: 'stock_ledger:row-1' }] }
		});

		const response = await POST(postEvent({ reason_code: 'damaged' }));

		expect(response.status).toBe(409);
		expect((await response.json()).error_code).toBe('GOODS_IN_STOCK');
		expect(writtenDocs()).toHaveLength(0);
		expect(putBody()).toBeUndefined();
	});

	it('changes nothing when it cannot tell whether goods are in stock', async () => {
		mockCouch({ ...baseDonation, status: 'verifying' } as PublicDonationDoc, {
			status: 503,
			data: {}
		});

		const response = await POST(postEvent({ reason_code: 'damaged' }));

		expect(response.status).toBeGreaterThanOrEqual(500);
		expect(writtenDocs()).toHaveLength(0);
		expect(putBody()).toBeUndefined();
	});

	it('refuses to touch another shelter donation', async () => {
		mockCouch({ ...baseDonation, shelter_code: 'SH002' } as PublicDonationDoc);

		const response = await POST(postEvent({ reason_code: 'expired' }));

		expect(response.status).toBe(403);
		expect(writtenDocs()).toHaveLength(0);
	});
});
