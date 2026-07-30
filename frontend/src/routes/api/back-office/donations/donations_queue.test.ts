import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { adminRaw, requireShelterScopeOrSA } from '$lib/server/couch-admin';

type GetEvent = Parameters<typeof GET>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	requireShelterScopeOrSA: vi.fn()
}));

const sh001 = [
	{
		doc: {
			_id: 'donation:a',
			type: 'donation',
			status: 'declared',
			shelter_code: 'SH001',
			booking_ref: 'DN-000002',
			donor: { name: 'ผู้บริจาค ข', phone: '0800000002' },
			items: [{ free_text: 'น้ำดื่ม', qty: '5', unit: 'ลัง' }],
			tracking_token_hash: 'hash-a',
			logistics: { delivery_method: 'self_dropoff', eta: '2026-07-23T09:00:00.000Z' }
		}
	},
	{
		doc: {
			_id: 'donation:b',
			type: 'donation',
			status: 'declared',
			shelter_code: 'SH001',
			booking_ref: 'DN-000001',
			donor: { name: 'ผู้บริจาค ก', phone: '0800000001' },
			items: [{ item_id: 'item:rice', qty: '10', unit: 'kg' }],
			tracking_token_hash: 'hash-b',
			logistics: { delivery_method: 'self_dropoff', eta: '2026-07-22T09:00:00.000Z' }
		}
	},
	{
		doc: {
			_id: 'donation:c',
			type: 'donation',
			status: 'received',
			shelter_code: 'SH001',
			booking_ref: 'DN-000003',
			donor: { name: 'ผู้บริจาค ค', phone: '0800000003' },
			items: [],
			tracking_token_hash: 'hash-c'
		}
	}
];

const sh002 = [
	{
		doc: {
			_id: 'donation:d',
			type: 'donation',
			status: 'declared',
			shelter_code: 'SH002',
			booking_ref: 'DN-000004',
			donor: { name: 'ศูนย์อื่น', phone: '0800000004' },
			items: [],
			tracking_token_hash: 'hash-d'
		}
	}
];

function mockCouch() {
	vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
		if (method === 'GET' && path.includes('/registry/')) {
			return Promise.resolve({
				status: 200,
				data: {
					rows: [
						{ id: 'shelter:SH001', doc: { code: 'SH001' } },
						{ id: 'shelter:SH002', doc: { code: 'SH002' } }
					]
				}
			});
		}
		if (method === 'GET' && path.includes('/shelter_sh001/')) {
			return Promise.resolve({ status: 200, data: { rows: sh001 } });
		}
		if (method === 'GET' && path.includes('/shelter_sh002/')) {
			return Promise.resolve({ status: 200, data: { rows: sh002 } });
		}
		return Promise.resolve({ status: 404, data: {} });
	});
}

const event = (search = '') =>
	({
		url: new URL(`http://localhost/api/back-office/donations${search}`),
		request: { headers: { get: () => 'session-cookie' } }
	}) as unknown as GetEvent;

describe('GET /api/back-office/donations (pending intake queue)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'warehouse',
			roles: ['shelter:SH001', 'warehouse_staff'],
			isSA: false,
			shelterCode: 'SH001'
		});
	});

	it('lists only declared donations of the caller shelter, soonest ETA first', async () => {
		mockCouch();

		const response = await GET(event());
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.donations.map((d: { booking_ref: string }) => d.booking_ref)).toEqual([
			'DN-000001',
			'DN-000002'
		]);
		expect(data.donations[0]).toMatchObject({ donor_name: 'ผู้บริจาค ก', item_count: 1 });
	});

	it('never exposes the tracking token hash', async () => {
		mockCouch();

		const data = await (await GET(event())).json();

		expect(JSON.stringify(data)).not.toContain('hash-');
	});

	it('does not read other shelters for a scoped caller', async () => {
		mockCouch();

		const data = await (await GET(event())).json();

		expect(JSON.stringify(data)).not.toContain('ศูนย์อื่น');
		const readOther = vi
			.mocked(adminRaw)
			.mock.calls.some((c) => String(c[0]).includes('/shelter_sh002/'));
		expect(readOther).toBe(false);
	});

	it('lets a system admin see every shelter', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'admin',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
		mockCouch();

		const data = await (await GET(event())).json();

		expect(data.donations).toHaveLength(3);
	});

	it('honours an explicit status filter', async () => {
		mockCouch();

		const data = await (await GET(event('?status=received'))).json();

		expect(data.donations.map((d: { booking_ref: string }) => d.booking_ref)).toEqual([
			'DN-000003'
		]);
	});

	it('returns 403 for a signed-in user without a warehouse capability', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'reg',
			roles: ['shelter:SH001', 'registration_staff'],
			isSA: false,
			shelterCode: 'SH001'
		});
		mockCouch();

		const response = await GET(event());

		expect(response.status).toBe(403);
	});
});
