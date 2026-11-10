import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { adminRaw, requireShelterScopeOrSA, ServiceError } from '$lib/server/couch-admin';
import { readCurrentDonationPoints } from '$lib/server/donation-docs';
import type { PublicDonationDoc } from '$lib/features/donations';

type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/couch-admin', async (importOriginal) => ({
	ServiceError: (await importOriginal<typeof import('$lib/server/couch-admin')>()).ServiceError,
	adminRaw: vi.fn(),
	requireShelterScopeOrSA: vi.fn()
}));
vi.mock('$lib/server/donation-docs', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/donation-docs')>()),
	readCurrentDonationPoints: vi.fn()
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
		vi.mocked(readCurrentDonationPoints).mockResolvedValue([]);
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

		// A point took the first line in while the booking waited for review; refusing it now
		// would leave the receipt counting goods the donor reads as turned away.
		it('refuses to reject a line a drop-off point already received', async () => {
			mockCouch({
				...mixed,
				items: [
					{
						item_id: 'item:water',
						qty: '24',
						unit: 'ขวด',
						review_status: 'pending',
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
						items: [{ line_no: 0, item_id: 'item:water', qty: '24', unit: 'ขวด' }]
					}
				]
			} as unknown as PublicDonationDoc);

			const response = await POST(
				postEvent({
					lines: [
						{ index: 0, decision: 'rejected', reason_code: 'expired' },
						{ index: 1, decision: 'approved' }
					]
				})
			);

			expect(response.status).toBe(409);
			const body = await response.json();
			expect(body.error_code).toBe('LINE_ALREADY_RECEIVED');
			expect(body.lines).toEqual([0]);
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

describe('POST /api/back-office/donations/[query]/approve — drop-off points (FR-AP-17)', () => {
	const GYM = { id: 'sp-gym', name: 'โรงยิม' };
	const MED = { id: 'sp-med', name: 'ห้องพยาบาล' };

	/** AC-AP-9: two typed-in self drop-off lines, no point yet. */
	const selfDonated = {
		...baseDonation,
		schema_v: 11,
		campaign_id: null,
		logistics: { delivery_method: 'self_dropoff' },
		items: [
			{
				free_text: 'ผ้าห่ม',
				qty: '5',
				unit: 'ผืน',
				review_status: 'pending',
				drop_off_point_id: null
			},
			{
				free_text: 'น้ำดื่ม',
				qty: '2',
				unit: 'ลัง',
				review_status: 'pending',
				drop_off_point_id: null
			}
		]
	} as unknown as PublicDonationDoc;

	const putItems = () => putBody()?.items as { drop_off_point_id?: string | null }[];

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'warehouse',
			roles: ['shelter:SH001', 'warehouse_staff'],
			isSA: false,
			shelterCode: 'SH001'
		});
		vi.mocked(readCurrentDonationPoints).mockResolvedValue([GYM, MED]);
	});

	it('AC-AP-10: writes each chosen point with the review and audits it', async () => {
		mockCouch(selfDonated);

		const response = await POST(
			postEvent({
				lines: [
					{ index: 0, decision: 'approved', drop_off_point_id: 'sp-gym' },
					{ index: 1, decision: 'approved', drop_off_point_id: 'sp-med' }
				]
			})
		);

		expect(response.status).toBe(200);
		expect(readCurrentDonationPoints).toHaveBeenCalledWith('SH001');
		expect(putBody()).toMatchObject({ status: 'verifying' });
		expect(putItems().map((item) => item.drop_off_point_id)).toEqual(['sp-gym', 'sp-med']);
		expect(writtenDocs()[0].context).toMatchObject({
			lines: [
				{ index: 0, decision: 'approved', drop_off_point_id: 'sp-gym' },
				{ index: 1, decision: 'approved', drop_off_point_id: 'sp-med' }
			]
		});
	});

	it('AC-AP-12: a refused line keeps its point and audits null', async () => {
		mockCouch({
			...selfDonated,
			items: [{ ...selfDonated.items![0], drop_off_point_id: 'sp-old' }, selfDonated.items![1]]
		} as unknown as PublicDonationDoc);

		const response = await POST(
			postEvent({
				lines: [
					{ index: 0, decision: 'rejected', reason_code: 'damaged' },
					{ index: 1, decision: 'approved', drop_off_point_id: 'sp-med' }
				]
			})
		);

		expect(response.status).toBe(200);
		expect(putItems().map((item) => item.drop_off_point_id)).toEqual(['sp-old', 'sp-med']);
		expect(writtenDocs()[0].context).toMatchObject({
			lines: [
				{ index: 0, decision: 'rejected', drop_off_point_id: null },
				{ index: 1, decision: 'approved', drop_off_point_id: 'sp-med' }
			]
		});
	});

	it.each([
		[
			'AC-AP-11: an approved line without a point',
			[
				{ index: 0, decision: 'approved', drop_off_point_id: 'sp-gym' },
				{ index: 1, decision: 'approved' }
			],
			'POINT_REQUIRED',
			[1]
		],
		[
			'AC-AP-12: a point the shelter does not offer',
			[
				{ index: 0, decision: 'approved', drop_off_point_id: 'sp-gone' },
				{ index: 1, decision: 'approved', drop_off_point_id: 'sp-med' }
			],
			'UNKNOWN_DROP_OFF_POINT',
			[0]
		]
	])('answers 422 for %s, writing nothing', async (_label, lines, code, badLines) => {
		mockCouch(selfDonated);

		const response = await POST(postEvent({ lines }));

		expect(response.status).toBe(422);
		const body = await response.json();
		expect(body.error_code).toBe(code);
		expect(body.lines).toEqual(badLines);
		expect(writtenDocs()).toHaveLength(0);
		expect(putBody()).toBeUndefined();
	});

	it('AC-AP-12: a point sent with a refusal is an invalid review', async () => {
		mockCouch(selfDonated);

		const response = await POST(
			postEvent({
				lines: [
					{ index: 0, decision: 'rejected', reason_code: 'damaged', drop_off_point_id: 'sp-gym' },
					{ index: 1, decision: 'approved', drop_off_point_id: 'sp-med' }
				]
			})
		);

		expect(response.status).toBe(422);
		expect((await response.json()).error_code).toBe('INVALID_REVIEW');
		expect(putBody()).toBeUndefined();
	});

	it('AC-AP-12a: a parcel booking gets null whatever was sent, without reading the points', async () => {
		mockCouch({
			...selfDonated,
			logistics: { delivery_method: 'parcel' }
		} as unknown as PublicDonationDoc);

		const response = await POST(
			postEvent({
				lines: [
					{ index: 0, decision: 'approved', drop_off_point_id: 'sp-gone' },
					{ index: 1, decision: 'approved' }
				]
			})
		);

		expect(response.status).toBe(200);
		expect(putItems().map((item) => item.drop_off_point_id)).toEqual([null, null]);
		expect(readCurrentDonationPoints).not.toHaveBeenCalled();
	});

	it('refusing every line does not read the points', async () => {
		mockCouch(selfDonated);

		const response = await POST(
			postEvent({
				lines: [
					{ index: 0, decision: 'rejected', reason_code: 'damaged' },
					{ index: 1, decision: 'rejected', reason_code: 'damaged' }
				]
			})
		);

		expect(response.status).toBe(200);
		expect(readCurrentDonationPoints).not.toHaveBeenCalled();
	});

	it('AC-AP-12b: approving without lines refuses a pending line with no point', async () => {
		mockCouch(selfDonated);

		const response = await POST(postEvent({}));

		expect(response.status).toBe(422);
		const body = await response.json();
		expect(body.error_code).toBe('POINT_REQUIRED');
		expect(body.lines).toEqual([0, 1]);
		expect(putBody()).toBeUndefined();
	});

	it('AC-AP-12b: a booking from before schema_v 7 approves as before, points null', async () => {
		mockCouch({
			...baseDonation,
			logistics: { delivery_method: 'self_dropoff' }
		} as unknown as PublicDonationDoc);

		const response = await POST(postEvent({}));

		expect(response.status).toBe(200);
		expect(putItems()[0].drop_off_point_id).toBeUndefined();
		expect(readCurrentDonationPoints).not.toHaveBeenCalled();
	});

	describe('AC-AP-12c: a line a point received before review', () => {
		const received = {
			...selfDonated,
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
					qty: '5',
					unit: 'ผืน',
					review_status: 'pending',
					drop_off_point_id: null
				}
			],
			point_receipts: [
				{
					...POINT_RECEIPTS[0],
					line_nos: [1],
					ledger_ids: ['stock_ledger:row-1'],
					items: [{ line_no: 1, free_text: 'ผ้าห่ม', qty: '5', unit: 'ผืน' }]
				}
			]
		} as unknown as PublicDonationDoc;

		it('needs no point and keeps its own', async () => {
			mockCouch(received);

			const response = await POST(postEvent({ lines: [{ index: 1, decision: 'approved' }] }));

			expect(response.status).toBe(200);
			expect(putItems()[1].drop_off_point_id).toBeNull();
			expect(readCurrentDonationPoints).not.toHaveBeenCalled();
			expect(writtenDocs()[0].context).toMatchObject({
				lines: [{ index: 1, decision: 'approved', drop_off_point_id: null }]
			});
		});

		it('refuses a point sent for it', async () => {
			mockCouch(received);

			const response = await POST(
				postEvent({ lines: [{ index: 1, decision: 'approved', drop_off_point_id: 'sp-med' }] })
			);

			expect(response.status).toBe(422);
			expect((await response.json()).error_code).toBe('INVALID_REVIEW');
			expect(putBody()).toBeUndefined();
		});
	});

	it('answers 503 and writes nothing when the points cannot be read', async () => {
		mockCouch(selfDonated);
		vi.mocked(readCurrentDonationPoints).mockRejectedValue(
			new ServiceError('INTERNAL', 'Could not read registry')
		);

		const response = await POST(
			postEvent({
				lines: [
					{ index: 0, decision: 'approved', drop_off_point_id: 'sp-gym' },
					{ index: 1, decision: 'approved', drop_off_point_id: 'sp-med' }
				]
			})
		);

		expect(response.status).toBe(503);
		expect((await response.json()).error_code).toBe('DONATION_UNAVAILABLE');
		expect(writtenDocs()).toHaveLength(0);
		expect(putBody()).toBeUndefined();
	});
});
