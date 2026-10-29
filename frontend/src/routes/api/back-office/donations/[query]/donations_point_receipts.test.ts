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

/**
 * CR-206 — receiving one booking point by point at the scan station. The CouchDB here is a
 * small in-memory one that honours `_rev` on the donation PUT, so two points saving at once
 * meet the same 409 they would for real.
 */

type GetEvent = Parameters<typeof GET>[0];
type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	requireShelterScopeOrSA: vi.fn()
}));

const catalogRows = [
	{
		doc: {
			_id: 'item:water',
			type: 'supply_item',
			name: 'น้ำดื่ม',
			category: 'water',
			unit: 'ขวด',
			reorder_level: null,
			perishable: false
		}
	},
	{
		doc: {
			_id: 'item:paracetamol',
			type: 'supply_item',
			name: 'พาราเซตามอล',
			category: 'medical',
			unit: 'แผง',
			reorder_level: null,
			perishable: false
		}
	},
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
	}
];

const pin = { lat: 7.0, lng: 100.5 };
const GYM = {
	id: 'sp-gym',
	name: 'โรงยิม',
	types: ['drinking_water'],
	accepts_donations: true,
	...pin
};
const MED = {
	id: 'sp-med',
	name: 'ห้องพยาบาล',
	types: ['medical_supplies'],
	accepts_donations: true,
	...pin
};
/** A storage point that does not take donations. */
const STORE3 = { id: 'sp-store3', name: 'ห้องเก็บของ 3', types: ['general'], ...pin };
const untick = (point: object) => ({ ...point, accepts_donations: false });

const splitDonation = {
	_id: 'donation:123',
	_rev: '1-abc',
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
	logistics: { delivery_method: 'self_dropoff' }
} as unknown as PublicDonationDoc;

const water = {
	item_id: 'item:water',
	qty: '24',
	unit: 'ขวด',
	lot: { storage_point_id: 'sp-gym', storage_zone: 'โรงยิม' }
};
const medicine = {
	item_id: 'item:paracetamol',
	qty: '10',
	unit: 'แผง',
	lot: { storage_point_id: 'sp-med', storage_zone: 'ห้องพยาบาล' }
};

type Doc = { _id: string; _rev?: string } & Record<string, unknown>;

/** The shelter database and the registry, as the route sees them. */
const couch = {
	donation: splitDonation as PublicDonationDoc,
	docs: new Map<string, Doc>(),
	subStorage: [GYM, MED, STORE3] as object[],
	/** Answers for the next donation PUTs, used before the real `_rev` check. */
	putStatuses: [] as number[],
	/** Runs before each donation PUT — another point or a close landing first. */
	beforePut: null as (() => void) | null
};

function nextRev(rev: string | undefined): string {
	return `${parseInt(rev ?? '0', 10) + 1}-r`;
}

