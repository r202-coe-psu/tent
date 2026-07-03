import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { adminRaw } from '$lib/server/couch-admin';
import { putAsPublicWriter } from '$lib/server/couch-public-writer';
import { donationIpLimiter, donationPhoneLimiter } from '$lib/server/security/rate-limiter';

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn()
}));

vi.mock('$lib/server/couch-public-writer', () => ({
	putAsPublicWriter: vi.fn(() => Promise.resolve({ status: 201, data: { ok: true } }))
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

describe('POST /api/public/v1/donations', () => {
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
		items: [
			{
				item_id: 'item:rice',
				free_text: 'ข้าวสาร',
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
			// Shelter validation: registry lookup
			if (method === 'GET' && path.includes('/registry')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								id: 'shelter:01ABCSHELTER',
								doc: { _id: 'shelter:01ABCSHELTER', type: 'shelter', code: 'SH001', status: 'open' }
							}
						]
					}
				});
			}
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
		expect(data).toHaveProperty('bookingRef');

		// Verify CouchDB write occurred via putAsPublicWriter
		expect(putAsPublicWriter).toHaveBeenCalled();
		const [, , savedDoc] = vi.mocked(putAsPublicWriter).mock.calls[0] as [string, string, any];
		expect(savedDoc._id).toMatch(/^donation:/);
		expect(savedDoc.type).toBe('donation');
		expect(savedDoc.schema_v).toBe(2);
		// donation is linked to the campaign so needs_open can decrease (DN-4)
		expect(savedDoc.campaign_id).toBe('donation_campaign:c1');
		expect(savedDoc.items[0].item_id).toBe('item:rice');
		expect(savedDoc.donor.name).toBe('John Doe');
		expect(savedDoc.donor.line_id).toBe('john_line');
		expect(savedDoc.logistics.delivery_method).toBe('self_dropoff');
	});

	it('creates a donation document with shelter_pickup and pickup_address', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/registry')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								id: 'shelter:01ABCSHELTER',
								doc: { _id: 'shelter:01ABCSHELTER', type: 'shelter', code: 'SH001', status: 'open' }
							}
						]
					}
				});
			}
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

		const [, , savedDoc] = vi.mocked(putAsPublicWriter).mock.calls[0] as [string, string, any];
		expect(savedDoc.logistics.delivery_method).toBe('shelter_pickup');
		expect(savedDoc.logistics.pickup_address).toBe('123/45 Sukhumvit Rd, Bangkok');
	});

	it('returns 409 NEED_FULL if the item need target is already fully met', async () => {
		// Mock needs recheck: target is 50, but we already have 50 or more donated
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/registry')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								id: 'shelter:01ABCSHELTER',
								doc: { _id: 'shelter:01ABCSHELTER', type: 'shelter', code: 'SH001', status: 'open' }
							}
						]
					}
				});
			}
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

	it('returns 409 SLOT_FULL if the logistics slot is already fully booked', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/registry')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								id: 'shelter:01ABCSHELTER',
								doc: { _id: 'shelter:01ABCSHELTER', type: 'shelter', code: 'SH001', status: 'open' }
							}
						]
					}
				});
			}
			if (method === 'GET' && path.includes('donation_campaign:')) {
				return Promise.resolve({
					status: 200,
					data: { rows: [] }
				});
			}
			if (method === 'GET' && path.includes('donation_slot')) {
				return Promise.resolve({
					status: 200,
					data: {
						capacity: 1,
						status: 'open'
					}
				});
			}
			if (method === 'GET' && path.includes('donation')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								doc: {
									_id: 'donation:d1',
									type: 'donation',
									status: 'declared',
									logistics: {
										slot: { date: '2026-06-27', from: '09:00', to: '10:00' }
									}
								}
							}
						]
					}
				});
			}
			return Promise.resolve({ status: 404, data: {} });
		});

		const mockRequest = {
			json: () =>
				Promise.resolve({
					...validPayload,
					logistics: {
						delivery_method: 'self_dropoff',
						slot: { date: '2026-06-27', from: '09:00', to: '10:00' }
					}
				})
		};

		const response = await POST({
			request: mockRequest as any,
			getClientAddress: () => '127.0.0.1'
		} as any);

		const data = await response.json();
		expect(response.status).toBe(409);
		expect(data.success).toBe(false);
		expect(data.error).toBe('SLOT_FULL');
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

	it('returns 422 when logistics is missing (required for public channel)', async () => {
		const { logistics, ...noLogistics } = validPayload;
		const mockRequest = {
			json: () => Promise.resolve(noLogistics)
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
