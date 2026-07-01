import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { adminRaw } from '$lib/server/couch-admin';
import { donationIpLimiter, donationPhoneLimiter } from '$lib/server/security/rate-limiter';

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn()
}));

vi.mock('$lib/server/security/rate-limiter', () => ({
	donationIpLimiter: { check: vi.fn(() => true) },
	donationPhoneLimiter: { check: vi.fn(() => true) }
}));

vi.mock('$lib/server/security/captcha', () => ({
	ReCaptchaProvider: class {
		verifyToken() {
			return Promise.resolve(true);
		}
	}
}));

vi.mock('$env/dynamic/private', () => ({
	env: { SECRET_RECAPTCHA_KEY: 'dummy-secret' }
}));

describe('POST /public/v1/donations', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(donationIpLimiter.check).mockReturnValue(true);
		vi.mocked(donationPhoneLimiter.check).mockReturnValue(true);
	});

	const validPayload = {
		shelter_code: 'SH001',
		donor: {
			name: 'John Doe',
			phone: '0812345678',
			line_id: 'john_line',
			email: 'john@example.com'
		},
		items_declared: [
			{
				item_name: 'ข้าวสาร',
				item_id: 'item:rice',
				qty: 5,
				unit: 'kg',
				category: 'food',
				condition: 'new',
				note: 'บริจาคช่วยผู้ประสบภัย'
			}
		],
		logistics: {
			delivery_method: 'self_dropoff',
			vehicle: 'car',
			eta: '2026-06-27T10:00:00Z'
		},
		captchaToken: 'dummy-token'
	};

	it('creates a donation document in CouchDB when input is valid', async () => {
		// Mock needs recheck: remaining need is plenty (100 kg)
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('donation_campaign:')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								doc: {
									_id: 'donation_campaign:c1',
									type: 'donation_campaign',
									status: 'open',
									needs: [{ item_id: 'item:rice', qty_target: 100, unit: 'kg' }]
								}
							}
						]
					}
				});
			}
			if (method === 'GET' && path.includes('donation:')) {
				return Promise.resolve({
					status: 200,
					data: { rows: [] }
				});
			}
			if (method === 'PUT') {
				return Promise.resolve({ status: 201, data: { ok: true } });
			}
			return Promise.resolve({ status: 404, data: {} });
		});

		const mockRequest = {
			json: () => Promise.resolve(validPayload)
		};

		const response = await POST({
			request: mockRequest as any,
			getClientAddress: () => '127.0.0.1'
		} as any);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(data).toHaveProperty('trackingToken');
		expect(data).toHaveProperty('booking_ref');

		// Verify CouchDB write occurred
		expect(adminRaw).toHaveBeenCalled();
		const putCall = vi.mocked(adminRaw).mock.calls.find((call) => call[1] === 'PUT');
		expect(putCall).toBeDefined();
		const savedDoc = putCall![2] as any;
		expect(savedDoc.type).toBe('donation');
		expect(savedDoc.schema_v).toBe(2);
		expect(savedDoc.donor.name).toBe('John Doe');
		expect(savedDoc.donor.line_id).toBe('john_line');
		expect(savedDoc.logistics.delivery_method).toBe('self_dropoff');
	});

	it('creates a donation document with shelter_pickup and pickup_address', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('donation_campaign:')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								doc: {
									_id: 'donation_campaign:c1',
									type: 'donation_campaign',
									status: 'open',
									needs: [{ item_id: 'item:rice', qty_target: 100, unit: 'kg' }]
								}
							}
						]
					}
				});
			}
			if (method === 'GET' && path.includes('donation:')) {
				return Promise.resolve({
					status: 200,
					data: { rows: [] }
				});
			}
			if (method === 'PUT') {
				return Promise.resolve({ status: 201, data: { ok: true } });
			}
			return Promise.resolve({ status: 404, data: {} });
		});

		const mockRequest = {
			json: () =>
				Promise.resolve({
					...validPayload,
					logistics: {
						delivery_method: 'shelter_pickup',
						vehicle: 'car',
						eta: '2026-06-27T10:00:00Z',
						pickup_address: '123/45 Sukhumvit Rd, Bangkok'
					}
				})
		};

		const response = await POST({
			request: mockRequest as any,
			getClientAddress: () => '127.0.0.1'
		} as any);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);

		const putCall = vi.mocked(adminRaw).mock.calls.find((call) => call[1] === 'PUT');
		expect(putCall).toBeDefined();
		const savedDoc = putCall![2] as any;
		expect(savedDoc.logistics.delivery_method).toBe('shelter_pickup');
		expect(savedDoc.logistics.pickup_address).toBe('123/45 Sukhumvit Rd, Bangkok');
	});

	it('returns 409 NEED_FULL if the item need target is already fully met', async () => {
		// Mock needs recheck: target is 50, but we already have 50 or more donated
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('donation_campaign:')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								doc: {
									_id: 'donation_campaign:c1',
									type: 'donation_campaign',
									status: 'open',
									needs: [{ item_id: 'item:rice', qty_target: 50, unit: 'kg' }]
								}
							}
						]
					}
				});
			}
			if (method === 'GET' && path.includes('donation:')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								doc: {
									_id: 'donation:d1',
									type: 'donation',
									campaign_id: 'donation_campaign:c1',
									status: 'declared',
									items: [{ item_id: 'item:rice', qty: 50 }]
								}
							}
						]
					}
				});
			}
			return Promise.resolve({ status: 404, data: {} });
		});

		const mockRequest = {
			json: () => Promise.resolve(validPayload)
		};

		const response = await POST({
			request: mockRequest as any,
			getClientAddress: () => '127.0.0.1'
		} as any);

		const data = await response.json();
		expect(response.status).toBe(409);
		expect(data.success).toBe(false);
		expect(data.error).toBe('NEED_FULL');
		expect(data.item_id).toBe('item:rice');
	});

	it('returns 422 if input schema validation fails', async () => {
		const invalidPayload = {
			...validPayload,
			donor: { name: '', phone: '' } // missing name and phone
		};

		const mockRequest = {
			json: () => Promise.resolve(invalidPayload)
		};

		const response = await POST({
			request: mockRequest as any,
			getClientAddress: () => '127.0.0.1'
		} as any);

		const data = await response.json();
		expect(response.status).toBe(422);
		expect(data.success).toBe(false);
	});
});
