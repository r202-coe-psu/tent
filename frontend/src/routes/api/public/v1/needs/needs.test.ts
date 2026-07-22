import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';

type GetEvent = Parameters<typeof GET>[0];

describe('GET /api/public/v1/needs', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('returns aggregated needs from FastAPI proxy without PII', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					shelters: [
						{
							code: 'SH001',
							name: 'Shelter One',
							needs: [
								{
									item_id: 'rice',
									name: 'Rice',
									qty_needed: '70',
									unit: 'kg',
									status: 'open'
								}
							]
						}
					]
				})
			})
		);

		const response = await GET({} as unknown as GetEvent);
		const data = await response.json();

		expect(data).toHaveLength(1);
		expect(data[0].code).toBe('SH001');
		expect(data[0].needs[0].qty_needed).toBe('70');
		expect(data[0].needs[0]).not.toHaveProperty('donor');
	});

	it('returns structured error when FastAPI is unavailable', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 503,
				json: async () => ({})
			})
		);

		const response = await GET({} as unknown as GetEvent);
		const data = await response.json();
		expect(data).toEqual({ success: false, error: 'NEEDS_UNAVAILABLE' });
		expect(response.status).toBe(503);
	});

	it('returns 503 when FastAPI fetch throws', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

		const response = await GET({} as unknown as GetEvent);
		const data = await response.json();
		expect(data).toEqual({ success: false, error: 'NEEDS_UNAVAILABLE' });
		expect(response.status).toBe(503);
	});
});
