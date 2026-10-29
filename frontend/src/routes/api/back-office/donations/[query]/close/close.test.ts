import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { adminRaw, requireShelterScopeOrSA } from '$lib/server/couch-admin';
import type { PublicDonationDoc } from '$lib/features/donations';
import {
	deriveDonationCloseAuditId,
	type DonationPointReceipt
} from '$lib/features/operations/server';
import type { AuditEntry } from '$lib/features/shared';

type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	requireShelterScopeOrSA: vi.fn()
}));

/** The gym received the water; the medicine never came (CR-206 AC-5). */
const gymReceipt: DonationPointReceipt = {
	point_id: 'sp-gym',
	line_nos: [0],
	received_at: '2026-10-28T02:12:00.000Z',
	received_by: 'gym-staff',
	audit_id: 'audit:gym',
	ledger_ids: ['stock_ledger:water'],
	items: [{ line_no: 0, item_id: 'item:water', qty: '24', unit: 'ขวด' }]
};

const startedDonation = {
	_id: 'donation:123',
	_rev: '3-abc',
	type: 'donation',
	schema_v: 10,
	status: 'verifying',
	shelter_code: 'SH001',
	booking_ref: 'DN-999999',
	tracking_token_hash: 'secret-hash',
	donor: { name: 'John Donor', phone: '0812345678' },
	items: [
		{ item_id: 'item:water', qty: '24', unit: 'ขวด', drop_off_point_id: 'sp-gym' },
		{ item_id: 'item:paracetamol', qty: '10', unit: 'แผง', drop_off_point_id: 'sp-med' }
	],
	point_receipts: [gymReceipt],
	logistics: { delivery_method: 'self_dropoff' }
} as unknown as PublicDonationDoc;

function mockCouch(donation: PublicDonationDoc, over: { putStatus?: number } = {}) {
	vi.mocked(adminRaw).mockImplementation(async (path: string, method: string) => {
		if (method === 'GET' && path.includes('/registry/')) {
			return { status: 200, data: { rows: [{ id: 'shelter:SH001', doc: { code: 'SH001' } }] } };
		}
		if (method === 'GET' && path.includes('donation:')) {
			return { status: 200, data: { rows: [{ doc: donation }] } };
		}
		if (method === 'POST' && path.includes('_bulk_docs')) {
			return { status: 201, data: [{ ok: true }] };
		}
		if (method === 'PUT') {
			return { status: over.putStatus ?? 201, data: { ok: true, rev: '4-closed' } };
		}
		return { status: 404, data: {} };
	});
}

function postEvent(body: unknown = { expected_rev: '3-abc' }): PostEvent {
	return {
		params: { query: 'DN-999999' },
		request: { headers: { get: () => 'session-cookie' }, json: () => Promise.resolve(body) }
	} as unknown as PostEvent;
}

const putBody = () =>
	vi.mocked(adminRaw).mock.calls.find((c) => c[1] === 'PUT')?.[2] as PublicDonationDoc | undefined;
const writtenAudits = () =>
	vi
		.mocked(adminRaw)
		.mock.calls.filter((c) => String(c[0]).includes('_bulk_docs'))
		.flatMap((c) => (c[2] as { docs: AuditEntry[] }).docs);

