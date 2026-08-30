import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { findMasterByCode } from '$lib/server/shelters.admin';
import { fetchDocs } from '$lib/server/donation-docs';
import { adminRaw } from '$lib/server/couch-admin';

vi.mock('$lib/server/shelters.admin', () => ({
	findMasterByCode: vi.fn()
}));

vi.mock('$lib/server/donation-docs', () => ({
	fetchDocs: vi.fn()
}));

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	serviceError: vi.fn((e: unknown) => {
		const err = e as { status?: number; message?: string };
		return new Response(JSON.stringify({ error: err.message || String(e) }), {
			status: err.status || 500
		});
	})
}));

type GetEvent = Parameters<typeof GET>[0];

describe('GET /api/v1/shelters/[code]/stock-status', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.mocked(findMasterByCode).mockReset();
		vi.mocked(fetchDocs).mockReset();
		vi.mocked(adminRaw).mockReset();
	});

	it('returns 404 when shelter is not found', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue(null);

		const response = await GET({ params: { code: 'INVALID' } } as unknown as GetEvent);
		expect(response.status).toBe(404);
		const data = await response.json();
		expect(data.message).toContain('not found');
	});

	it('returns stock status successfully with combined catalog and calculated statuses', async () => {
		// Mock shelter master existence
		vi.mocked(findMasterByCode).mockResolvedValue({
			_id: 'shelter:SH001',
			code: 'SH001',
			name: 'Shelter One'
		} as never);

		// Mock occupancy view returning active = 100
		vi.mocked(adminRaw).mockResolvedValue({
			status: 200,
			data: {
				rows: [{ key: 'active', value: 100 }]
			}
		});

		// Mock fetchDocs for ledger, overrides, and catalog items
		vi.mocked(fetchDocs).mockImplementation(async (db, prefix) => {
			if (db === 'catalog' && prefix === 'item:') {
				// Supply items in catalog
				return [
					{
						_id: 'item:water',
						type: 'supply_item',
						name: 'Water Bottled',
						category: 'water',
						unit: 'Bottle',
						reorder_level: 10,
						perishable: false
					},
					{
						_id: 'item:rice',
						type: 'supply_item',
						name: 'Jasmine Rice',
						category: 'food',
						unit: 'kg',
						reorder_level: 50,
						perishable: false
					}
				];
			}
			if (db === 'catalog' && prefix === 'item_master:') {
				// Item masters in catalog
				return [
					{
						_id: 'item_master:blanket',
						type: 'item_master',
						name: 'Warm Blanket',
						category: 'bedding',
						unit: 'pcs',
						reorder_level: null,
						target_reserve_days: 7,
						consumption_rate: '0.1', // 100 people * 0.1 * 7 days = 70 threshold
						timeframe: 'daily'
					}
				];
			}
			if (db === 'shelter_sh001' && prefix === 'stock_ledger:') {
				// Ledger transactions (SH001)
				return [
					{
						_id: 'stock_ledger:1',
						type: 'stock_ledger',
						item_id: 'item:water',
						qty: '5',
						occurred_at: '2026-08-25T10:00:00Z'
					},
					{
						_id: 'stock_ledger:2',
						type: 'stock_ledger',
						item_id: 'item:rice',
						qty: '80',
						occurred_at: '2026-08-25T12:00:00Z'
					},
					{
						_id: 'stock_ledger:3',
						type: 'stock_ledger',
						item_id: 'item_master:blanket',
						qty: '60',
						occurred_at: '2026-08-25T11:00:00Z'
					}
				];
			}
			if (db === 'shelter_sh001' && prefix === 'stock_threshold_override:') {
				// Threshold overrides: override water threshold directly
				return [
					{
						_id: 'stock_threshold_override:sh001:water',
						type: 'stock_threshold_override',
						item_id: 'item:water',
						reorder_level: 20
					}
				];
			}
			return [];
		});

		const response = await GET({ params: { code: 'SH001' } } as unknown as GetEvent);
		expect(response.status).toBe(200);

		const data = await response.json();
		expect(data.shelter_code).toBe('SH001');
		expect(data.occupancy).toBe(100);
		expect(data.last_updated).toBe('2026-08-25T12:00:00Z');

		// Check item:water (Threshold overridden to 20, qty=5 -> status 'low', diff = -15)
		const water = data.items.find((i: { item_id: string }) => i.item_id === 'item:water');
		expect(water).toBeDefined();
		expect(water.qty_on_hand).toBe('5');
		expect(water.reorder_threshold).toBe('20');
		expect(water.difference).toBe('-15');
		expect(water.status).toBe('low');

		// Check item:rice (Threshold default = 50, qty=80 -> status 'normal', diff = 30)
		const rice = data.items.find((i: { item_id: string }) => i.item_id === 'item:rice');
		expect(rice).toBeDefined();
		expect(rice.qty_on_hand).toBe('80');
		expect(rice.reorder_threshold).toBe('50');
		expect(rice.difference).toBe('30');
		expect(rice.status).toBe('normal');

		// Check item_master:blanket (Threshold dynamically calc: 100 * 0.1 * 7 = 70, qty=60 -> status 'low', diff = -10)
		const blanket = data.items.find(
			(i: { item_id: string }) => i.item_id === 'item_master:blanket'
		);
		expect(blanket).toBeDefined();
		expect(blanket.qty_on_hand).toBe('60');
		expect(blanket.reorder_threshold).toBe('70');
		expect(blanket.difference).toBe('-10');
		expect(blanket.status).toBe('low');
	});
});
