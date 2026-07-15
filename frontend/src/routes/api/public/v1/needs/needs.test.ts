import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { adminRaw } from '$lib/server/couch-admin';

type GetEvent = Parameters<typeof GET>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	serviceError: (e: unknown) =>
		new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'error' }), {
			status: 500
		}),
	ServiceError: class extends Error {
		constructor(
			public code: string,
			message: string
		) {
			super(message);
		}
	}
}));

describe('GET /api/public/v1/needs', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('returns aggregated needs from campaigns without PII', async () => {
		// Mock CouchDB responses
		vi.mocked(adminRaw).mockImplementation((path: string) => {
			if (path.includes('/registry/')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								id: 'shelter:SH001',
								doc: {
									_id: 'shelter:SH001',
									type: 'shelter',
									code: 'SH001',
									name: 'Shelter One',
									status: 'open'
								}
							}
						]
					}
				});
			}
			if (path.includes('/catalog/')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								id: 'item:rice',
								doc: {
									_id: 'item:rice',
									type: 'supply_item',
									name: 'Rice',
									category: 'food',
									unit: 'kg'
								}
							}
						]
					}
				});
			}
			if (path.includes('/shelter_sh001/')) {
				if (path.includes('donation_campaign:')) {
					return Promise.resolve({
						status: 200,
						data: {
							rows: [
								{
									doc: {
										_id: 'donation_campaign:c1',
										type: 'donation_campaign',
										status: 'open',
										needs: [
											{
												item_id: 'item:rice',
												qty_target: 100,
												unit: 'kg'
											}
										]
									}
								}
							]
						}
					});
				}
				if (path.includes('donation:')) {
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
										items: [
											{
												item_id: 'item:rice',
												qty: 30
											}
										]
									}
								}
							]
						}
					});
				}
			}
			return Promise.resolve({ status: 404, data: {} });
		});

		const response = await GET({} as unknown as GetEvent);
		const data = await response.json();

		expect(data).toHaveLength(1);
		expect(data[0].code).toBe('SH001');
		expect(data[0].needs).toHaveLength(1);
		expect(data[0].needs[0].item_id).toBe('item:rice');
		expect(data[0].needs[0].qty_needed).toBe('70'); // 100 - 30
		expect(data[0].needs[0].status).toBe('open');
		// Confirm no PII is returned
		expect(data[0].needs[0]).not.toHaveProperty('donor');
	});

	it('caps the qty_needed to 0 and marks as closed when target is met or exceeded', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string) => {
			if (path.includes('/registry/')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								id: 'shelter:SH001',
								doc: {
									_id: 'shelter:SH001',
									type: 'shelter',
									code: 'SH001',
									name: 'Shelter One',
									status: 'open'
								}
							}
						]
					}
				});
			}
			if (path.includes('/catalog/')) {
				return Promise.resolve({
					status: 200,
					data: {
						rows: [
							{
								id: 'item:rice',
								doc: {
									_id: 'item:rice',
									type: 'supply_item',
									name: 'Rice',
									category: 'food',
									unit: 'kg'
								}
							}
						]
					}
				});
			}
			if (path.includes('/shelter_sh001/')) {
				if (path.includes('donation_campaign:')) {
					return Promise.resolve({
						status: 200,
						data: {
							rows: [
								{
									doc: {
										_id: 'donation_campaign:c1',
										type: 'donation_campaign',
										status: 'open',
										needs: [
											{
												item_id: 'item:rice',
												qty_target: 50,
												unit: 'kg'
											}
										]
									}
								}
							]
						}
					});
				}
				if (path.includes('donation:')) {
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
										items: [
											{
												item_id: 'item:rice',
												qty: 60 // Exceeds target 50
											}
										]
									}
								}
							]
						}
					});
				}
			}
			return Promise.resolve({ status: 404, data: {} });
		});

		const response = await GET({} as unknown as GetEvent);
		const data = await response.json();

		expect(data).toHaveLength(1);
		expect(data[0].needs[0].qty_needed).toBe('0'); // Max(0, 50 - 60)
		expect(data[0].needs[0].status).toBe('closed'); // Target met -> closed/งดรับ
	});
});
