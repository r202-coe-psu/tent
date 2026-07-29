import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { adminRaw, requireShelterScopeOrSA } from '$lib/server/couch-admin';

type GetEvent = Parameters<typeof GET>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	requireShelterScopeOrSA: vi.fn()
}));

const donation = {
	_id: 'donation:123',
	type: 'donation',
	status: 'received',
	shelter_code: 'SH001',
	booking_ref: 'DN-999999',
	items: [{ free_text: 'ข้าวสาร', qty: '10', unit: 'kg' }]
};

const auditRows = [
	{
		doc: {
			_id: 'audit:02',
			type: 'audit',
			schema_v: 1,
			shelter_code: 'SH001',
			action: 'manual_adjust',
			target_type: 'donation',
			target_id: 'donation:123',
			reason: 'ตรวจรับบริจาคที่ศูนย์ (DN-999999)',
			occurred_at: '2026-07-22T10:00:00.000Z',
			created_by: 'warehouse',
			context: { received_by: 'warehouse', has_discrepancy: true }
		}
	},
	{
		doc: {
			_id: 'audit:01',
			type: 'audit',
			schema_v: 1,
			shelter_code: 'SH001',
			action: 'manual_adjust',
			target_type: 'donation',
			target_id: 'donation:999', // another donation — must not leak into the result
			reason: 'other',
			occurred_at: '2026-07-22T09:00:00.000Z',
			created_by: 'warehouse'
		}
	},
	{
		doc: {
			_id: 'audit:00',
			type: 'audit',
			schema_v: 1,
			shelter_code: 'SH001',
			action: 'created',
			target_type: 'donation',
			target_id: 'donation:123',
			reason: 'earlier entry',
			occurred_at: '2026-07-21T08:00:00.000Z',
			created_by: 'system'
		}
	}
];

function mockCouch() {
	vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
		if (method === 'GET' && path.includes('/registry/')) {
			return Promise.resolve({
				status: 200,
				data: { rows: [{ id: 'shelter:SH001', doc: { code: 'SH001' } }] }
			});
		}
		if (method === 'GET' && path.includes('donation:')) {
			return Promise.resolve({ status: 200, data: { rows: [{ doc: donation }] } });
		}
		if (method === 'GET' && path.includes('audit:')) {
			return Promise.resolve({ status: 200, data: { rows: auditRows } });
		}
		return Promise.resolve({ status: 404, data: {} });
	});
}

const event = (query = 'DN-999999') =>
	({
		params: { query },
		request: { headers: { get: () => 'session-cookie' } }
	}) as unknown as GetEvent;

describe('GET /api/back-office/donations/[query]/audit', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'warehouse',
			roles: ['shelter:SH001', 'warehouse_staff'],
			isSA: false,
			shelterCode: 'SH001'
		});
	});

	it('returns only the audit entries of the requested donation, newest first', async () => {
		mockCouch();

		const response = await GET(event());
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(data.audits).toHaveLength(2);
		expect(data.audits.map((a: { reason: string }) => a.reason)).toEqual([
			'ตรวจรับบริจาคที่ศูนย์ (DN-999999)',
			'earlier entry'
		]);
		expect(data.audits[0]).toMatchObject({ action: 'manual_adjust', created_by: 'warehouse' });
		expect(data.donation).toMatchObject({ booking_ref: 'DN-999999', status: 'received' });
	});

	it('returns 403 for a caller outside the donation shelter scope', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'warehouse2',
			roles: ['shelter:SH002', 'warehouse_staff'],
			isSA: false,
			shelterCode: 'SH002'
		});
		mockCouch();

		const response = await GET(event());

		expect(response.status).toBe(403);
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

	it('returns 404 when the booking reference matches nothing', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/registry/')) {
				return Promise.resolve({
					status: 200,
					data: { rows: [{ id: 'shelter:SH001', doc: { code: 'SH001' } }] }
				});
			}
			return Promise.resolve({ status: 200, data: { rows: [] } });
		});

		const response = await GET(event('DN-000000'));

		expect(response.status).toBe(404);
	});
});