function installCouch() {
	vi.mocked(adminRaw).mockImplementation(async (path: string, method: string, body?: unknown) => {
		if (method === 'GET' && path.includes('/registry/')) {
			// The by-code view answers with the shelter doc; `_all_docs` lists the shelters.
			const doc = path.includes('by_code')
				? { code: 'SH001', common_areas: { sub_storage: couch.subStorage } }
				: { code: 'SH001' };
			return { status: 200, data: { rows: [{ id: 'shelter:SH001', doc }] } };
		}
		if (method === 'GET' && path.includes('/catalog/')) {
			return { status: 200, data: { rows: path.includes('item:') ? catalogRows : [] } };
		}
		if (method === 'GET' && path.includes('_all_docs') && path.includes('item_master:')) {
			return { status: 200, data: { rows: [] } };
		}
		if (method === 'GET' && path.includes('_all_docs') && path.includes('donation:')) {
			return { status: 200, data: { rows: [{ doc: couch.donation }] } };
		}
		if (method === 'GET') {
			const id = decodeURIComponent(path.split('/')[2] ?? '');
			if (id === couch.donation._id) return { status: 200, data: couch.donation };
			const doc = couch.docs.get(id);
			return doc ? { status: 200, data: doc } : { status: 404, data: { error: 'not_found' } };
		}
		if (method === 'POST' && path.includes('_all_docs')) {
			const keys = (body as { keys: string[] }).keys;
			const rows = keys.map((key) => {
				const doc = couch.docs.get(key);
				return doc ? { key, id: key, doc } : { key, error: 'not_found' };
			});
			return { status: 200, data: { rows } };
		}
		if (method === 'POST' && path.includes('_find')) {
			const selector = (body as { selector: { ref_id?: string } }).selector;
			if (!selector.ref_id) return { status: 200, data: { docs: [] } }; // lot numbers
			const docs = [...couch.docs.values()]
				.filter((d) => d.type === 'stock_ledger' && d.ref_id === selector.ref_id)
				.map((d) => ({ _id: d._id, item_id: d.item_id }));
			return { status: 200, data: { docs } };
		}
		if (method === 'POST' && path.includes('_bulk_docs')) {
			const outcomes = (body as { docs: Doc[] }).docs.map((doc) => {
				if (couch.docs.has(doc._id)) return { id: doc._id, error: 'conflict', reason: 'exists' };
				couch.docs.set(doc._id, { ...doc, _rev: '1-r' });
				return { id: doc._id, ok: true, rev: '1-r' };
			});
			return { status: 201, data: outcomes };
		}
		if (method === 'PUT') {
			couch.beforePut?.();
			const forced = couch.putStatuses.shift();
			if (forced !== undefined) return { status: forced, data: { error: 'conflict' } };
			const doc = body as PublicDonationDoc;
			if (doc._rev !== couch.donation._rev) return { status: 409, data: { error: 'conflict' } };
			const rev = nextRev(doc._rev);
			couch.donation = { ...doc, _rev: rev };
			return { status: 201, data: { ok: true, id: doc._id, rev } };
		}
		return { status: 404, data: {} };
	});
}

function postEvent(body: Record<string, unknown>): PostEvent {
	const sent = { status: 'received', expected_rev: couch.donation._rev, ...body };
	return {
		params: { query: 'DN-999999' },
		request: { headers: { get: () => 'session-cookie' }, json: () => Promise.resolve(sent) }
	} as unknown as PostEvent;
}

/** One point's receipt: every line sent in order, `line_nos` picks the ones recorded. */
const atPoint = (pointId: string | null, lineNos: number[], items: unknown[] = [water, medicine]) =>
	postEvent({ point_id: pointId, line_nos: lineNos, items });

const ledgerRows = () =>
	[...couch.docs.values()].filter((d) => d.type === 'stock_ledger') as unknown as StockLedger[];
const audits = () =>
	[...couch.docs.values()].filter((d) => d.type === 'audit') as unknown as AuditEntry[];
const puts = () => vi.mocked(adminRaw).mock.calls.filter((c) => c[1] === 'PUT');
const bulkWrites = () =>
	vi.mocked(adminRaw).mock.calls.filter((c) => String(c[0]).includes('_bulk_docs'));

