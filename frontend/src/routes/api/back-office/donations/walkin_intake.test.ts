import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { adminRaw, requireShelterScopeOrSA } from '$lib/server/couch-admin';

type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	requireShelterScopeOrSA: vi.fn()
}));

/**
 * Counter walk-in intake (`POST /api/back-office/donations`).
 *
 * The scan station used to mint the `donation` + `stock_ledger` docs in the browser
 * and write them with `bulkDocs`. These tests pin the three things that path could
 * not do, and which is why it moved here:
 *
 * 1. the donation is `received` in the same write as its ledger rows, so the goods
 *    are never counted twice against a campaign need (an outstanding booking AND
 *    stock on hand for one delivery);
 * 2. `stock_ledger.ref_id` points at the donation DOC id (CR-055 R2 — the client
 *    passed `booking_ref`, which the domain factory rejects outright);
 * 3. lot numbers are minted server-side against the shelter's existing ledger
 *    (CR-088), and every line is checked against the catalog.
 */

const catalogRows = [
	{
		doc: { _id: 'item:rice', type: 'supply_item', name: 'ข้าวสาร', unit: 'kg', perishable: false }
	},
	{ doc: { _id: 'item:milk', type: 'supply_item', name: 'นมกล่อง', unit: 'box', perishable: true } }
];

type BulkBody = { docs: Array<Record<string, unknown>> };
let written: BulkBody | null = null;

function mockCouch() {
	written = null;
	vi.mocked(adminRaw).mockImplementation((path: string, method: string, body?: unknown) => {
		if (method === 'GET' && path.includes('/registry/')) {
			return Promise.resolve({
				status: 200,
				data: { rows: [{ id: 'shelter:SH001', doc: { code: 'SH001' } }] }
			});
		}
		if (method === 'GET' && path.includes('/catalog/')) {
			return Promise.resolve({ status: 200, data: { rows: catalogRows } });
		}
		// Lot allocation reads today's existing ledger rows; none yet.
		if (method === 'GET' && path.includes('/shelter_sh001/')) {
			return Promise.resolve({ status: 200, data: { rows: [] } });
		}
		if (method === 'POST' && path.includes('_bulk_docs')) {
			written = body as BulkBody;
			return Promise.resolve({
				status: 201,
				data: (body as BulkBody).docs.map((d) => ({ ok: true, id: String(d._id) }))
			});
		}
		return Promise.resolve({ status: 404, data: {} });
	});
}

const event = (body: unknown) =>
	({
		request: {
			headers: { get: () => 'session-cookie' },
			json: () => Promise.resolve(body)
		}
	}) as unknown as PostEvent;

const validBody = {
	donor: { name: 'ผู้บริจาคหน้าเคาน์เตอร์', phone: '0800000001' },
	items: [{ item_id: 'item:rice', qty: '10', unit: 'kg', lot: { storage_zone: 'A-01' } }]
};

const docsOfType = (type: string) =>
	(written?.docs ?? []).filter((d) => (d as { type?: string }).type === type);

describe('POST /api/back-office/donations (walk-in intake)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'warehouse',
			roles: ['shelter:SH001', 'warehouse_staff'],
			isSA: false,
			shelterCode: 'SH001'
		});
	});

	it('writes the donation already received, so the goods are not counted twice', async () => {
		mockCouch();

		const data = await (await POST(event(validBody))).json();

		expect(data.success).toBe(true);
		const donations = docsOfType('donation');
		expect(donations).toHaveLength(1);
		expect(donations[0]).toMatchObject({ channel: 'walk_in', status: 'received' });
		expect(donations[0].received_at).toBeTruthy();
	});

	it('points every ledger row at the donation doc id, not the booking ref', async () => {
		mockCouch();

		await POST(event(validBody));

		const donationId = String(docsOfType('donation')[0]._id);
		const ledgers = docsOfType('stock_ledger');
		expect(ledgers).toHaveLength(1);
		expect(donationId.startsWith('donation:')).toBe(true);
		expect(ledgers[0]).toMatchObject({ reason: 'donation', ref_id: donationId, qty: '10' });
	});

	it('mints the lot number server-side and returns it for the box labels', async () => {
		mockCouch();

		const data = await (await POST(event(validBody))).json();

		const lot = docsOfType('stock_ledger')[0].lot as { lot_no?: string; storage_zone?: string };
		expect(lot.lot_no).toMatch(/^L-\d{6}-\d{3}$/);
		expect(lot.storage_zone).toBe('A-01');
		expect(data.lots).toEqual([{ item_id: 'item:rice', lot_no: lot.lot_no }]);
	});

	it('writes an audit entry naming who keyed it (T-16/FR-33)', async () => {
		mockCouch();

		await POST(event(validBody));

		const audits = docsOfType('audit');
		expect(audits).toHaveLength(1);
		expect(audits[0]).toMatchObject({ target_type: 'donation' });
		expect(JSON.stringify(audits[0])).toContain('warehouse');
	});

	it('never leaks the raw phone as its own hash', async () => {
		mockCouch();

		await POST(event(validBody));

		const donor = docsOfType('donation')[0].donor as { phone?: string; phone_hash?: string };
		expect(donor.phone).toBe('0800000001');
		expect(donor.phone_hash).not.toBe('0800000001');
		expect(donor.phone_hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('rejects a unit that is not the catalog base unit — nothing is written', async () => {
		mockCouch();

		const response = await POST(
			event({ ...validBody, items: [{ item_id: 'item:rice', qty: '10', unit: 'ถุง' }] })
		);
		const data = await response.json();

		expect(response.status).toBe(422);
		expect(data.error_code).toBe('CATALOG_MISMATCH');
		expect(written).toBeNull();
	});

	it('rejects an unknown item — nothing is written', async () => {
		mockCouch();

		const response = await POST(
			event({ ...validBody, items: [{ item_id: 'item:ghost', qty: '1', unit: 'kg' }] })
		);

		expect(response.status).toBe(422);
		expect(written).toBeNull();
	});

	it('demands an expiry for a perishable item', async () => {
		mockCouch();

		const response = await POST(
			event({ ...validBody, items: [{ item_id: 'item:milk', qty: '2', unit: 'box' }] })
		);

		expect(response.status).toBe(422);
		expect(written).toBeNull();
	});

	it('refuses an empty basket or a nameless donor', async () => {
		mockCouch();

		const noItems = await POST(event({ ...validBody, items: [] }));
		expect(noItems.status).toBe(422);

		const noName = await POST(event({ ...validBody, donor: { name: '  ' } }));
		expect(noName.status).toBe(422);
		expect(written).toBeNull();
	});

	it('writes to the caller own shelter and ignores a shelter_code they passed', async () => {
		mockCouch();

		await POST(event({ ...validBody, shelter_code: 'SH002' }));

		const paths = vi.mocked(adminRaw).mock.calls.map((c) => String(c[0]));
		expect(paths.some((p) => p.includes('/shelter_sh002/'))).toBe(false);
		expect(docsOfType('donation')[0].shelter_code).toBe('SH001');
	});

	it('makes a system admin name the destination shelter', async () => {
		mockCouch();
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'sa',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});

		const response = await POST(event(validBody));
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data.error_code).toBe('SHELTER_REQUIRED');
		expect(written).toBeNull();
	});

	it('rejects a caller without the warehouse capability', async () => {
		mockCouch();
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'volunteer',
			roles: ['shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});

		const response = await POST(event(validBody));

		expect(response.status).toBe(403);
		expect(written).toBeNull();
	});
});
