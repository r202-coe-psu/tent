import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PATCH } from './+server';
import { adminRaw } from '$lib/server/couch-admin';

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn()
}));

vi.mock('$lib/server/security/rate-limiter', () => ({
	donationIpLimiter: { check: vi.fn(() => true) }
}));

describe('GET & PATCH /api/v1/donations/[tracking_token]', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	const mockDonation = {
		_id: 'donation:123',
		type: 'donation',
		status: 'declared',
		shelter_code: 'SH001',
		booking_ref: 'DN-999999',
		donor: {
			name: 'Secret Donor',
			phone: '0812345678',
			email: 'secret@donor.com'
		},
		items: [{ free_text: 'ข้าวสาร', qty: 10, unit: 'kg' }],
		logistics: {
			delivery_method: 'parcel',
			courier_tracking_no: null
		}
	};

	it('GET returns donation details with masked donor PII', async () => {
		// Mock search results
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/shelter_sh001/')) {
				return Promise.resolve({
					status: 200,
					data: mockDonation
				});
			}
			return Promise.resolve({ status: 404, data: {} });
		});

		const response = await GET({
			params: { tracking_token: 'TX-SH001-TESTTOKEN' },
			getClientAddress: () => '127.0.0.1'
		} as any);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(data.donation.booking_ref).toBe('DN-999999');
		expect(data.donation.items[0].free_text).toBe('ข้าวสาร');

		// Ensure PII fields are masked
		expect(data.donation.donor.name).toBe('S***');
		expect(data.donation.donor.phone).toBe('081-***-5678');
	});

	it('PATCH updates the courier tracking number in CouchDB', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/shelter_sh001/')) {
				return Promise.resolve({
					status: 200,
					data: mockDonation
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
			json: () => Promise.resolve({ courier_tracking_no: 'TH999888' })
		};

		const response = await PATCH({
			params: { tracking_token: 'TX-SH001-TESTTOKEN' },
			request: mockRequest as any,
			getClientAddress: () => '127.0.0.1'
		} as any);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);

		// Check if it saved with PUT to shelter DB
		const putCall = vi.mocked(adminRaw).mock.calls.find((call) => call[1] === 'PUT');
		expect(putCall).toBeDefined();
		const savedDoc = putCall![2] as any;
		expect(savedDoc.logistics.courier_tracking_no).toBe('TH999888');
	});

	it('PATCH rejects invalid format of courier tracking number with 400', async () => {
		const mockRequest = {
			json: () => Promise.resolve({}) // missing courier_tracking_no
		};

		const response = await PATCH({
			params: { tracking_token: 'TX-SH001-TESTTOKEN' },
			request: mockRequest as any,
			getClientAddress: () => '127.0.0.1'
		} as any);

		const data = await response.json();
		expect(response.status).toBe(400);
		expect(data.success).toBe(false);
	});
});
