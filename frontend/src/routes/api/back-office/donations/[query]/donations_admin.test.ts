import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './+server';
import { adminRaw, requireShelterScopeOrSA } from '$lib/server/couch-admin';

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	requireShelterScopeOrSA: vi.fn() // mock warehouse authorization guard
}));

describe('Back-office GET & POST /api/back-office/donations/[query]', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		// Default caller: system admin (bypasses shelter-scope check)
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'admin',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
	});

	const mockDonation = {
		_id: 'donation:123',
		type: 'donation',
		status: 'declared',
		shelter_code: 'SH001',
		booking_ref: 'DN-999999',
		donor: {
			name: 'John Donor',
			phone: '0812345678',
			email: 'john@donor.com'
		},
		items: [{ free_text: 'ข้าวสาร', qty: 10, unit: 'kg' }],
		logistics: {
			delivery_method: 'parcel',
			courier_tracking_no: null
		}
	};

	it('GET returns donation details including donor PII for admin staff', async () => {
		// Mock registry and search results
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/registry/')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [{ id: 'shelter:SH001', doc: { code: 'SH001' } }]
					}
				});
			}
			if (method === 'POST' && path.includes('/_find')) {
				return Promise.resolve({
					status: 200,
					data: { docs: [mockDonation] }
				});
			}
			return Promise.resolve({ status: 404, data: {} });
		});

		const response = await GET({
			params: { query: 'DN-999999' },
			request: { headers: { get: () => 'session-cookie' } } as any
		} as any);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(data.donation.booking_ref).toBe('DN-999999');
		expect(data.donation.donor.name).toBe('John Donor'); // PII should be present for admin
		expect(data.donation.donor.phone).toBe('0812345678');
	});

	it('POST updates status to received and sets received quantities', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/registry/')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [{ id: 'shelter:SH001', doc: { code: 'SH001' } }]
					}
				});
			}
			if (method === 'POST' && path.includes('/_find')) {
				return Promise.resolve({
					status: 200,
					data: { docs: [mockDonation] }
				});
			}
			if (method === 'PUT' && path.includes('/shelter_sh001/')) {
				return Promise.resolve({
					status: 201,
					data: { ok: true }
				});
			}
			return Promise.resolve({ status: 404, data: {} });
		});

		const mockRequest = {
			headers: { get: () => 'session-cookie' },
			json: () =>
				Promise.resolve({
					items: [{ free_text: 'ข้าวสาร', qty: 9, unit: 'kg' }], // adjusted quantity received
					status: 'received'
				})
		};

		const response = await POST({
			params: { query: 'DN-999999' },
			request: mockRequest as any
		} as any);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(data.donation.status).toBe('received');
		expect(data.donation.items[0].qty).toBe(9); // verified receipt qty

		// Verify CouchDB write occurred with correct fields
		const putCall = vi.mocked(adminRaw).mock.calls.find((call) => call[1] === 'PUT');
		expect(putCall).toBeDefined();
		const savedDoc = putCall![2] as any;
		expect(savedDoc.status).toBe('received');
		expect(savedDoc.received_at).toBeDefined();
	});
});
