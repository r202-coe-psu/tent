import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './+server';
import { adminRaw, requireShelterScopeOrSA } from '$lib/server/couch-admin';
import type { PublicDonationDoc } from '$lib/features/donations';
import {
	deriveDonationReceiptAuditId,
	deriveDonationReceiptLineId,
	type StockLedger
} from '$lib/features/operations/server';
import type { AuditEntry } from '$lib/features/shared';

type GetEvent = Parameters<typeof GET>[0];
type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	requireShelterScopeOrSA: vi.fn()
}));

type FindBody = { selector: { ref_id?: string } };

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
	},
	// CR-143 §D — item_master has no `perishable` flag; the rule is derived (FR-D1).
	{
		doc: {
			_id: 'item_master:yogurt',
			type: 'item_master',
			name: 'โยเกิร์ต',
			base_unit: 'cup',
			conversions: [],
			type_class: 'CONSUMABLE',
			storage_type: 'CHILLED'
		}
	},
	{
		doc: {
			_id: 'item_master:flour',
			type: 'item_master',
			name: 'แป้ง',
			base_unit: 'kg',
			conversions: [],
			type_class: 'CONSUMABLE',
			storage_type: 'DRY'
		}
	}
];

function mockCouch(
	donation: PublicDonationDoc,
	over: {
		putStatus?: number;
		existingLotNos?: string[];
		shelterItems?: object[];
		/** Rows already on the shelter's ledger, e.g. from an earlier attempt (#695). */
		ledgerRows?: StockLedger[];
		/** Per-doc answers of `_bulk_docs` (201 with refusals inside). */
		bulkOutcomes?: object[];
		/** The audit entry an earlier attempt at this receipt left (#695). */
		earlierAudit?: AuditEntry;
		/** Ledger rows of this booking another screen keyed under ids of its own. */
		keyedElsewhere?: string[];
	} = {}
) {
	vi.mocked(adminRaw).mockImplementation((path: string, method: string, body?: unknown) => {
		if (method === 'GET' && path.includes('audit')) {
			return Promise.resolve(
				over.earlierAudit
					? { status: 200, data: over.earlierAudit }
					: { status: 404, data: { error: 'not_found' } }
			);
		}
		if (method === 'POST' && path.includes('_all_docs')) {
			const keys = (body as { keys: string[] }).keys;
			const rows = keys.map((key) => {
				const doc = (over.ledgerRows ?? []).find((row) => row._id === key);
				return doc ? { key, id: key, doc } : { key, error: 'not_found' };
			});
			return Promise.resolve({ status: 200, data: { rows } });
		}
		// Items the shelter created itself live in its own DB, not in `catalog`.
		if (method === 'GET' && path.includes('/shelter_sh001/') && path.includes('item_master:')) {
			const rows = (over.shelterItems ?? []).map((doc) => ({ doc }));
			return Promise.resolve({ status: 200, data: { rows } });
		}
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
		if (method === 'POST' && path.includes('_find') && (body as FindBody).selector.ref_id) {
			const ids = [
				...(over.ledgerRows ?? []).map((row) => row._id),
				...(over.keyedElsewhere ?? [])
			];
			return Promise.resolve({ status: 200, data: { docs: ids.map((_id) => ({ _id })) } });
		}
		// Lot-number allocation reads the day's existing labels (CR-088).
		if (method === 'POST' && path.includes('_find')) {
			return Promise.resolve({
				status: 200,
				data: { docs: (over.existingLotNos ?? []).map((lot_no) => ({ lot: { lot_no } })) }
			});
		}
		if (method === 'POST' && path.includes('_bulk_docs')) {
			return Promise.resolve({ status: 201, data: over.bulkOutcomes ?? [{ ok: true }] });
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
	// Every receive is sent with the `_rev` the screen loaded (CR-174 FR-25); fixtures are `1-abc`.
	const sent =
		body && typeof body === 'object' && !('expected_rev' in body)
			? { expected_rev: '1-abc', ...body }
			: body;
	return {
		params: { query },
		request: { headers: { get: () => 'session-cookie' }, json: () => Promise.resolve(sent) }
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
				schema_v: 6, // 4 = CR-088 (lot_no / storage_zone); 5 = draft-shelter-storage-points (storage_point_id); 6 = CR-143 §C (adjust_reason)
				shelter_code: 'SH001',
				created_by: 'admin'
			});
			expect(ledgers[0]._id.startsWith('stock_ledger:')).toBe(true);
		});

		// CR-088 — the lot label is minted server-side, one per counted catalog line.
		it('mints a lot_no per counted line, continuing the shelter day sequence', async () => {
			mockCouch(
				withItems([
					{ item_id: 'item:rice', qty: '10', unit: 'kg' },
					{ item_id: 'item:milk', qty: '2', unit: 'ลัง' }
				]),
				{ existingLotNos: ['L-260825-004'] }
			);

			const response = await POST(
				postEvent({
					status: 'received',
					items: [
						{ item_id: 'item:rice', qty: '10', unit: 'kg' },
						{ item_id: 'item:milk', qty: '2', unit: 'ลัง', lot: { expiry: '2026-12-01' } }
					]
				})
			);
			expect(response.status).toBe(200);

			const ledgers = appendedDocs().filter((d): d is StockLedger => d.type === 'stock_ledger');
			expect(ledgers).toHaveLength(2);
			const lots = ledgers.map((l) => l.lot?.lot_no);
			expect(lots.every((l) => /^L-\d{6}-\d{3}$/.test(l ?? ''))).toBe(true);
			expect(new Set(lots).size).toBe(2); // never the same label twice in one receipt

			// Handed back so staff can label the physical boxes.
			const body = await response.json();
			expect(body.lots).toEqual([
				{ item_id: 'item:rice', lot_no: lots[0] },
				{ item_id: 'item:milk', lot_no: lots[1] }
			]);
		});

		it('keeps the storage_zone staff typed and ignores a client-sent lot_no', async () => {
			mockCouch(withItems([{ item_id: 'item:rice', qty: '10', unit: 'kg' }]));

			await POST(
				postEvent({
					status: 'received',
					items: [
						{
							item_id: 'item:rice',
							qty: '10',
							unit: 'kg',
							lot: { storage_zone: 'A-01', lot_no: 'L-990101-999' }
						}
					]
				})
			);

			const ledger = appendedDocs().find((d): d is StockLedger => d.type === 'stock_ledger');
			expect(ledger?.lot?.storage_zone).toBe('A-01');
			expect(ledger?.lot?.lot_no).not.toBe('L-990101-999');
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

		it('receives an item the shelter created in its own catalog', async () => {
			const sweetPotato = {
				_id: 'item_master:sweet-potato',
				type: 'item_master',
				name: 'หัวมัน',
				base_unit: 'piece',
				shelter_code: 'SH001',
				storage_type: 'DRY'
			};
			mockCouch(withItems([{ free_text: 'หัวมัน', qty: '5', unit: 'piece' }]), {
				shelterItems: [sweetPotato]
			});

			const response = await POST(
				postEvent({
					status: 'received',
					items: [{ item_id: 'item_master:sweet-potato', qty: '5', unit: 'piece' }]
				})
			);

			expect(response.status).toBe(200);
			const ledgers = appendedDocs().filter((d): d is StockLedger => d.type === 'stock_ledger');
			expect(ledgers).toHaveLength(1);
			expect(ledgers[0]).toMatchObject({ item_id: 'item_master:sweet-potato', unit: 'piece' });
		});

		it('checks the unit against the shelter copy of a central item', async () => {
			const flour = catalogRows.find((r) => r.doc._id === 'item_master:flour')!.doc;
			const localFlour = { ...flour, base_unit: 'bag' };
			mockCouch(withItems([{ item_id: 'item_master:flour', qty: '2', unit: 'bag' }]), {
				shelterItems: [localFlour]
			});

			const response = await POST(
				postEvent({
					status: 'received',
					items: [{ item_id: 'item_master:flour', qty: '2', unit: 'bag' }]
				})
			);

			expect(response.status).toBe(200);
		});

		it('rejects a perishable item received without lot.expiry', async () => {
			mockCouch(baseDonation);

			const response = await POST(
				postEvent({ status: 'received', items: [{ item_id: 'item:milk', qty: '2', unit: 'ลัง' }] })
			);

			expect(response.status).toBe(422);
			expect((await response.json()).error).toMatch(/requires lot.expiry/);
		});

		it('AC-D1: rejects a CHILLED item_master received without lot.expiry', async () => {
			mockCouch(baseDonation);

			const response = await POST(
				postEvent({
					status: 'received',
					items: [{ item_id: 'item_master:yogurt', qty: '2', unit: 'cup' }]
				})
			);

			expect(response.status).toBe(422);
			expect((await response.json()).error).toMatch(/requires lot.expiry/);
		});

		it('AC-D2: accepts a DRY item_master with no shelf life and no lot.expiry', async () => {
			mockCouch(baseDonation);

			const response = await POST(
				postEvent({
					status: 'received',
					items: [{ item_id: 'item_master:flour', qty: '2', unit: 'kg' }]
				})
			);

			expect(response.status).toBe(200);
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

		/**
		 * Every terminal status, not just `received`. The nightly TTL job flips any
		 * booking still awaiting drop-off — `verifying` included — so a delivery being
		 * counted at midnight can lapse mid-count; and a redirected donation is being
		 * held by the destination shelter on its own ticket. Receiving either would put
		 * one delivery on two shelves, or on a shelf the audit trail says it never
		 * reached.
		 */
		it.each(['rejected', 'redirected', 'expired', 'cancelled'] as const)(
			'POST refuses to receive a %s donation — no ledger, no audit',
			async (status) => {
				mockCouch({ ...baseDonation, status } as PublicDonationDoc);

				const response = await POST(postEvent({ status: 'received' }));
				const body = await response.json();

				expect(response.status).toBe(400);
				expect(body.error_code).toBe('DONATION_CLOSED');
				expect(appendedDocs()).toHaveLength(0);
			}
		);

		// The scan station is a data-entry shortcut, not a review shortcut: a booking
		// nobody has decided on yet is still receivable at the counter (the owner's
		// call — staff verify by counting, not by an intermediate doc status).
		it('POST still receives a booking that has not been decided yet', async () => {
			mockCouch({
				...withItems([{ item_id: 'item:rice', qty: '10', unit: 'kg' }]),
				status: 'pending_review'
			} as PublicDonationDoc);

			const response = await POST(postEvent({ status: 'received' }));

			expect(response.status).toBe(200);
			expect(appendedDocs().filter((d) => d.type === 'stock_ledger').length).toBeGreaterThan(0);
		});

		it('POST returns 409 on CouchDB conflict', async () => {
			mockCouch(baseDonation, { putStatus: 409 });

			const response = await POST(postEvent({ status: 'received' }));

			expect(response.status).toBe(409);
			expect((await response.json()).error_code).toBe('DONATION_CONFLICT');
		});
	});

	describe('booking changed while it was being counted (CR-174 FR-25)', () => {
		it('AC-13: answers 409 before keying anything when the _rev moved on', async () => {
			mockCouch(withItems([{ item_id: 'item:rice', qty: '10', unit: 'kg' }]));

			const response = await POST(
				postEvent({
					status: 'received',
					expected_rev: '0-stale',
					items: [{ item_id: 'item:rice', qty: '10', unit: 'kg' }]
				})
			);

			expect(response.status).toBe(409);
			expect((await response.json()).error_code).toBe('DONATION_CHANGED');
			expect(appendedDocs()).toHaveLength(0);
			expect(vi.mocked(adminRaw).mock.calls.some((c) => c[1] === 'PUT')).toBe(false);
		});

		it('refuses a receive that does not say which version it counted', async () => {
			mockCouch(baseDonation);

			const response = await POST(postEvent({ status: 'received', expected_rev: undefined }));

			expect(response.status).toBe(422);
		});

		it('hands the _rev to the scan screen', async () => {
			mockCouch(baseDonation);

			const response = await GET({
				params: { query: 'DN-999999' },
				request: { headers: { get: () => 'session-cookie' } }
			} as unknown as GetEvent);

			expect((await response.json()).donation.rev).toBe('1-abc');
		});
	});

	describe('turning lines away at the counter (CR-172)', () => {
		const twoLines = {
			...withItems([
				{ item_id: 'item:rice', qty: '10', unit: 'kg' },
				{ item_id: 'item:milk', qty: '2', unit: 'ลัง' }
			]),
			status: 'verifying'
		} as PublicDonationDoc;
		const rice = { item_id: 'item:rice', qty: '10', unit: 'kg' };
		const milkRejected = {
			item_id: 'item:milk',
			qty: '0',
			unit: 'ลัง',
			rejected: true,
			reject_reason_code: 'expired',
			reject_note: 'หมดอายุเมื่อวาน'
		};

		function savedDoc(): PublicDonationDoc {
			const putCall = vi.mocked(adminRaw).mock.calls.find((c) => c[1] === 'PUT');
			return putCall![2] as PublicDonationDoc;
		}

		it('AC-2: receives the kept line and records the other with its reason', async () => {
			mockCouch(twoLines);

			const response = await POST(postEvent({ status: 'received', items: [rice, milkRejected] }));

			expect(response.status).toBe(200);
			const ledgers = appendedDocs().filter((d): d is StockLedger => d.type === 'stock_ledger');
			expect(ledgers.map((l) => l.item_id)).toEqual(['item:rice']);
			const doc = savedDoc();
			expect(doc.status).toBe('received');
			expect(doc.reject_reason).toBeUndefined();
			expect(doc.received_summary?.items?.[1]).toMatchObject({
				item_id: 'item:milk',
				qty: '0',
				rejected: true,
				reject_reason_code: 'expired',
				reject_reason: 'หมดอายุ — หมดอายุเมื่อวาน'
			});
			expect(doc.received_summary?.items?.[0]).not.toHaveProperty('rejected');
		});

		// The counter matches a typed-in line to a stock item; the donor's words are not the
		// item id, and comparing by them recorded the whole line as short (W-R5-1).
		it('compares a typed-in line under the item it was matched to', async () => {
			mockCouch({
				...withItems([{ free_text: 'ข้าวหอม', qty: '10', unit: 'kg' }]),
				status: 'verifying'
			} as PublicDonationDoc);

			await POST(
				postEvent({ status: 'received', items: [{ item_id: 'item:rice', qty: '10', unit: 'kg' }] })
			);

			expect(savedDoc().received_summary?.shortfalls).toEqual([]);
		});

		it('still reports a matched typed-in line counted short', async () => {
			mockCouch({
				...withItems([{ free_text: 'ข้าวหอม', qty: '10', unit: 'kg' }]),
				status: 'verifying'
			} as PublicDonationDoc);

			await POST(
				postEvent({ status: 'received', items: [{ item_id: 'item:rice', qty: '7', unit: 'kg' }] })
			);

			expect(savedDoc().received_summary?.shortfalls).toEqual([
				{ item_id: 'item:rice', declared: '10', counted: '7', short: '3' }
			]);
		});

		it('AC-6: a rejected line is not reported as a shortfall', async () => {
			mockCouch(twoLines);

			await POST(postEvent({ status: 'received', items: [rice, milkRejected] }));

			expect(savedDoc().received_summary?.shortfalls).toEqual([]);
		});

		it('keeps the line numbering, so a kept line after a rejected one keys the same row', async () => {
			mockCouch(twoLines);

			await POST(
				postEvent({
					status: 'received',
					items: [{ ...milkRejected, item_id: 'item:rice', unit: 'kg' }, rice]
				})
			);

			const ledgers = appendedDocs().filter((d): d is StockLedger => d.type === 'stock_ledger');
			expect(ledgers.map((l) => l._id)).toEqual([
				await deriveDonationReceiptLineId('donation:123', 'item:rice', 1)
			]);
		});

		it('AC-3: rejecting every line rejects the booking with every reason, and keys nothing', async () => {
			mockCouch(twoLines);

			const response = await POST(
				postEvent({
					status: 'received',
					items: [
						{ ...rice, qty: '0', rejected: true, reject_reason_code: 'damaged' },
						milkRejected
					]
				})
			);

			expect(response.status).toBe(200);
			expect((await response.json()).lots).toEqual([]);
			expect(appendedDocs().filter((d) => d.type === 'stock_ledger')).toHaveLength(0);
			const doc = savedDoc();
			expect(doc).toMatchObject({
				status: 'rejected',
				reject_reason: 'ชำรุดเสียหาย; หมดอายุ — หมดอายุเมื่อวาน',
				reject_reason_code: 'other'
			});
			expect(doc.received_at).toBeFalsy();
			expect(doc.received_summary?.items?.every((line) => line.rejected)).toBe(true);
		});

		it('CR-174 FR-12: rejecting every line at the counter rejects every reviewed line too', async () => {
			mockCouch({
				...twoLines,
				items: [
					{ item_id: 'item:rice', qty: '10', unit: 'kg', review_status: 'approved' },
					{ item_id: 'item:milk', qty: '2', unit: 'ลัง', review_status: 'approved' }
				]
			} as unknown as PublicDonationDoc);

			await POST(
				postEvent({
					status: 'received',
					items: [
						{ ...rice, qty: '0', rejected: true, reject_reason_code: 'damaged' },
						milkRejected
					]
				})
			);

			expect(savedDoc().items?.map((i) => i.review_status)).toEqual(['rejected', 'rejected']);
		});

		it('refuses to reject every line of a booking that cannot be rejected', async () => {
			mockCouch({ ...twoLines, status: 'declared' } as PublicDonationDoc);

			const response = await POST(
				postEvent({
					status: 'received',
					items: [
						{ ...rice, qty: '0', rejected: true, reject_reason_code: 'damaged' },
						milkRejected
					]
				})
			);

			expect(response.status).toBe(422);
			expect(appendedDocs()).toHaveLength(0);
		});

		it.each([
			['no reason code', { ...milkRejected, reject_reason_code: undefined }],
			[
				'"other" with no detail',
				{ ...milkRejected, reject_reason_code: 'other', reject_note: ' ' }
			],
			['a kept line counted at 0', { ...rice, qty: '0' }]
		])('AC-4: answers 422 for %s, writing nothing', async (_label, line) => {
			mockCouch(twoLines);

			const response = await POST(postEvent({ status: 'received', items: [rice, line] }));

			expect(response.status).toBe(422);
			expect(appendedDocs()).toHaveLength(0);
		});
	});

	/**
	 * #695 — the ledger is written before the donation is marked received. When that PUT
	 * loses a 409 the rows stay (append-only) and staff press receive again: the retry
	 * has to find those rows instead of keying the goods into stock a second time.
	 */
	describe('retry after a lost donation write (#695)', () => {
		const riceDonation = withItems([
			{ free_text: 'ของแห้ง', qty: '1', unit: 'kg' },
			{ item_id: 'item:rice', qty: '10', unit: 'kg' }
		]);
		const counted = {
			status: 'received',
			items: [
				{ free_text: 'ของแห้ง', qty: '1', unit: 'kg' },
				{ item_id: 'item:rice', qty: '10', unit: 'kg' }
			]
		};

		/** Receive once with the donation PUT conflicting; returns the rows that landed. */
		async function firstAttemptLostThePut(): Promise<StockLedger[]> {
			mockCouch(riceDonation, { putStatus: 409, existingLotNos: [] });
			const first = await POST(postEvent(counted));
			expect(first.status).toBe(409);
			const rows = appendedDocs().filter((d): d is StockLedger => d.type === 'stock_ledger');
			vi.mocked(adminRaw).mockReset();
			return rows;
		}

		it('keys the row under the id the batch receive page uses for the same line', async () => {
			const rows = await firstAttemptLostThePut();

			// Line 1, not 0: the free-text line ahead of it keeps its place in the numbering.
			expect(rows.map((r) => r._id)).toEqual([
				await deriveDonationReceiptLineId('donation:123', 'item:rice', 1)
			]);
		});

		it('writes no second row and closes the donation on the retry', async () => {
			const rows = await firstAttemptLostThePut();
			mockCouch(riceDonation, { ledgerRows: rows, existingLotNos: ['L-RECORDED'] });

			const retry = await POST(postEvent(counted));
			const body = await retry.json();

			expect(retry.status).toBe(200);
			expect(appendedDocs().filter((d) => d.type === 'stock_ledger')).toHaveLength(0);
			const putCall = vi.mocked(adminRaw).mock.calls.find((c) => c[1] === 'PUT');
			expect((putCall![2] as PublicDonationDoc).status).toBe('received');
			// The boxes keep the label they were given the first time.
			expect(body.lots).toEqual([{ item_id: 'item:rice', lot_no: rows[0].lot?.lot_no }]);
		});

		it('logs the receipt once — the retry re-sends the same audit entry', async () => {
			mockCouch(riceDonation, { putStatus: 409 });
			await POST(postEvent(counted));
			const firstAudit = appendedDocs().find((d) => d.type === 'audit');
			vi.mocked(adminRaw).mockReset();
			mockCouch(riceDonation);
			await POST(postEvent(counted));
			const retryAudit = appendedDocs().find((d) => d.type === 'audit');

			expect(retryAudit?._id).toBe(firstAudit?._id);
			expect(firstAudit?._id).toBe(await deriveDonationReceiptAuditId('donation:123'));
		});

		it('refuses a retry that counts a recorded line differently, writing nothing', async () => {
			const rows = await firstAttemptLostThePut();
			mockCouch(riceDonation, { ledgerRows: rows });

			const retry = await POST(
				postEvent({
					status: 'received',
					items: [counted.items[0], { item_id: 'item:rice', qty: '12', unit: 'kg' }]
				})
			);

			expect(retry.status).toBe(409);
			expect((await retry.json()).error_code).toBe('RECEIPT_MISMATCH');
			expect(appendedDocs()).toHaveLength(0);
			expect(vi.mocked(adminRaw).mock.calls.some((c) => c[1] === 'PUT')).toBe(false);
		});

		/** First attempt keyed the rice line and lost its PUT; returns its rows and audit. */
		async function firstAttemptLeftItsAudit() {
			mockCouch(riceDonation, { putStatus: 500 });
			await POST(postEvent(counted));
			const docs = appendedDocs();
			vi.mocked(adminRaw).mockReset();
			return {
				rows: docs.filter((d): d is StockLedger => d.type === 'stock_ledger'),
				audit: docs.find((d): d is AuditEntry => d.type === 'audit')!
			};
		}

		it('refuses a retry that turns away a line the first attempt keyed', async () => {
			const { rows, audit } = await firstAttemptLeftItsAudit();
			mockCouch(riceDonation, { ledgerRows: rows, earlierAudit: audit });

			const retry = await POST(
				postEvent({
					status: 'received',
					items: [
						counted.items[0],
						{ ...counted.items[1], qty: '0', rejected: true, reject_reason_code: 'damaged' }
					]
				})
			);

			expect(retry.status).toBe(409);
			expect((await retry.json()).error_code).toBe('RECEIPT_MISMATCH');
			expect(appendedDocs()).toHaveLength(0);
			expect(vi.mocked(adminRaw).mock.calls.some((c) => c[1] === 'PUT')).toBe(false);
		});

		it('refuses a retry that maps the keyed line to another item', async () => {
			const { rows, audit } = await firstAttemptLeftItsAudit();
			mockCouch(riceDonation, { ledgerRows: rows, earlierAudit: audit });

			const retry = await POST(
				postEvent({
					status: 'received',
					items: [counted.items[0], { item_id: 'item_master:flour', qty: '10', unit: 'kg' }]
				})
			);

			expect(retry.status).toBe(409);
			expect(appendedDocs()).toHaveLength(0);
		});

		it('still closes the receipt when the retry repeats the first attempt', async () => {
			const { rows, audit } = await firstAttemptLeftItsAudit();
			mockCouch(riceDonation, { ledgerRows: rows, earlierAudit: audit });

			const retry = await POST(postEvent(counted));

			expect(retry.status).toBe(200);
			expect(appendedDocs().filter((d) => d.type === 'stock_ledger')).toHaveLength(0);
		});

		it('refuses to key a line the batch receive page already keyed as another item', async () => {
			mockCouch(riceDonation, {
				keyedElsewhere: [await deriveDonationReceiptLineId('donation:123', 'item_master:flour', 1)]
			});

			const response = await POST(postEvent(counted));

			expect(response.status).toBe(409);
			expect((await response.json()).error_code).toBe('RECEIPT_MISMATCH');
			expect(appendedDocs()).toHaveLength(0);
			expect(vi.mocked(adminRaw).mock.calls.some((c) => c[1] === 'PUT')).toBe(false);
		});

		it('accepts a row a concurrent receive wrote first when it records the same line', async () => {
			const rows = await firstAttemptLostThePut();
			let ledgerReads = 0;
			mockCouch(riceDonation, {
				// The concurrent receive took the day's next label — a fresh one would differ.
				existingLotNos: [rows[0].lot?.lot_no ?? ''],
				bulkOutcomes: [{ id: rows[0]._id, error: 'conflict', reason: 'Document update conflict.' }]
			});
			const base = vi.mocked(adminRaw).getMockImplementation()!;
			// Not there on the first read, there once `_bulk_docs` reports the conflict.
			vi.mocked(adminRaw).mockImplementation((path, method, body) => {
				if (method === 'POST' && path.includes('_all_docs')) {
					ledgerReads += 1;
					const rowsNow = ledgerReads === 1 ? [] : rows;
					const keys = (body as { keys: string[] }).keys;
					return Promise.resolve({
						status: 200,
						data: {
							rows: keys.map((key) => {
								const doc = rowsNow.find((r) => r._id === key);
								return doc ? { key, doc } : { key, error: 'not_found' };
							})
						}
					});
				}
				return base(path, method, body);
			});

			const response = await POST(postEvent(counted));

			expect(response.status).toBe(200);
			expect((await response.json()).lots).toEqual([
				{ item_id: 'item:rice', lot_no: rows[0].lot?.lot_no }
			]);
		});
	});
});
