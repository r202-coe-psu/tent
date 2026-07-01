import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PATCH } from './+server';
import { adminRaw } from '$lib/server/couch-admin';

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn()
}));

describe('GET & PATCH /public/v1/donations/[tracking_token]', () => {
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

	it('GET returns donation details without exposing donor PII', async () => {
		// Mock registry & search results
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
			params: { tracking_token: 'TX-DON-TEST' }
		} as any);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(data.donation.booking_ref).toBe('DN-999999');
		expect(data.donation.items_declared[0].item_name).toBe('ข้าวสาร');

		// Ensure PII fields are completely stripped out
		expect(data.donation).not.toHaveProperty('donor');
		expect(data.donation.donor).toBeUndefined();
	});

	it('PATCH updates the courier tracking number in CouchDB', async () => {
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
			json: () => Promise.resolve({ courier_tracking_no: 'TH999888' })
		};

		const response = await PATCH({
			params: { tracking_token: 'TX-DON-TEST' },
			request: mockRequest as any
		} as any);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(data.courier_tracking_no).toBe('TH999888');

		// Check if it saved with PUT to shelter DB
		const putCall = vi.mocked(adminRaw).mock.calls.find((call) => call[1] === 'PUT');
		expect(putCall).toBeDefined();
		const savedDoc = putCall![2] as any;
		expect(savedDoc.logistics.courier_tracking_no).toBe('TH999888');
	});

	it('PATCH rejects invalid format of courier tracking number with 400', async () => {
		const mockRequest = {
			json: () => Promise.resolve({ courier_tracking_no: 12345 }) // number instead of string
		};

		const response = await PATCH({
			params: { tracking_token: 'TX-DON-TEST' },
			request: mockRequest as any
		} as any);

		const data = await response.json();
		expect(response.status).toBe(400);
		expect(data.success).toBe(false);
		expect(data.error).toContain('courier_tracking_no must be a string or null');
	});
});
