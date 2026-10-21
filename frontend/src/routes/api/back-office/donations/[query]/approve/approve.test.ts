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
 * R-16.2 / CR-174 — reviewing a booking, line by line when it has per-line review.
 *
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

	it('approves a booking from before schema_v 7 as a whole (AC-8)', async () => {
		mockCouch(baseDonation);

		const response = await POST(postEvent({ memo: 'ok' }));

		expect(response.status).toBe(200);
		expect(putBody()).toMatchObject({ status: 'verifying', schema_v: 5 });
		expect((putBody()?.items as { review_status?: string }[])[0].review_status).toBeUndefined();
	});

	it('refuses per-line decisions on a booking that has no per-line review', async () => {
		mockCouch(baseDonation);

		const response = await POST(postEvent({ lines: [{ index: 0, decision: 'approved' }] }));

		expect(response.status).toBe(422);
		expect(putBody()).toBeUndefined();
	});

	describe('per-line review (CR-174)', () => {
		const mixed = {
			...baseDonation,
			schema_v: 7,
			campaign_id: 'donation_campaign:c1',
			items: [
				{ item_id: 'item:rice', qty: '10', unit: 'kg', review_status: 'approved' },
				{ free_text: 'ผ้าห่ม', qty: '2', unit: 'ผืน', review_status: 'pending' }
			]
		} as unknown as PublicDonationDoc;

		it('AC-2: approving the typed line sends the booking to drop-off', async () => {
			mockCouch(mixed);

			const response = await POST(postEvent({ lines: [{ index: 1, decision: 'approved' }] }));

			expect(response.status).toBe(200);
			expect(putBody()).toMatchObject({ status: 'verifying' });
			expect((putBody()?.items as { review_status: string }[]).map((i) => i.review_status)).toEqual(
				['approved', 'approved']
			);
			expect(writtenDocs()[0].context).toMatchObject({
				lines: [{ index: 1, decision: 'approved', reason_code: null }]
			});
		});

		it('AC-3: refusing the typed line keeps the campaign line and the reason for the donor', async () => {
			mockCouch(mixed);

			await POST(
				postEvent({
					lines: [{ index: 1, decision: 'rejected', reason_code: 'damaged', note: 'ขาด' }]
				})
			);

			expect(putBody()).toMatchObject({ status: 'verifying' });
			expect((putBody()?.items as object[])[1]).toMatchObject({
				review_status: 'rejected',
				review_reason_code: 'damaged',
				review_reason: 'ชำรุดเสียหาย — ขาด'
			});
		});

		it('AC-4: refusing every typed line refuses the booking', async () => {
			mockCouch({
				...mixed,
				items: [{ free_text: 'ผ้าห่ม', qty: '2', unit: 'ผืน', review_status: 'pending' }]
			} as unknown as PublicDonationDoc);

			await POST(
				postEvent({ lines: [{ index: 0, decision: 'rejected', reason_code: 'expired' }] })
			);

			expect(putBody()).toMatchObject({
				status: 'rejected',
				reject_reason: 'หมดอายุ',
				reject_reason_code: 'expired'
			});
		});

		it('approves every pending line when no lines are sent (one-button approve)', async () => {
			mockCouch(mixed);

			await POST(postEvent({}));

			expect(putBody()).toMatchObject({ status: 'verifying' });
		});

		it.each([
			['a campaign line', [{ index: 0, decision: 'rejected', reason_code: 'expired' }]],
			['an undecided pending line', []],
			['"other" without detail (AC-17)', [{ index: 1, decision: 'rejected', reason_code: 'other' }]]
		])('answers 422 for %s, writing nothing', async (_label, lines) => {
			mockCouch(mixed);

			const response = await POST(postEvent({ lines }));

			expect(response.status).toBe(422);
			expect(writtenDocs()).toHaveLength(0);
			expect(putBody()).toBeUndefined();
		});
	});
});
