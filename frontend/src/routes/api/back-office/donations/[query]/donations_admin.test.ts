import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './+server';
import { adminRaw, requireShelterScopeOrSA } from '$lib/server/couch-admin';
import type { PublicDonationDoc } from '$lib/features/donations';
import type { StockLedger } from '$lib/features/operations/server';
import type { AuditEntry } from '$lib/features/shared';

type GetEvent = Parameters<typeof GET>[0];
type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	requireShelterScopeOrSA: vi.fn()
}));

/** Catalog items the intake route validates counted lines against (schema.md §2.1). */
const catalogRows = [
	{
		doc: {
			_id: 'item:rice',
			type: 'supply_item',
			name: 'ข้าวสาร',
			category: 'food',
			unit: 'kg',
			reorder_level: null,
			perishable: false
		}
	},
	{
		doc: {
			_id: 'item:milk',
			type: 'supply_item',
			name: 'นมสด',
			category: 'food',
			unit: 'ลัง',
			reorder_level: null,
			perishable: true
		}
	}
];

function mockCouch(donation: PublicDonationDoc, over: { putStatus?: number } = {}) {
	vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
		if (method === 'GET' && path.includes('/registry/')) {
			return Promise.resolve({
				status: 200,
				data: { rows: [{ id: 'shelter:SH001', doc: { code: 'SH001' } }] }
			});
		}
		if (method === 'GET' && path.includes('/catalog/')) {
			return Promise.resolve({ status: 200, data: { rows: catalogRows } });
		}
		if (method === 'GET' && path.includes('donation:')) {
			return Promise.resolve({ status: 200, data: { rows: [{ doc: donation }] } });
		}
		if (method === 'POST' && path.includes('_bulk_docs')) {
			return Promise.resolve({ status: 201, data: [{ ok: true }] });
		}
		if (method === 'PUT' && path.includes('/shelter_sh001/')) {
			return Promise.resolve({ status: over.putStatus ?? 201, data: { ok: true } });
		}
		return Promise.resolve({ status: 404, data: {} });
	});
}

/** Docs handed to `_bulk_docs` — the ledger + audit append batch. */
function appendedDocs(): Array<StockLedger | AuditEntry> {
	const call = vi.mocked(adminRaw).mock.calls.find((c) => String(c[0]).includes('_bulk_docs'));
	if (!call) return [];
	return (call[2] as { docs: Array<StockLedger | AuditEntry> }).docs;
}

function postEvent(body: unknown, query = 'DN-999999'): PostEvent {
	return {
		params: { query },
		request: { headers: { get: () => 'session-cookie' }, json: () => Promise.resolve(body) }
	} as unknown as PostEvent;
}

const baseDonation = {
	_id: 'donation:123',
	_rev: '1-abc',
	type: 'donation',
	schema_v: 3,
	status: 'declared',
	shelter_code: 'SH001',
	booking_ref: 'DN-999999',
	tracking_token_hash: 'secret-hash',
	donor: { name: 'John Donor', phone: '0812345678', email: 'john@donor.com' },
	items: [{ free_text: 'ข้าวสาร', qty: '10', unit: 'kg' }],
	logistics: { delivery_method: 'parcel', courier_tracking_no: null }
} as unknown as PublicDonationDoc;

const withItems = (items: unknown[]) =>
	({ ...baseDonation, items }) as unknown as PublicDonationDoc;

