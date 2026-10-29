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

/** One receipt at a drop-off point that turned its only line away — no ledger row (CR-206). */
const POINT_RECEIPTS = [
	{
		point_id: 'sp-gym',
		line_nos: [0],
		received_at: '2026-10-28T02:12:00.000Z',
		received_by: 'gym-staff',
		audit_id: 'audit:gym',
		ledger_ids: [],
		items: [
			{
				line_no: 0,
				item_id: 'item:water',
				qty: '0',
				unit: 'ขวด',
				rejected: true,
				reject_reason_code: 'damaged'
			}
		]
	}
];

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

		// Re-review round 3 W3 — a receipt keyed rows but never closed the booking.
		it('refuses to reject every line once goods are keyed into stock', async () => {
			mockCouch(
				{
					...mixed,
					items: [{ free_text: 'ผ้าห่ม', qty: '2', unit: 'ผืน', review_status: 'pending' }]
				} as unknown as PublicDonationDoc,
				{ status: 200, data: { docs: [{ _id: 'stock_ledger:row-1' }] } }
			);

			const response = await POST(
				postEvent({ lines: [{ index: 0, decision: 'rejected', reason_code: 'expired' }] })
			);

			expect(response.status).toBe(409);
			expect((await response.json()).error_code).toBe('GOODS_IN_STOCK');
			expect(writtenDocs()).toHaveLength(0);
			expect(putBody()).toBeUndefined();
		});

		// CR-206 AC-9 — a point that turned its lines away keyed no row; the booking is started.
		it('refuses to reject every line once a drop-off point recorded a receipt', async () => {
			mockCouch({
				...mixed,
				items: [
					{
						item_id: 'item:water',
						qty: '24',
						unit: 'ขวด',
						review_status: 'pending',
						drop_off_point_id: 'sp-gym'
					}
				],
				point_receipts: POINT_RECEIPTS
			} as unknown as PublicDonationDoc);

			const response = await POST(
				postEvent({ lines: [{ index: 0, decision: 'rejected', reason_code: 'expired' }] })
			);

			expect(response.status).toBe(409);
			expect((await response.json()).error_code).toBe('GOODS_IN_STOCK');
			expect(writtenDocs()).toHaveLength(0);
			expect(putBody()).toBeUndefined();
		});

		it('closes the booking when refusing the last line a point had not recorded (FR-MP-23)', async () => {
			mockCouch({
				...mixed,
				items: [
					{
						item_id: 'item:rice',
						qty: '10',
						unit: 'kg',
						review_status: 'approved',
						drop_off_point_id: 'sp-gym'
					},
					{
						free_text: 'ผ้าห่ม',
						qty: '2',
						unit: 'ผืน',
						review_status: 'pending',
						drop_off_point_id: 'sp-med'
					}
				],
				point_receipts: [
					{
						...POINT_RECEIPTS[0],
						ledger_ids: ['stock_ledger:row-1'],
						items: [{ line_no: 0, item_id: 'item:rice', qty: '10', unit: 'kg' }]
					}
				]
			} as unknown as PublicDonationDoc);

			const response = await POST(
				postEvent({ lines: [{ index: 1, decision: 'rejected', reason_code: 'damaged' }] })
			);

			expect(response.status).toBe(200);
			expect(putBody()).toMatchObject({
				status: 'received',
				received_summary: { closed_reason: 'all_points', closed_by: 'warehouse' }
			});
			expect(writtenDocs()[0].context).toMatchObject({
				status: 'received',
				closed_reason: 'all_points'
			});
		});

		it('closes as rejected when the point turned its line away and review refuses the rest', async () => {
			mockCouch({
				...mixed,
				items: [
					{
						item_id: 'item:water',
						qty: '24',
						unit: 'ขวด',
						review_status: 'approved',
						drop_off_point_id: 'sp-gym'
					},
					{
						free_text: 'ผ้าห่ม',
						qty: '2',
						unit: 'ผืน',
						review_status: 'pending',
						drop_off_point_id: 'sp-med'
					}
				],
				point_receipts: POINT_RECEIPTS
			} as unknown as PublicDonationDoc);

			const response = await POST(
				postEvent({ lines: [{ index: 1, decision: 'rejected', reason_code: 'expired' }] })
			);

			expect(response.status).toBe(200);
			expect(putBody()).toMatchObject({
				status: 'rejected',
				received_summary: { closed_reason: 'all_points' }
			});
			expect(putBody()?.reject_reason).toBeTruthy();
			expect(writtenDocs()[0].reason).toContain('ปิดใบ');
			expect(writtenDocs()[0].context).toMatchObject({
				status: 'rejected',
				closed_reason: 'all_points'
			});
		});

		it('keeps the booking open while a line still waits for its point', async () => {
			mockCouch({
				...mixed,
				items: [
					{
						item_id: 'item:rice',
						qty: '10',
						unit: 'kg',
						review_status: 'approved',
						drop_off_point_id: 'sp-gym'
					},
					{
						free_text: 'ผ้าห่ม',
						qty: '2',
						unit: 'ผืน',
						review_status: 'pending',
						drop_off_point_id: 'sp-med'
					}
				],
				point_receipts: [
					{
						...POINT_RECEIPTS[0],
						items: [{ line_no: 0, item_id: 'item:rice', qty: '10', unit: 'kg' }]
					}
				]
			} as unknown as PublicDonationDoc);

			await POST(postEvent({ lines: [{ index: 1, decision: 'approved' }] }));

			expect(putBody()).toMatchObject({ status: 'verifying' });
			expect(putBody()).not.toHaveProperty('received_summary');
		});

		it('still approves lines of a booking with goods keyed (only a rejection is refused)', async () => {
			mockCouch(mixed, { status: 200, data: { docs: [{ _id: 'stock_ledger:row-1' }] } });

			const response = await POST(postEvent({ lines: [{ index: 1, decision: 'approved' }] }));

			expect(response.status).toBe(200);
			expect(putBody()).toMatchObject({ status: 'verifying' });
		});

		// The donor may edit a booking under review (FR-21): decisions by line position
		// must be about the booking on file, or they land on lines nobody looked at.
		it('refuses decisions made on a booking the donor has since edited', async () => {
			mockCouch({ ...mixed, _rev: '2-edited' } as unknown as PublicDonationDoc);

			const response = await POST(postEvent({ lines: [{ index: 1, decision: 'approved' }] }));

			expect(response.status).toBe(409);
			expect((await response.json()).error_code).toBe('DONATION_CHANGED');
			expect(writtenDocs()).toHaveLength(0);
			expect(putBody()).toBeUndefined();
		});

		it('says "changed" rather than "cannot approve" when an edit took the booking out of review', async () => {
			mockCouch({
				...mixed,
				_rev: '3-edited',
				status: 'verifying'
			} as unknown as PublicDonationDoc);

			const response = await POST(postEvent({ lines: [{ index: 1, decision: 'approved' }] }));

			expect(response.status).toBe(409);
			expect((await response.json()).error_code).toBe('DONATION_CHANGED');
		});

		it('refuses a decision that does not say which version it was made on', async () => {
			mockCouch(mixed);

			const response = await POST(
				postEvent({ expected_rev: undefined, lines: [{ index: 1, decision: 'approved' }] })
			);

			expect(response.status).toBe(422);
			expect(putBody()).toBeUndefined();
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
