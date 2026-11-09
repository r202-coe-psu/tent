import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { adminRaw, requireShelterScopeOrSA } from '$lib/server/couch-admin';
import { fetchDocs } from '$lib/server/donation-docs';
import type { RequestEvent } from './$types';

vi.mock('$lib/server/couch-admin', () => ({
	requireShelterScopeOrSA: vi.fn(),
	adminRaw: vi.fn()
}));
vi.mock('$lib/server/donation-docs', () => ({ fetchDocs: vi.fn() }));
vi.mock('$lib/server/donation-intake', () => ({
	listShelterCodes: vi.fn(async () => ['SH001', 'SH002']),
	shelterDb: (code: string) => `shelter_${code.toLowerCase()}`
}));

const PAGE = 200;

function event(searchParams: Record<string, string> = {}): RequestEvent {
	const url = new URL('http://localhost/api/back-office/stock/incoming');
	for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
	return {
		request: { headers: { get: (k: string) => (k.toLowerCase() === 'cookie' ? 'c' : null) } },
		url
	} as unknown as RequestEvent;
}

const warehouse = (shelterCode = 'SH001') => ({
	name: 'w',
	roles: ['warehouse_staff', `shelter:${shelterCode}`],
	isSA: false,
	shelterCode
});
const sa = { name: 'sa', roles: ['system_admin'], isSA: true, shelterCode: null };

const transferDoc = (n: number, to = 'SH001') => ({
	_id: `stock_transfer:T${n}`,
	type: 'stock_transfer',
	status: 'shipped',
	to_shelter: to,
	items: [{ item_id: 'item_master:rice', qty: '1', unit: 'kg' }],
	timeline: {
		requested: { at: '2026-11-01T00:00:00Z', by: 'a' },
		shipped: { at: '2026-11-05T03:00:00Z', by: 'b' }
	},
	// must never be echoed back
	driver_name: 'SECRET DRIVER',
	vehicle_plate: 'กข 1234'
});

const donationDoc = {
	_id: 'donation:D1',
	type: 'donation',
	kind: 'items',
	status: 'verifying',
	booking_ref: 'DN-000001',
	donor: { name: 'SECRET DONOR', phone: '0812345678', phone_hash: 'h', email: 'a@b.c' },
	logistics: {
		delivery_method: 'self_dropoff',
		vehicle_plate: 'SECRET PLATE',
		slot: { date: '2026-11-10', from: '09:00', to: '10:00' }
	},
	items: [
		{ item_id: 'item_master:rice', qty: '2', unit: 'sack', review_status: 'approved' },
		{ free_text: 'blankets', qty: '5', unit: 'pcs', review_status: 'approved' }
	]
};

function mockCouch(transfers: unknown[]) {
	vi.mocked(fetchDocs).mockImplementation((async (db: string, prefix: string) => {
		if (prefix === 'item_master:' && db === 'catalog')
			return [
				{
					_id: 'item_master:rice',
					base_unit: 'kg',
					conversions: [{ uom_name: 'sack', multiplier: '25' }]
				}
			];
		if (prefix === 'donation:' && db === 'shelter_sh001') return [donationDoc];
		return [];
	}) as never);
	vi.mocked(adminRaw).mockImplementation((async (_path: string, _m: string, body?: unknown) => {
		const { bookmark } = (body ?? {}) as { bookmark?: string };
		const start = bookmark ? Number(bookmark) : 0;
		const docs = transfers.slice(start, start + PAGE);
		return { status: 200, data: { docs, bookmark: String(start + PAGE) } };
	}) as never);
}

