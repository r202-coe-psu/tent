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
		/** Ledger rows an earlier attempt already wrote, found by `_id`. */
		existingLedger?: StockLedger[];
		/** Per-doc `_bulk_docs` error for these `_id`s (the batch itself answers 201). */
		bulkErrors?: Record<string, string>;
		/** Shelter-local `item_master` docs in `shelter_sh001` (schema.md §4.2). */
		shelterItems?: unknown[];
	} = {}
) {
	vi.mocked(adminRaw).mockImplementation((path: string, method: string, body?: unknown) => {
		if (method === 'POST' && path.includes('/_all_docs')) {
			const keys = (body as { keys: string[] }).keys;
			return Promise.resolve({
				status: 200,
				data: {
					rows: keys.map((key) => {
						const doc = over.existingLedger?.find((l) => l._id === key);
						return doc ? { id: key, key, doc } : { key, error: 'not_found' };
					})
				}
			});
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
		if (method === 'GET' && path.includes('/shelter_sh001/') && path.includes('item_master:')) {
			const rows = (over.shelterItems ?? []).map((doc) => ({ doc }));
			return Promise.resolve({ status: 200, data: { rows } });
		}
		if (method === 'GET' && path.includes('donation:')) {
			return Promise.resolve({ status: 200, data: { rows: [{ doc: donation }] } });
		}
		// Lot-number allocation reads the day's existing labels (CR-088).
		if (method === 'POST' && path.includes('_find')) {
			return Promise.resolve({
				status: 200,
				data: { docs: (over.existingLotNos ?? []).map((lot_no) => ({ lot: { lot_no } })) }
			});
		}
		if (method === 'POST' && path.includes('_bulk_docs')) {
			const docs = (body as { docs: { _id: string }[] }).docs;
			return Promise.resolve({
				status: 201,
				data: docs.map(({ _id }) =>
					over.bulkErrors?.[_id]
						? { id: _id, error: over.bulkErrors[_id], reason: 'refused' }
						: { id: _id, ok: true, rev: '1-x' }
				)
			});
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

		// A shelter may keep its own item_master in `shelter_{code}` (schema.md §4.2). The
		// check read `catalog` only, so receiving a shelter-made item failed "Unknown item"
		// even though staff had picked it for the campaign.
		const shelterItem = (over: Record<string, unknown>) => ({
			type: 'item_master',
			shelter_code: 'SH001',
			conversions: [],
			type_class: 'CONSUMABLE',
			storage_type: 'DRY',
			...over
		});

		it('accepts an item_master that lives only in the shelter DB', async () => {
			mockCouch(baseDonation, {
				shelterItems: [
					shelterItem({ _id: 'item_master:local-soap', name: 'สบู่', base_unit: 'bar' })
				]
			});

			const response = await POST(
				postEvent({
					status: 'received',
					items: [{ item_id: 'item_master:local-soap', qty: '5', unit: 'bar' }]
				})
			);

			expect(response.status).toBe(200);
		});

		it("checks the unit against the shelter's copy, not the central one", async () => {
			const override = shelterItem({
				_id: 'item_master:flour',
				name: 'แป้ง',
				base_unit: 'bag',
				override: true
			});
			mockCouch(baseDonation, { shelterItems: [override] });

			const central = await POST(
				postEvent({
					status: 'received',
					items: [{ item_id: 'item_master:flour', qty: '2', unit: 'kg' }]
				})
			);
			expect(central.status).toBe(422);
			expect((await central.json()).error).toMatch(/expected bag, got kg/);

			vi.mocked(adminRaw).mockClear();
			mockCouch(baseDonation, { shelterItems: [override] });
			const local = await POST(
				postEvent({
					status: 'received',
					items: [{ item_id: 'item_master:flour', qty: '2', unit: 'bag' }]
				})
			);
			expect(local.status).toBe(200);
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
		});
	});

	/**
	 * CR-143 FR-B4a on the scan route: the ledger goes in before the donation PUT, so a
	 * 409 or a lost response there leaves rows in stock while the donation still looks
	 * outstanding. The retry staff are told to make must find those rows, not add more.
	 */
	describe('retry after a partial receive', () => {
		const rice = withItems([{ item_id: 'item:rice', qty: '10', unit: 'kg' }]);
		const riceBody = {
			status: 'received',
			items: [{ item_id: 'item:rice', qty: '10', unit: 'kg' }]
		};

		beforeEach(() => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'warehouse1',
				roles: ['warehouse_staff'],
				shelterCode: 'SH001',
				isSA: false
			});
		});

		/** Run one receive whose donation PUT conflicts; return the rows it wrote. */
		async function firstAttempt(): Promise<StockLedger[]> {
			mockCouch(rice, { putStatus: 409 });
			const response = await POST(postEvent(riceBody));
			expect(response.status).toBe(409);
			return appendedDocs().filter((d): d is StockLedger => d.type === 'stock_ledger');
		}

		it('derives the same ledger ids for the same donation lines', async () => {
			const first = await firstAttempt();
			vi.mocked(adminRaw).mockClear();
			const second = await firstAttempt();

			expect(second.map((l) => l._id)).toEqual(first.map((l) => l._id));
		});

		it('writes no second ledger row or audit entry, and finishes the donation', async () => {
			const written = await firstAttempt();
			vi.mocked(adminRaw).mockClear();
			mockCouch(rice, { existingLedger: written });

			const response = await POST(postEvent(riceBody));
			const body = await response.json();

			expect(response.status).toBe(200);
			expect(appendedDocs()).toHaveLength(0);
			expect(vi.mocked(adminRaw).mock.calls.find((c) => c[1] === 'PUT')).toBeDefined();
			// The boxes keep the label the first attempt gave them.
			expect(body.lots).toEqual([{ item_id: 'item:rice', lot_no: written[0].lot?.lot_no }]);
		});

		it('refuses a retry that changes a line already in the ledger', async () => {
			const written = await firstAttempt();
			vi.mocked(adminRaw).mockClear();
			mockCouch(rice, { existingLedger: written });

			const response = await POST(
				postEvent({ status: 'received', items: [{ item_id: 'item:rice', qty: '12', unit: 'kg' }] })
			);

			expect(response.status).toBe(409);
			expect((await response.json()).error_code).toBe('RECEIPT_CHANGED');
			expect(appendedDocs()).toHaveLength(0);
			expect(vi.mocked(adminRaw).mock.calls.find((c) => c[1] === 'PUT')).toBeUndefined();
		});

		it('does not touch the donation when CouchDB refuses a single row', async () => {
			const [row] = await firstAttempt();
			vi.mocked(adminRaw).mockClear();
			mockCouch(rice, { bulkErrors: { [row._id]: 'forbidden' } });

			const response = await POST(postEvent(riceBody));

			expect(response.status).toBe(500);
			expect(vi.mocked(adminRaw).mock.calls.find((c) => c[1] === 'PUT')).toBeUndefined();
		});

		it('treats a ledger row a concurrent receive wrote first as recorded', async () => {
			const [row] = await firstAttempt();
			vi.mocked(adminRaw).mockClear();
			mockCouch(rice, { bulkErrors: { [row._id]: 'conflict' } });

			const response = await POST(postEvent(riceBody));

			expect(response.status).toBe(200);
		});
	});
});
