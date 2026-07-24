import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PATCH, DELETE } from './+server';
import { adminRaw } from '$lib/server/couch-admin';
import { putAsPublicWriter } from '$lib/server/couch-public-writer';
import { sha256Hex } from '$lib/db/hash';
import type { PublicDonationDoc } from '$lib/features/donations';

type GetEvent = Parameters<typeof GET>[0];
type PatchEvent = Parameters<typeof PATCH>[0];
type DeleteEvent = Parameters<typeof DELETE>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn()
}));

vi.mock('$lib/server/couch-public-writer', () => ({
	putAsPublicWriter: vi.fn()
}));

vi.mock('$lib/server/security/rate-limiter', () => ({
	donationIpLimiter: { check: vi.fn(() => true) }
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		FASTAPI_INTERNAL_URL: 'http://localhost:9000',
		EXTERNAL_API_SECRET: 'test-external-secret'
	}
}));

const TOKEN = 'TX-SH001-TESTTOKEN';

describe('GET & PATCH & DELETE /api/public/v1/donations/[tracking_token]', () => {
	let mockDonation: PublicDonationDoc;

	beforeEach(async () => {
		vi.resetAllMocks();
		vi.unstubAllGlobals();
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
			items: [{ free_text: 'ข้าวสาร', qty: '10', unit: 'kg' }],
			logistics: {
				delivery_method: 'parcel',
				courier_tracking_no: null
			}
		} as unknown as PublicDonationDoc;
	});

	it('GET returns donation details from FastAPI', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					success: true,
					donation: {
						status: 'declared',
						booking_ref: 'DN-999999',
						shelter_code: 'SH001',
						donor: { name: 'S***' },
						items: [{ free_text: 'ข้าวสาร', qty: '10', unit: 'kg' }],
						logistics: { delivery_method: 'parcel' },
						received_summary: null,
						updated_at: '2026-01-01T00:00:00Z'
					}
				})
			})
		);

		const response = await GET({
			params: { tracking_token: TOKEN },
			getClientAddress: () => '127.0.0.1'
		} as unknown as GetEvent);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(data.donation.booking_ref).toBe('DN-999999');
		expect(data.donation.items[0].free_text).toBe('ข้าวสาร');
		expect(data.donation.donor.name).toBe('S***');
		expect(data.donation.donor.phone).toBeUndefined();
	});

	it('PATCH updates the courier tracking number in CouchDB', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/shelter_sh001/') && path.includes('_all_docs')) {
				return Promise.resolve({
					status: 200,
					data: { rows: [{ doc: mockDonation }] }
				});
			}
			return Promise.resolve({ status: 404, data: {} });
		});
		vi.mocked(putAsPublicWriter).mockResolvedValue({ status: 201, data: { ok: true } });

		const mockRequest = {
			json: () => Promise.resolve({ courier_tracking_no: 'TH999888' })
		};

		const response = await PATCH({
			params: { tracking_token: TOKEN },
			request: mockRequest,
			getClientAddress: () => '127.0.0.1'
		} as unknown as PatchEvent);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);

		expect(putAsPublicWriter).toHaveBeenCalled();
		const [, , savedDoc] = vi.mocked(putAsPublicWriter).mock.calls[0]!;
		expect((savedDoc as PublicDonationDoc).logistics?.courier_tracking_no).toBe('TH999888');
	});

	it('PATCH falls back to FastAPI when donation is not yet in CouchDB', async () => {
		vi.mocked(adminRaw).mockResolvedValue({
			status: 200,
			data: { rows: [] }
		});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					success: true,
					message: 'Courier tracking number updated'
				})
			})
		);

		const response = await PATCH({
			params: { tracking_token: TOKEN },
			request: {
				json: () => Promise.resolve({ courier_tracking_no: 'TH111222' })
			},
			getClientAddress: () => '127.0.0.1'
		} as unknown as PatchEvent);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(putAsPublicWriter).not.toHaveBeenCalled();
		expect(fetch).toHaveBeenCalledWith(
			'http://localhost:9000/public/v1/donations/TX-SH001-TESTTOKEN',
			expect.objectContaining({
				method: 'PATCH',
				headers: expect.objectContaining({
					Authorization: 'Bearer test-external-secret'
				})
			})
		);
	});

	it('PATCH returns 409 when CouchDB reports a revision conflict', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/shelter_sh001/') && path.includes('_all_docs')) {
				return Promise.resolve({
					status: 200,
					data: { rows: [{ doc: mockDonation }] }
				});
			}
			return Promise.resolve({ status: 404, data: {} });
		});
		vi.mocked(putAsPublicWriter).mockResolvedValue({ status: 409, data: { error: 'conflict' } });

		const response = await PATCH({
			params: { tracking_token: TOKEN },
			request: {
				json: () => Promise.resolve({ courier_tracking_no: 'TH999888' })
			},
			getClientAddress: () => '127.0.0.1'
		} as unknown as PatchEvent);

		const data = await response.json();
		expect(response.status).toBe(409);
		expect(data.success).toBe(false);
	});

	it('PATCH rejects missing courier tracking number with 400', async () => {
		const mockRequest = {
			json: () => Promise.resolve({}) // missing courier_tracking_no
		};

		const response = await PATCH({
			params: { tracking_token: TOKEN },
			request: mockRequest,
			getClientAddress: () => '127.0.0.1'
		} as unknown as PatchEvent);

		const data = await response.json();
		expect(response.status).toBe(400);
		expect(data.success).toBe(false);
	});

	it('DELETE sets status to cancelled and calls putAsPublicWriter', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/shelter_sh001/') && path.includes('_all_docs')) {
				return Promise.resolve({
					status: 200,
					data: { rows: [{ doc: mockDonation }] }
				});
			}
			return Promise.resolve({ status: 404, data: {} });
		});
		vi.mocked(putAsPublicWriter).mockResolvedValue({ status: 201, data: { ok: true } });

		const response = await DELETE({
			params: { tracking_token: TOKEN },
			getClientAddress: () => '127.0.0.1'
		} as unknown as DeleteEvent);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);

		expect(putAsPublicWriter).toHaveBeenCalled();
		const [, , savedDoc] = vi.mocked(putAsPublicWriter).mock.calls[0]!;
		expect((savedDoc as PublicDonationDoc).status).toBe('cancelled');
	});

	it('DELETE falls back to FastAPI when donation is not yet in CouchDB', async () => {
		vi.mocked(adminRaw).mockResolvedValue({
			status: 200,
			data: { rows: [] }
		});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					success: true,
					message: 'Donation cancelled successfully'
				})
			})
		);

		const response = await DELETE({
			params: { tracking_token: TOKEN },
			getClientAddress: () => '127.0.0.1'
		} as unknown as DeleteEvent);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(putAsPublicWriter).not.toHaveBeenCalled();
		expect(fetch).toHaveBeenCalledWith(
			'http://localhost:9000/public/v1/donations/TX-SH001-TESTTOKEN',
			expect.objectContaining({
				method: 'DELETE',
				headers: expect.objectContaining({
					Authorization: 'Bearer test-external-secret'
				})
			})
		);
	});

	it('DELETE returns 409 when the FastAPI buffer is already synced to CouchDB', async () => {
		vi.mocked(adminRaw).mockResolvedValue({
			status: 200,
			data: { rows: [] }
		});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 409,
				json: async () => ({
					success: false,
					error: 'SYNCED_TO_COUCH',
					message: 'Donation already in CouchDB; cancel via shelter record'
				})
			})
		);

		const response = await DELETE({
			params: { tracking_token: TOKEN },
			getClientAddress: () => '127.0.0.1'
		} as unknown as DeleteEvent);

		const data = await response.json();
		expect(response.status).toBe(409);
		expect(data.success).toBe(false);
	});

	it('DELETE returns 400 when the FastAPI buffer is not in a cancellable status', async () => {
		vi.mocked(adminRaw).mockResolvedValue({
			status: 200,
			data: { rows: [] }
		});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 400,
				json: async () => ({
					success: false,
					error: 'Cannot cancel donation in status "received"'
				})
			})
		);

		const response = await DELETE({
			params: { tracking_token: TOKEN },
			getClientAddress: () => '127.0.0.1'
		} as unknown as DeleteEvent);

		const data = await response.json();
		expect(response.status).toBe(400);
		expect(data.success).toBe(false);
	});

	it('DELETE returns 404 when the token matches no donation anywhere', async () => {
		vi.mocked(adminRaw).mockResolvedValue({
			status: 200,
			data: { rows: [] }
		});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 404,
				json: async () => ({ success: false, error: 'Donation record not found' })
			})
		);

		const response = await DELETE({
			params: { tracking_token: TOKEN },
			getClientAddress: () => '127.0.0.1'
		} as unknown as DeleteEvent);

		const data = await response.json();
		expect(response.status).toBe(404);
		expect(data.success).toBe(false);
	});

	it('DELETE returns 400 if donation is not in declared status', async () => {
		mockDonation.status = 'received';
		vi.mocked(adminRaw).mockImplementation((path: string, method: string) => {
			if (method === 'GET' && path.includes('/shelter_sh001/') && path.includes('_all_docs')) {
				return Promise.resolve({
					status: 200,
					data: { rows: [{ doc: mockDonation }] }
				});
			}
			return Promise.resolve({ status: 404, data: {} });
		});

		const response = await DELETE({
			params: { tracking_token: TOKEN },
			getClientAddress: () => '127.0.0.1'
		} as unknown as DeleteEvent);

		const data = await response.json();
		expect(response.status).toBe(400);
		expect(data.success).toBe(false);
	});
});
