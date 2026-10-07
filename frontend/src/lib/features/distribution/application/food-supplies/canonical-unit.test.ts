import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import { createItemMaster, type CatalogRepository } from '$lib/features/catalog';
import { resolveCanonicalItemUnits } from './canonical-unit';

const ctx: AuthorContext = {
	shelterCode: 'SH001',
	createdBy: 'warehouse:tester',
	roles: ['shelter:SH001', 'warehouse_staff']
};

const blanket = createItemMaster(
	{
		name: 'Blanket',
		base_unit: 'piece',
		conversions: [],
		distribution_type: 'recurring',
		type_class: 'CONSUMABLE'
	},
	ctx
);

const rice = createItemMaster(
	{
		name: 'Rice',
		base_unit: 'kg',
		conversions: [],
		distribution_type: 'recurring',
		type_class: 'CONSUMABLE'
	},
	ctx
);

const catalog: Pick<CatalogRepository, 'listItemMasters' | 'listUnitsOfMeasure'> = {
	async listItemMasters() {
		return [blanket, rice];
	},
	async listUnitsOfMeasure() {
		return [];
	}
};

describe('resolveCanonicalItemUnits', () => {
	it('uses ItemMaster base_unit and central UOM normalization for persisted Distribution units', async () => {
		const units = await resolveCanonicalItemUnits([blanket._id, rice._id], ctx, catalog);
		expect(units.get(blanket._id)).toBe('piece');
		expect(units.get(rice._id)).toBe('kg');
	});
});