describe('CR-206 — receiving a booking point by point', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'admin',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
		couch.donation = structuredClone(splitDonation);
		couch.docs.clear();
		couch.subStorage = [GYM, MED, STORE3];
		couch.putStatuses = [];
		couch.beforePut = null;
		installCouch();
	});

	it('GET hands the scan station each line point and what points recorded — no ledger or audit ids', async () => {
		await POST(atPoint('sp-gym', [0]));

		const response = await GET({
			params: { query: 'DN-999999' },
			request: { headers: { get: () => 'session-cookie' } }
		} as unknown as GetEvent);
		const view = (await response.json()).donation;

		expect(view.items.map((i: { drop_off_point_id: string }) => i.drop_off_point_id)).toEqual([
			'sp-gym',
			'sp-med'
		]);
		expect(view.point_receipts).toEqual([
			{
				point_id: 'sp-gym',
				line_nos: [0],
				received_at: expect.any(String),
				received_by: 'admin'
			}
		]);
	});

	it('AC-5: the gym receives the water only — one receipt, items untouched, booking still open', async () => {
		const response = await POST(atPoint('sp-gym', [0]));
		const body = await response.json();

		expect(response.status).toBe(200);
		const doc = couch.donation;
		expect(doc.status).toBe('verifying');
		expect(doc.items).toEqual(splitDonation.items);
		expect(doc.received_summary).toBeUndefined();
		const waterRowId = await deriveDonationReceiptLineId('donation:123', 'item:water', 0);
		expect(doc.point_receipts).toEqual([
			{
				point_id: 'sp-gym',
				line_nos: [0],
				received_at: expect.any(String),
				received_by: 'admin',
				audit_id: await deriveDonationReceiptAuditId('donation:123', [0]),
				ledger_ids: [waterRowId],
				items: [{ line_no: 0, item_id: 'item:water', qty: '24', unit: 'ขวด' }]
			}
		]);
		// Only the water is keyed, into the gym.
		expect(ledgerRows().map((r) => [r._id, r.lot?.storage_point_id])).toEqual([
			[waterRowId, 'sp-gym']
		]);
		expect(audits()[0]).toMatchObject({
			_id: await deriveDonationReceiptAuditId('donation:123', [0]),
			context: { point_id: 'sp-gym', line_nos: [0], ledger_ids: [waterRowId] }
		});
		// The screen gets the rev it needs for the next receipt of this booking.
		expect(body.donation.rev).toBe(doc._rev);
		expect(body.lots).toEqual([{ item_id: 'item:water', lot_no: expect.any(String) }]);
	});

	it('AC-6: the medical room then receives the medicine and the booking closes', async () => {
		await POST(atPoint('sp-gym', [0]));
		const response = await POST(atPoint('sp-med', [1]));

		expect(response.status).toBe(200);
		const doc = couch.donation;
		expect(doc.status).toBe('received');
		expect(doc.point_receipts).toHaveLength(2);
		expect(doc.received_summary).toMatchObject({
			total_items: 2,
			closed_by: 'admin',
			closed_reason: 'all_points',
			shortfalls: [],
			items: [
				{ item_id: 'item:water', qty: '24', unit: 'ขวด' },
				{ item_id: 'item:paracetamol', qty: '10', unit: 'แผง' }
			]
		});
		expect(ledgerRows()).toHaveLength(2);
		expect(audits()).toHaveLength(2);
	});

	it('AC-10: the gym takes the medicine brought to the wrong point, under its own name', async () => {
		const response = await POST(
			atPoint(
				'sp-gym',
				[1],
				[water, { ...medicine, lot: { storage_point_id: 'sp-gym', storage_zone: 'โรงยิม' } }]
			)
		);

		expect(response.status).toBe(200);
		expect(couch.donation.point_receipts?.[0]).toMatchObject({ point_id: 'sp-gym', line_nos: [1] });
		expect(ledgerRows().map((r) => [r.item_id, r.lot?.storage_point_id])).toEqual([
			['item:paracetamol', 'sp-gym']
		]);
	});

	it('closes in the same write when the only other line was refused at review', async () => {
		couch.donation = {
			...couch.donation,
			items: [
				{ ...splitDonation.items![0], review_status: 'approved' },
				{
					...splitDonation.items![1],
					review_status: 'rejected',
					review_reason_code: 'expired',
					review_reason: 'หมดอายุ'
				}
			]
		} as PublicDonationDoc;

		const response = await POST(atPoint('sp-gym', [0]));

		expect(response.status).toBe(200);
		expect(couch.donation.status).toBe('received');
		expect(couch.donation.received_summary?.items?.[1]).toMatchObject({
			rejected: true,
			reject_reason: 'หมดอายุ'
		});
	});

	it('keeps a line refused at review refused when a point records it', async () => {
		couch.donation = {
			...couch.donation,
			items: [
				splitDonation.items![0],
				{
					...splitDonation.items![1],
					review_status: 'rejected',
					review_reason_code: 'expired',
					review_reason: 'หมดอายุ'
				}
			]
		} as PublicDonationDoc;

		await POST(atPoint('sp-med', [1]));

		expect(couch.donation.point_receipts?.[0].items).toEqual([
			{
				line_no: 1,
				item_id: 'item:paracetamol',
				qty: '0',
				unit: 'แผง',
				rejected: true,
				reject_reason_code: 'expired',
				reject_reason: 'หมดอายุ'
			}
		]);
		expect(ledgerRows()).toHaveLength(0);
	});

	describe('whole-booking receipts stay as they were (FR-MP-24)', () => {
		it.each([
			[
				'an older booking with no point',
				[{ item_id: 'item:rice', qty: '10', unit: 'kg' }],
				'self_dropoff'
			],
			[
				'a parcel booking',
				[{ item_id: 'item:rice', qty: '10', unit: 'kg', drop_off_point_id: null }],
				'parcel'
			]
		])(
			'AC-12: %s is received in one go under the per-booking audit id',
			async (_l, items, method) => {
				couch.donation = {
					...couch.donation,
					items,
					logistics: { delivery_method: method }
				} as unknown as PublicDonationDoc;

				const response = await POST(
					postEvent({ items: [{ item_id: 'item:rice', qty: '10', unit: 'kg' }] })
				);

				expect(response.status).toBe(200);
				expect(couch.donation.status).toBe('received');
				expect(couch.donation.point_receipts).toBeUndefined();
				expect(audits().map((a) => a._id)).toEqual([
					await deriveDonationReceiptAuditId('donation:123')
				]);
				// Nothing about points to check: the shelter doc is not read at all.
				expect(vi.mocked(adminRaw).mock.calls.some((c) => String(c[0]).includes('by_code'))).toBe(
					false
				);
			}
		);

		it('AC-20: refuses the whole booking when a line is on a point the shelter still has', async () => {
			const response = await POST(postEvent({ items: [water, medicine] }));

			expect(response.status).toBe(422);
			expect((await response.json()).error_code).toBe('LINE_NOS_REQUIRED');
			expect(bulkWrites()).toHaveLength(0);
			expect(puts()).toHaveLength(0);
		});

		it('AC-21: receives the whole booking once the shelter unticked both points', async () => {
			couch.subStorage = [untick(GYM), untick(MED), STORE3];

			const response = await POST(postEvent({ items: [water, medicine] }));

			expect(response.status).toBe(200);
			expect(couch.donation.status).toBe('received');
			expect(couch.donation.point_receipts).toBeUndefined();
			expect(audits().map((a) => a._id)).toEqual([
				await deriveDonationReceiptAuditId('donation:123')
			]);
		});

		it('refuses a whole-booking receipt once a point started, even with no point left', async () => {
			await POST(atPoint('sp-gym', [0]));
			couch.subStorage = [untick(GYM), untick(MED)];

			const response = await POST(postEvent({ items: [water, medicine] }));

			expect(response.status).toBe(422);
			expect((await response.json()).error_code).toBe('LINE_NOS_REQUIRED');
		});
	});

	describe('which point may record (FR-MP-22a)', () => {
		it('AC-24: refuses "no point" while the shelter still has drop-off points', async () => {
			const response = await POST(atPoint(null, [0]));

			expect(response.status).toBe(422);
			expect((await response.json()).error_code).toBe('POINT_REQUIRED');
			expect(bulkWrites()).toHaveLength(0);
		});

		it.each([
			['a point unticked since the screen loaded', 'sp-gym', [untick(GYM), MED]],
			['a storage point that takes no donations', 'sp-store3', [GYM, MED, STORE3]],
			['an id the shelter never had', 'sp-ghost', [GYM, MED]]
		])('refuses %s', async (_label, pointId, subStorage) => {
			couch.subStorage = subStorage;

			const response = await POST(atPoint(pointId, [0]));

			expect(response.status).toBe(422);
			expect((await response.json()).error_code).toBe('UNKNOWN_DROP_OFF_POINT');
			expect(bulkWrites()).toHaveLength(0);
		});

		it.each([
			['point_id without line_nos', { point_id: 'sp-gym' }],
			['line_nos without point_id', { line_nos: [0] }],
			['an empty line_nos', { point_id: 'sp-gym', line_nos: [] }],
			['a line twice', { point_id: 'sp-gym', line_nos: [0, 0] }],
			['a line past the end', { point_id: 'sp-gym', line_nos: [2] }]
		])('answers 422 for %s', async (_label, fields) => {
			const response = await POST(postEvent({ ...fields, items: [water, medicine] }));

			expect(response.status).toBe(422);
			expect(bulkWrites()).toHaveLength(0);
		});

		it('AC-23: takes the rest into any storage point once the shelter has no point left', async () => {
			await POST(atPoint('sp-gym', [0]));
			couch.subStorage = [untick(GYM), untick(MED), STORE3];

			const response = await POST(
				atPoint(
					null,
					[1],
					[
						water,
						{ ...medicine, lot: { storage_point_id: 'sp-store3', storage_zone: 'ห้องเก็บของ 3' } }
					]
				)
			);

			expect(response.status).toBe(200);
			const doc = couch.donation;
			expect(doc.status).toBe('received');
			expect(doc.received_summary?.closed_reason).toBe('all_points');
			expect(doc.point_receipts?.[1]).toMatchObject({ point_id: null, line_nos: [1] });
			expect(doc.point_receipts?.[1]).not.toHaveProperty('remarks');
			const medicineRow = ledgerRows().find((r) => r.item_id === 'item:paracetamol');
			expect(medicineRow?.lot?.storage_point_id).toBe('sp-store3');
		});
	});

	it('AC-17: a point turning its only line away keys nothing but starts the booking', async () => {
		const response = await POST(
			atPoint(
				'sp-gym',
				[0],
				[{ ...water, qty: '0', rejected: true, reject_reason_code: 'damaged' }, medicine]
			)
		);

		expect(response.status).toBe(200);
		expect(ledgerRows()).toHaveLength(0);
		expect(couch.donation.status).toBe('verifying');
		expect(couch.donation.point_receipts?.[0]).toMatchObject({
			ledger_ids: [],
			items: [{ line_no: 0, qty: '0', rejected: true, reject_reason_code: 'damaged' }]
		});
	});

	describe('retries and lines already recorded (FR-MP-22e)', () => {
		it('AC-15: the same receipt again after a lost answer is 200 and writes nothing', async () => {
			const staleRev = couch.donation._rev;
			const first = await (await POST(atPoint('sp-gym', [0]))).json();
			vi.mocked(adminRaw).mockClear();

			// The screen never got the answer: it still holds the old rev.
			const retry = await POST(
				postEvent({
					expected_rev: staleRev,
					point_id: 'sp-gym',
					line_nos: [0],
					items: [water, medicine]
				})
			);

			expect(retry.status).toBe(200);
			expect((await retry.json()).lots).toEqual(first.lots);
			expect(bulkWrites()).toHaveLength(0);
			expect(puts()).toHaveLength(0);
			expect(couch.donation.point_receipts).toHaveLength(1);
			expect(ledgerRows()).toHaveLength(1);
			expect(audits()).toHaveLength(1);
		});

		it('AC-15: another point sending a line the gym already received gets the gym name back', async () => {
			await POST(atPoint('sp-gym', [0]));

			const response = await POST(atPoint('sp-med', [0, 1]));
			const body = await response.json();

			expect(response.status).toBe(409);
			expect(body.error_code).toBe('LINE_ALREADY_RECEIVED');
			expect(body.error).toContain('โรงยิม');
			expect(ledgerRows()).toHaveLength(1);
		});

		it('refuses a line of this receipt keyed under another item, scoped to its own lines', async () => {
			const otherId = await deriveDonationReceiptLineId('donation:123', 'item:rice', 0);
			couch.docs.set(otherId, {
				_id: otherId,
				type: 'stock_ledger',
				ref_id: 'donation:123',
				item_id: 'item:rice',
				reason: 'donation'
			});

			const response = await POST(atPoint('sp-gym', [0]));

			expect(response.status).toBe(409);
			expect((await response.json()).error_code).toBe('RECEIPT_MISMATCH');
			expect(puts()).toHaveLength(0);
		});
	});

	describe('two writes meeting on the booking (FR-MP-23a)', () => {
		/** The gym's receipt as it landed, and the booking put back to before it. */
		async function gymSavedFirst(): Promise<PublicDonationDoc> {
			await POST(atPoint('sp-gym', [0]));
			const gymSaved = couch.donation;
			couch.donation = structuredClone(splitDonation); // the medical room's copy, rev 1
			vi.mocked(adminRaw).mockClear();
			return gymSaved;
		}

		it('AC-14: both points saving at once end with both receipts and one row each', async () => {
			const gymSaved = await gymSavedFirst();
			// The gym's rows are already in when the medical room checks the ledger; its receipt
			// reaches the booking just before the medical room's PUT.
			couch.beforePut = () => {
				couch.donation = gymSaved;
				couch.beforePut = null;
			};

			const response = await POST(atPoint('sp-med', [1]));

			expect(response.status).toBe(200);
			expect(puts()).toHaveLength(2);
			const doc = couch.donation;
			expect(doc.point_receipts?.map((r) => r.point_id)).toEqual(['sp-gym', 'sp-med']);
			expect(doc.status).toBe('received');
			expect(doc.received_summary?.closed_reason).toBe('all_points');
			const ids = ledgerRows().map((r) => r._id);
			expect(ids).toHaveLength(2);
			expect(new Set(ids).size).toBe(2);
		});

		it('AC-22: a booking closed meanwhile answers DONATION_CLOSED, saying the goods are in stock', async () => {
			couch.beforePut = () => {
				couch.donation = { ...couch.donation, _rev: '9-closed', status: 'received' };
				couch.beforePut = null;
			};

			const response = await POST(atPoint('sp-med', [1]));
			const body = await response.json();

			expect(response.status).toBe(409);
			expect(body.error_code).toBe('DONATION_CLOSED');
			expect(body.error).toContain('ลงคลังแล้ว');
			expect(body.error).toContain('ผู้ดูแลคลัง');
			expect(ledgerRows()).toHaveLength(1);
			expect(couch.donation.point_receipts).toBeUndefined();
		});

		it('answers LINE_ALREADY_RECEIVED when the write that won took the same line', async () => {
			const gymSaved = await gymSavedFirst();
			couch.beforePut = () => {
				couch.donation = gymSaved;
				couch.beforePut = null;
			};

			const response = await POST(atPoint('sp-med', [0, 1]));

			expect(response.status).toBe(409);
			expect((await response.json()).error_code).toBe('LINE_ALREADY_RECEIVED');
		});

		it('gives up with DONATION_CONFLICT after 3 re-reads, rows kept for the next try', async () => {
			couch.putStatuses = [409, 409, 409, 409];

			const response = await POST(atPoint('sp-gym', [0]));

			expect(response.status).toBe(409);
			expect((await response.json()).error_code).toBe('DONATION_CONFLICT');
			expect(puts()).toHaveLength(4);
			expect(ledgerRows()).toHaveLength(1);

			// The next press finds the row and the audit by id and writes neither again.
			vi.mocked(adminRaw).mockClear();
			const again = await POST(atPoint('sp-gym', [0]));
			expect(again.status).toBe(200);
			expect(ledgerRows()).toHaveLength(1);
			expect(audits()).toHaveLength(1);
			expect(couch.donation.point_receipts).toHaveLength(1);
		});
	});

	it('FR-MP-23b: still refuses a receipt counted on an older copy of the booking', async () => {
		const response = await POST(
			postEvent({
				expected_rev: '0-old',
				point_id: 'sp-gym',
				line_nos: [0],
				items: [water, medicine]
			})
		);

		expect(response.status).toBe(409);
		expect((await response.json()).error_code).toBe('DONATION_CHANGED');
		expect(bulkWrites()).toHaveLength(0);
	});
});
