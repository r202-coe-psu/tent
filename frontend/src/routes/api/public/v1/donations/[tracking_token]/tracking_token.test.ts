import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PATCH } from './+server';
import { adminRaw } from '$lib/server/couch-admin';
import { sha256Hex } from '$lib/db/hash';

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn()
}));

vi.mock('$lib/server/security/rate-limiter', () => ({
	donationIpLimiter: { check: vi.fn(() => true) }
}));

const TOKEN = 'TX-SH001-TESTTOKEN';

describe('GET & PATCH /api/public/v1/donations/[tracking_token]', () => {
	let mockDonation: any;

	beforeEach(async () => {
		vi.resetAllMocks();
		const hash = await sha256Hex(TOKEN);
		mockDonation = {
			_id: 'donation:01JABCDONATION',
			type: 'donation',
			status: 'declared',
			shelter_code: 'SH001',
			booking_ref: 'DN-999999',
			tracking_token_hash: hash,
			donor: {
				name: 'Secret Donor',
				phone: '0812345678',
				phone_hash: 'abc',
				email: 'secret@donor.com'
			},
			items: [{ free_text: 'ข้าวสาร', qty: 10, unit: 'kg' }],
			logistics: {
				delivery_method: 'parcel',
				courier_tracking_no: null
			}
		};
	});

	it('GET returns donation details with masked donor PII and no phone echo', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/shelter_sh001/') && path.includes('_all_docs')) {
				return Promise.resolve({
					status: 200,
					data: { rows: [{ doc: mockDonation }] }
				});
			}
			return Promise.resolve({ status: 404, data: {} });
		});

		const response = await GET({
			params: { tracking_token: TOKEN },
			getClientAddress: () => '127.0.0.1'
		} as any);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(data.donation.booking_ref).toBe('DN-999999');
		expect(data.donation.items[0].free_text).toBe('ข้าวสาร');

		// name masked; phone/phone_hash must NOT be echoed to public (schema.md §2.3)
		expect(data.donation.donor.name).toBe('S***');
		expect(data.donation.donor.phone).toBeUndefined();
		expect(data.donation.donor.phone_hash).toBeUndefined();
	});

	it('PATCH updates the courier tracking number in CouchDB', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/shelter_sh001/') && path.includes('_all_docs')) {
				return Promise.resolve({
					status: 200,
					data: { rows: [{ doc: mockDonation }] }
				});
			}
			if (method === 'PUT' && path.includes('/shelter_sh001/')) {
				return Promise.resolve({ status: 201, data: { ok: true } });
			}
			return Promise.resolve({ status: 404, data: {} });
		});

		const mockRequest = {
			json: () => Promise.resolve({ courier_tracking_no: 'TH999888' })
		};

		const response = await PATCH({
			params: { tracking_token: TOKEN },
			request: mockRequest as any,
			getClientAddress: () => '127.0.0.1'
		} as any);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);

		const putCall = vi.mocked(adminRaw).mock.calls.find((call) => call[1] === 'PUT');
		expect(putCall).toBeDefined();
		const savedDoc = putCall![2] as any;
		expect(savedDoc.logistics.courier_tracking_no).toBe('TH999888');
	});

	it('PATCH rejects missing courier tracking number with 400', async () => {
		const mockRequest = {
			json: () => Promise.resolve({}) // missing courier_tracking_no
		};

		const response = await PATCH({
			params: { tracking_token: TOKEN },
			request: mockRequest as any,
			getClientAddress: () => '127.0.0.1'
		} as any);

		const data = await response.json();
		expect(response.status).toBe(400);
		expect(data.success).toBe(false);
	});
});
