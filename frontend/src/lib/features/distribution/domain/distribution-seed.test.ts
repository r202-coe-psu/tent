import { describe, expect, it } from 'vitest';
import { stockLedgerDocSchema, type StockLedger } from '$lib/features/operations';
import {
	buildBackOfficeDocs,
	buildDistributionDocs,
	DISTRIBUTION_RECIPIENTS_NEEDED,
	type DistributionCatalog,
	type DistributionCatalogItem
} from '../../../../../scripts/seed/distribution';

const item = (
	n: number,
	fields: Omit<DistributionCatalogItem, '_id'>
): DistributionCatalogItem => ({
	_id: `item_master:01M5ITEM${String(n).padStart(18, '0')}`,
	...fields
});

const catalog: DistributionCatalog = {
	mealGeneral: item(1, {
		name: 'ข้าวกล่องทั่วไป',
		category: 'item_category:ready_meal',
		type_class: 'CONSUMABLE',
		base_unit: 'box'
	}),
	mealHalal: item(2, {
		name: 'ข้าวกล่องฮาลาล',
		category: 'item_category:ready_meal',
		type_class: 'CONSUMABLE',
		base_unit: 'box'
	}),
	kit: item(3, {
		name: 'ถุงยังชีพธารน้ำใจ',
		category: 'item_category:kits',
		type_class: 'CONSUMABLE',
		base_unit: 'bag'
	}),
	blanket: item(4, {
		name: 'ผ้าห่มกันหนาว',
		category: 'item_category:bedding',
		type_class: 'DURABLE',
		returnable: true,
		base_unit: 'piece'
	}),
	mat: item(5, {
		name: 'เสื่อปูนอน',
		category: 'item_category:bedding',
		type_class: 'DURABLE',
		returnable: true,
		base_unit: 'piece'
	}),
	net: item(6, {
		name: 'มุ้ง',
		category: 'item_category:bedding',
		type_class: 'DURABLE',
		returnable: true,
		base_unit: 'piece'
	})
};

const ctx = { shelterCode: 'SH001', createdBy: 'seed-distribution' };
const destinations = ['อาคารยิมเนเซียม 1', 'อาคารยิมเนเซียม 2'];
const NOW = Date.parse('2026-10-22T08:00:00.000Z');

/** Every `adjust` row names a reason (CR-143 §C) and the whole ledger is a valid doc (#772). */
function expectValidLedger(ledger: readonly StockLedger[]) {
	const adjusts = ledger.filter((row) => row.reason === 'adjust');
	expect(adjusts.length).toBeGreaterThan(0);
	for (const row of adjusts) expect(row.adjust_reason).toBe('found');
	for (const row of ledger) expect(stockLedgerDocSchema.safeParse(row).success).toBe(true);
}

describe('distribution seed ledger (#772)', () => {
	it('books the back-office opening stock as adjust/found', () => {
		const { ledger } = buildBackOfficeDocs(catalog, destinations, ctx, NOW);

		expect(ledger).toHaveLength(6);
		expectValidLedger(ledger);
	});

	it('books the desk scenario lots as adjust/found', async () => {
		const people = Array.from({ length: DISTRIBUTION_RECIPIENTS_NEEDED }, (_, i) => ({
			id: `evacuee:01M5RCPT${String(i).padStart(18, '0')}`
		}));

		const { ledger } = await buildDistributionDocs(catalog, people, destinations, ctx, NOW);

		expectValidLedger(ledger);
	});
});