describe('GET /api/back-office/stock/incoming', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('refuses a caller without the warehouse side (403)', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'r',
			roles: ['registration_staff', 'shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});
		expect((await GET(event())).status).toBe(403);
	});

	it('refuses donation_staff (not on the warehouse gate)', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'd',
			roles: ['donation_staff', 'shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});
		expect((await GET(event())).status).toBe(403);
	});

	it("refuses another shelter's code for a non-SA caller", async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(warehouse('SH001'));
		mockCouch([]);
		const res = await GET(event({ shelter_code: 'SH002' }));
		expect(res.status).toBe(403);
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('rejects a malformed shelter_code', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(sa);
		expect((await GET(event({ shelter_code: '../x' }))).status).toBe(400);
	});

	it('returns converted rows and unmatched for the own shelter, scoped to to_shelter server-side', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(warehouse('SH001'));
		mockCouch([transferDoc(1)]);
		const res = await GET(event());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.rows.map((r: { source: string; qty: string }) => [r.source, r.qty])).toEqual([
			['donation', '50'],
			['transfer', '1']
		]);
		expect(body.unmatched).toHaveLength(1);
		expect(body.unmatched[0]).toMatchObject({ reason: 'free_text', label: 'blankets' });

		const sent = vi.mocked(adminRaw).mock.calls[0];
		expect(sent[0]).toBe('/central_ops/_find');
		expect(sent[2]).toMatchObject({
			selector: { type: 'stock_transfer', to_shelter: 'SH001', status: 'shipped' }
		});
	});

	it('never leaks donor or driver PII', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(warehouse('SH001'));
		mockCouch([transferDoc(1)]);
		const text = await (await GET(event())).text();
		for (const secret of ['SECRET', '0812345678', 'a@b.c', 'กข 1234']) {
			expect(text).not.toContain(secret);
		}
		const body = JSON.parse(text);
		const allowed = new Set([
			'source',
			'ref',
			'doc_id',
			'item_id',
			'qty',
			'date',
			'overdue',
			'shelter_code',
			'label',
			'unit',
			'reason'
		]);
		for (const r of [...body.rows, ...body.unmatched]) {
			for (const k of Object.keys(r)) expect(allowed.has(k)).toBe(true);
		}
	});

	it('reads every page of shipped transfers (450 > the old 50 cap)', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(warehouse('SH001'));
		const transfers = Array.from({ length: 450 }, (_, i) => transferDoc(i));
		mockCouch(transfers);
		const body = await (await GET(event())).json();
		expect(body.rows.filter((r: { source: string }) => r.source === 'transfer')).toHaveLength(450);
		const calls = vi.mocked(adminRaw).mock.calls;
		expect(calls).toHaveLength(3);
		expect(calls[1][2]).toMatchObject({ bookmark: '200' });
		expect(calls[2][2]).toMatchObject({ bookmark: '400' });
	});

	it('SA without shelter_code fans donations out per shelter and reads transfers once, unfiltered by to_shelter', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(sa);
		mockCouch([transferDoc(1, 'SH002')]);
		const body = await (await GET(event())).json();
		const donationReads = vi
			.mocked(fetchDocs)
			.mock.calls.filter(([, prefix]) => prefix === 'donation:')
			.map(([db]) => db);
		expect(donationReads).toEqual(['shelter_sh001', 'shelter_sh002']);
		expect(adminRaw).toHaveBeenCalledTimes(1);
		const selector = (vi.mocked(adminRaw).mock.calls[0][2] as { selector: Record<string, unknown> })
			.selector;
		expect(selector).toEqual({ type: 'stock_transfer', status: 'shipped' });
		expect(body.rows.find((r: { source: string }) => r.source === 'transfer').shelter_code).toBe(
			'SH002'
		);
	});

	it('lets SA name one shelter', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(sa);
		mockCouch([]);
		const res = await GET(event({ shelter_code: 'SH001' }));
		expect(res.status).toBe(200);
		expect(vi.mocked(adminRaw).mock.calls[0][2]).toMatchObject({
			selector: { to_shelter: 'SH001' }
		});
	});

	it('surfaces a central_ops read failure as 502', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(warehouse('SH001'));
		mockCouch([]);
		vi.mocked(adminRaw).mockResolvedValue({ status: 500, data: {} } as never);
		expect((await GET(event())).status).toBe(502);
	});
});