describe('Back-office GET & POST /api/back-office/donations/[query]', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'admin',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
	});

	it('GET returns donation details including donor PII for admin staff', async () => {
		mockCouch(baseDonation);

		const response = await GET({
			params: { query: 'DN-999999' },
			request: { headers: { get: () => 'session-cookie' } }
		} as unknown as GetEvent);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(data.donation.booking_ref).toBe('DN-999999');
		expect(data.donation.donor.name).toBe('John Donor');
		expect(data.donation.donor.phone).toBe('0812345678');
		expect(data.donation).not.toHaveProperty('tracking_token_hash');
		expect(data.donation).not.toHaveProperty('_id');
	});

	it('GET returns 403 when warehouse staff queries another shelter donation', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'warehouse',
			roles: ['shelter:SH002', 'warehouse_staff'],
			isSA: false,
			shelterCode: 'SH002'
		});
		mockCouch(baseDonation);

		const response = await GET({
			params: { query: 'DN-999999' },
			request: { headers: { get: () => 'session-cookie' } }
		} as unknown as GetEvent);

		const data = await response.json();
		expect(response.status).toBe(403);
		expect(data.error).toBe('Forbidden');
	});

	it('POST marks the donation received without overwriting the declared items', async () => {
		mockCouch(baseDonation);

		const response = await POST(
			postEvent({ status: 'received', items: [{ free_text: 'ข้าวสาร', qty: 9, unit: 'kg' }] })
		);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(data.donation.status).toBe('received');

		const putCall = vi.mocked(adminRaw).mock.calls.find((c) => c[1] === 'PUT');
		const savedDoc = putCall![2] as PublicDonationDoc;
		expect(savedDoc.status).toBe('received');
		expect(savedDoc.received_at).toBeDefined();
		// `items` stays what the donor DECLARED — the projector mirrors it as
		// `items_declared` on the public tracking page.
		expect(savedDoc.items).toEqual(baseDonation.items);
		expect(savedDoc.received_summary).toMatchObject({ total_items: 1 });
		expect(savedDoc.received_summary?.received_at).toBeDefined();
	});

	it('POST stores the receiving remark on received_summary', async () => {
		mockCouch(baseDonation);

		await POST(postEvent({ status: 'received', remarks: 'ของมาไม่ครบ' }));

		const putCall = vi.mocked(adminRaw).mock.calls.find((c) => c[1] === 'PUT');
		expect((putCall![2] as PublicDonationDoc).received_summary?.remarks).toBe('ของมาไม่ครบ');
	});

	describe('stock ledger (T-16-2.1)', () => {
		it('writes one positive donation ledger entry per counted catalog item', async () => {
			mockCouch(withItems([{ item_id: 'item:rice', qty: '10', unit: 'kg' }]));

			const response = await POST(
				postEvent({ status: 'received', items: [{ item_id: 'item:rice', qty: '8.5', unit: 'kg' }] })
			);
			expect(response.status).toBe(200);

			const ledgers = appendedDocs().filter((d): d is StockLedger => d.type === 'stock_ledger');
			expect(ledgers).toHaveLength(1);
			expect(ledgers[0]).toMatchObject({
				item_id: 'item:rice',
				qty: '8.5', // qty_str — never a JSON number (CR-038)
				unit: 'kg',
				reason: 'donation',
				ref_id: 'donation:123',
				schema_v: 3, // stock_ledger bumped 2 → 3 when `purchase` joined the reason enum (CR-032)
				shelter_code: 'SH001',
				created_by: 'admin'
			});
			expect(ledgers[0]._id.startsWith('stock_ledger:')).toBe(true);
		});

		it('never writes a ledger entry for a free-text line', async () => {
			mockCouch(baseDonation);

			await POST(
				postEvent({
					status: 'received',
					items: [{ free_text: 'ของใช้เบ็ดเตล็ด', qty: '3', unit: 'ชิ้น' }]
				})
			);

			expect(appendedDocs().filter((d) => d.type === 'stock_ledger')).toHaveLength(0);
		});

		it('rejects a counted unit that does not match the catalog base unit', async () => {
			mockCouch(withItems([{ item_id: 'item:rice', qty: '10', unit: 'kg' }]));

			const response = await POST(
				postEvent({ status: 'received', items: [{ item_id: 'item:rice', qty: '10', unit: 'ถุง' }] })
			);

			expect(response.status).toBe(422);
			expect((await response.json()).error).toMatch(/Unit mismatch/);
			expect(appendedDocs()).toHaveLength(0);
		});

		it('rejects an item that is not in the catalog', async () => {
			mockCouch(baseDonation);

			const response = await POST(
				postEvent({ status: 'received', items: [{ item_id: 'item:ghost', qty: '1', unit: 'kg' }] })
			);

			expect(response.status).toBe(422);
			expect((await response.json()).error).toMatch(/Unknown item/);
		});

		it('rejects a perishable item received without lot.expiry', async () => {
			mockCouch(baseDonation);

			const response = await POST(
				postEvent({ status: 'received', items: [{ item_id: 'item:milk', qty: '2', unit: 'ลัง' }] })
			);

			expect(response.status).toBe(422);
			expect((await response.json()).error).toMatch(/requires lot.expiry/);
		});

		it('accepts a perishable item when lot.expiry is supplied', async () => {
			mockCouch(baseDonation);

			const response = await POST(
				postEvent({
					status: 'received',
					items: [
						{
							item_id: 'item:milk',
							qty: '2',
							unit: 'ลัง',
							lot: { expiry: '2026-09-01T00:00:00.000Z' }
						}
					]
				})
			);

			expect(response.status).toBe(200);
			const ledgers = appendedDocs().filter((d): d is StockLedger => d.type === 'stock_ledger');
			expect(ledgers[0].lot?.expiry).toBe('2026-09-01T00:00:00.000Z');
		});

		it('does not touch the donation when the ledger append fails', async () => {
			mockCouch(withItems([{ item_id: 'item:rice', qty: '10', unit: 'kg' }]));
			vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
				if (method === 'GET' && path.includes('/registry/')) {
					return Promise.resolve({
						status: 200,
						data: { rows: [{ id: 'shelter:SH001', doc: { code: 'SH001' } }] }
					});
				}
				if (method === 'GET' && path.includes('/catalog/')) {
					return Promise.resolve({ status: 200, data: { rows: catalogRows } });
				}
				if (method === 'GET' && path.includes('donation:')) {
					return Promise.resolve({
						status: 200,
						data: { rows: [{ doc: withItems([{ item_id: 'item:rice', qty: '10', unit: 'kg' }]) }] }
					});
				}
				if (method === 'POST' && path.includes('_bulk_docs')) {
					return Promise.resolve({ status: 500, data: { error: 'boom' } });
				}
				return Promise.resolve({ status: 404, data: {} });
			});

			const response = await POST(
				postEvent({ status: 'received', items: [{ item_id: 'item:rice', qty: '10', unit: 'kg' }] })
			);

			expect(response.status).toBe(500);
			expect(vi.mocked(adminRaw).mock.calls.find((c) => c[1] === 'PUT')).toBeUndefined();
		});
	});

	describe('audit trail (T-16-3.2)', () => {
		it('writes one audit entry naming the receiver, the booking and declared vs actual', async () => {
			mockCouch(withItems([{ item_id: 'item:rice', qty: '10', unit: 'kg' }]));

			await POST(
				postEvent({ status: 'received', items: [{ item_id: 'item:rice', qty: '8', unit: 'kg' }] })
			);

			const audits = appendedDocs().filter((d): d is AuditEntry => d.type === 'audit');
			expect(audits).toHaveLength(1);
			const audit = audits[0];
			expect(audit).toMatchObject({
				action: 'manual_adjust',
				target_type: 'donation',
				target_id: 'donation:123',
				schema_v: 1,
				created_by: 'admin'
			});
			expect(audit.context).toMatchObject({
				booking_ref: 'DN-999999',
				received_by: 'admin',
				has_discrepancy: true,
				declared_items: [{ item_id: 'item:rice', qty: '10', unit: 'kg' }],
				received_items: [{ item_id: 'item:rice', qty: '8', unit: 'kg' }]
			});
			expect((audit.context as { ledger_ids: string[] }).ledger_ids).toHaveLength(1);
		});

		it('flags no discrepancy when the counted lines match the declaration', async () => {
			mockCouch(withItems([{ item_id: 'item:rice', qty: '10', unit: 'kg' }]));

			await POST(
				postEvent({ status: 'received', items: [{ item_id: 'item:rice', qty: '10', unit: 'kg' }] })
			);

			const audit = appendedDocs().find((d): d is AuditEntry => d.type === 'audit');
			expect(audit!.context).toMatchObject({ has_discrepancy: false });
		});

		it('keeps donor PII out of the audit context', async () => {
			mockCouch(baseDonation);

			await POST(postEvent({ status: 'received' }));

			const audit = appendedDocs().find((d): d is AuditEntry => d.type === 'audit');
			const serialized = JSON.stringify(audit);
			expect(serialized).not.toContain('0812345678');
			expect(serialized).not.toContain('secret-hash');
			expect(serialized).not.toContain('john@donor.com');
		});
	});

	describe('authorization and idempotency', () => {
		it('POST returns 403 when warehouse staff receives another shelter donation', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'warehouse',
				roles: ['shelter:SH002', 'warehouse_staff'],
				isSA: false,
				shelterCode: 'SH002'
			});
			mockCouch(baseDonation);

			const response = await POST(postEvent({ status: 'received' }));

			expect(response.status).toBe(403);
			expect(appendedDocs()).toHaveLength(0);
		});

		it('POST returns 403 for a signed-in user without a warehouse capability', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'reg',
				roles: ['shelter:SH001', 'registration_staff'],
				isSA: false,
				shelterCode: 'SH001'
			});
			mockCouch(baseDonation);

			const response = await POST(postEvent({ status: 'received' }));

			expect(response.status).toBe(403);
			expect(appendedDocs()).toHaveLength(0);
		});

		it('POST returns 422 when body status is not received', async () => {
			mockCouch(baseDonation);

			const response = await POST(postEvent({ status: 'cancelled' }));

			expect(response.status).toBe(422);
		});

		it('POST refuses to receive the same donation twice — no duplicate ledger', async () => {
			mockCouch({ ...baseDonation, status: 'received' } as PublicDonationDoc);

			const response = await POST(postEvent({ status: 'received' }));

			expect(response.status).toBe(400);
			expect((await response.json()).error).toMatch(/already received/i);
			expect(appendedDocs()).toHaveLength(0);
		});

		it('POST returns 409 on CouchDB conflict', async () => {
			mockCouch(baseDonation, { putStatus: 409 });

			const response = await POST(postEvent({ status: 'received' }));

			expect(response.status).toBe(409);
		});
	});
});
