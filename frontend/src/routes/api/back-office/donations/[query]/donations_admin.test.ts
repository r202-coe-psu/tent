import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './+server';
import { adminRaw, requireShelterScopeOrSA } from '$lib/server/couch-admin';
import type { PublicDonationDoc } from '$lib/features/donations';

type GetEvent = Parameters<typeof GET>[0];
type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	requireShelterScopeOrSA: vi.fn()
}));

function mockRegistryAndDonations(donation: PublicDonationDoc) {
	vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
		if (method === 'GET' && path.includes('/registry/')) {
			return Promise.resolve({
				status: 200,
				data: {
					rows: [{ id: 'shelter:SH001', doc: { code: 'SH001' } }]
				}
			});
		}
		if (method === 'GET' && path.includes('donation:')) {
			return Promise.resolve({
				status: 200,
				data: { rows: [{ doc: donation }] }
			});
		}
		if (method === 'PUT' && path.includes('/shelter_sh001/')) {
			return Promise.resolve({ status: 201, data: { ok: true } });
		}
		return Promise.resolve({ status: 404, data: {} });
	});
}

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

	const mockDonation = {
		_id: 'donation:123',
		_rev: '1-abc',
		type: 'donation',
		status: 'declared',
		shelter_code: 'SH001',
		booking_ref: 'DN-999999',
		tracking_token_hash: 'secret-hash',
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
	} as PublicDonationDoc;

	it('GET returns donation details including donor PII for admin staff', async () => {
		mockRegistryAndDonations(mockDonation);

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
		mockRegistryAndDonations(mockDonation);

		const response = await GET({
			params: { query: 'DN-999999' },
			request: { headers: { get: () => 'session-cookie' } }
		} as unknown as GetEvent);

		const data = await response.json();
		expect(response.status).toBe(403);
		expect(data.success).toBe(false);
		expect(data.error).toBe('Forbidden');
	});

	it('POST updates status to received and returns redacted ScanDonationView', async () => {
		mockRegistryAndDonations(mockDonation);

		const mockRequest = {
			headers: { get: () => 'session-cookie' },
			json: () =>
				Promise.resolve({
					items: [{ free_text: 'ข้าวสาร', qty: 9, unit: 'kg' }],
					status: 'received'
				})
		};

		const response = await POST({
			params: { query: 'DN-999999' },
			request: mockRequest
		} as unknown as PostEvent);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(data.donation.status).toBe('received');
		expect(data.donation.items[0].qty).toBe(9);
		expect(data.donation).not.toHaveProperty('tracking_token_hash');
		expect(data.donation).not.toHaveProperty('_rev');

		const putCall = vi.mocked(adminRaw).mock.calls.find((call) => call[1] === 'PUT');
		expect(putCall).toBeDefined();
		const savedDoc = putCall![2] as PublicDonationDoc;
		expect(savedDoc.status).toBe('received');
		expect(savedDoc.received_at).toBeDefined();
	});

	it('POST returns 403 when warehouse staff receives another shelter donation', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'warehouse',
			roles: ['shelter:SH002', 'warehouse_staff'],
			isSA: false,
			shelterCode: 'SH002'
		});
		mockRegistryAndDonations(mockDonation);

		const response = await POST({
			params: { query: 'DN-999999' },
			request: {
				headers: { get: () => 'session-cookie' },
				json: () => Promise.resolve({ status: 'received' })
			}
		} as unknown as PostEvent);

		const data = await response.json();
		expect(response.status).toBe(403);
		expect(data.success).toBe(false);
	});

	it('POST returns 422 when body status is not received', async () => {
		mockRegistryAndDonations(mockDonation);

		const response = await POST({
			params: { query: 'DN-999999' },
			request: {
				headers: { get: () => 'session-cookie' },
				json: () => Promise.resolve({ status: 'cancelled' })
			}
		} as unknown as PostEvent);

		const data = await response.json();
		expect(response.status).toBe(422);
		expect(data.success).toBe(false);
	});

	it('POST returns 409 on CouchDB conflict', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/registry/')) {
				return Promise.resolve({
					status: 200,
					data: { rows: [{ id: 'shelter:SH001', doc: { code: 'SH001' } }] }
				});
			}
			if (method === 'GET' && path.includes('donation:')) {
				return Promise.resolve({
					status: 200,
					data: { rows: [{ doc: mockDonation }] }
				});
			}
			if (method === 'PUT') {
				return Promise.resolve({ status: 409, data: { error: 'conflict' } });
			}
			return Promise.resolve({ status: 404, data: {} });
		});

		const response = await POST({
			params: { query: 'DN-999999' },
			request: {
				headers: { get: () => 'session-cookie' },
				json: () => Promise.resolve({ status: 'received' })
			}
		} as unknown as PostEvent);

		const data = await response.json();
		expect(response.status).toBe(409);
		expect(data.success).toBe(false);
	});
});