// CR-206 FR-MP-26 – FR-MP-28
describe('POST /api/back-office/donations/[query]/close', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'admin',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
	});

	it('AC-7: closes as received, the missing medicine a shortfall, with one audit entry', async () => {
		mockCouch(startedDonation);

		const response = await POST(postEvent());
		const body = await response.json();

		expect(response.status).toBe(200);
		const saved = putBody()!;
		expect(saved.status).toBe('received');
		expect(saved.received_at).toBeDefined();
		expect(saved.items).toEqual(startedDonation.items);
		expect(saved.point_receipts).toEqual([gymReceipt]);
		expect(saved.received_summary).toMatchObject({
			total_items: 2,
			closed_by: 'admin',
			closed_reason: 'staff_close',
			shortfalls: [{ item_id: 'item:paracetamol', declared: '10', counted: '0', short: '10' }],
			items: [
				{ item_id: 'item:water', qty: '24', unit: 'ขวด' },
				{ item_id: 'item:paracetamol', qty: '0', unit: 'แผง' }
			]
		});
		const audits = writtenAudits();
		expect(audits).toHaveLength(1);
		expect(audits[0]).toMatchObject({
			_id: await deriveDonationCloseAuditId('donation:123'),
			type: 'audit',
			target_id: 'donation:123',
			context: { closed_by: 'admin', closed_reason: 'staff_close', unrecorded_lines: [1] }
		});
		// No donor PII in the audit.
		expect(JSON.stringify(audits[0])).not.toContain('0812345678');
		expect(body.donation).toMatchObject({ status: 'received', rev: '4-closed' });
	});

	it('AC-18: closes as rejected when every recorded line was turned away and the rest never came', async () => {
		mockCouch({
			...startedDonation,
			point_receipts: [
				{
					...gymReceipt,
					ledger_ids: [],
					items: [
						{
							line_no: 0,
							item_id: 'item:water',
							qty: '0',
							unit: 'ขวด',
							rejected: true,
							reject_reason: 'ชำรุดเสียหาย',
							reject_reason_code: 'damaged'
						}
					]
				}
			]
		} as PublicDonationDoc);

		const response = await POST(postEvent());

		expect(response.status).toBe(200);
		expect(putBody()).toMatchObject({
			status: 'rejected',
			reject_reason: 'ชำรุดเสียหาย',
			reject_reason_code: 'damaged',
			received_summary: { closed_reason: 'staff_close' }
		});
		expect(putBody()?.received_at).toBeFalsy();
	});

	it('refuses to reject a booking whose status cannot be rejected', async () => {
		mockCouch({
			...startedDonation,
			status: 'declared',
			point_receipts: [
				{
					...gymReceipt,
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
			]
		} as PublicDonationDoc);

		const response = await POST(postEvent());

		expect(response.status).toBe(422);
		expect((await response.json()).error_code).toBe('INVALID_TRANSITION');
		expect(writtenAudits()).toHaveLength(0);
		expect(putBody()).toBeUndefined();
	});

	it('FR-MP-28: refuses a booking no point has recorded', async () => {
		mockCouch({ ...startedDonation, point_receipts: [] } as unknown as PublicDonationDoc);

		const response = await POST(postEvent());

		expect(response.status).toBe(422);
		expect((await response.json()).error_code).toBe('NO_POINT_RECEIPTS');
		expect(writtenAudits()).toHaveLength(0);
		expect(putBody()).toBeUndefined();
	});

	it.each(['received', 'rejected', 'expired', 'cancelled', 'redirected'])(
		'refuses a booking already %s',
		async (status) => {
			mockCouch({ ...startedDonation, status } as PublicDonationDoc);

			const response = await POST(postEvent());

			expect(response.status).toBe(422);
			expect((await response.json()).error_code).toBe('DONATION_CLOSED');
			expect(putBody()).toBeUndefined();
		}
	);

	it('answers 409 DONATION_CHANGED when the screen held an older copy', async () => {
		mockCouch(startedDonation);

		const response = await POST(postEvent({ expected_rev: '2-old' }));

		expect(response.status).toBe(409);
		expect((await response.json()).error_code).toBe('DONATION_CHANGED');
		expect(writtenAudits()).toHaveLength(0);
		expect(putBody()).toBeUndefined();
	});

	it('answers 422 when the body does not say which copy it closes', async () => {
		mockCouch(startedDonation);

		const response = await POST(postEvent({}));

		expect(response.status).toBe(422);
		expect(putBody()).toBeUndefined();
	});

	it('answers 409 DONATION_CONFLICT when the booking moved under the write', async () => {
		mockCouch(startedDonation, { putStatus: 409 });

		const response = await POST(postEvent());

		expect(response.status).toBe(409);
		expect((await response.json()).error_code).toBe('DONATION_CONFLICT');
	});

	it('keeps the same audit id on a retried close', async () => {
		mockCouch(startedDonation);
		await POST(postEvent());
		const first = writtenAudits()[0]._id;
		vi.mocked(adminRaw).mockClear();
		await POST(postEvent());

		expect(writtenAudits()[0]._id).toBe(first);
	});

	it('returns 403 when warehouse staff close another shelter donation', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'warehouse',
			roles: ['shelter:SH002', 'warehouse_staff'],
			isSA: false,
			shelterCode: 'SH002'
		});
		mockCouch(startedDonation);

		const response = await POST(postEvent());

		expect(response.status).toBe(403);
		expect(putBody()).toBeUndefined();
	});

	it('returns 403 for a signed-in user without a warehouse capability', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'volunteer',
			roles: ['shelter:SH001', 'volunteer'],
			isSA: false,
			shelterCode: 'SH001'
		});
		mockCouch(startedDonation);

		const response = await POST(postEvent());

		expect(response.status).toBe(403);
		expect(putBody()).toBeUndefined();
	});
});
