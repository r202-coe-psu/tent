import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import { qtyGte } from '$lib/utils/qty';
import { createFlow2RequisitionTicket } from '../../domain/food-supplies';
import { getItemCapacitySummary } from '../model/frontline-handover';
import { validatePositiveQuantity } from '../model/ticket-quantity';

const author: AuthorContext = {
	shelterCode: 'SH001',
	createdBy: 'staff:frontline',
	roles: ['registration_staff']
};

const ticket = createFlow2RequisitionTicket(
	{
		ticket_no: 'TKT-SUPPLIES-1001',
		requisition_type: 'supplies',
		source_location: 'warehouse:main',
		destination_location: 'distribution_point:zone-a',
		items: [
			{
				item_id: 'item:blanket',
				item_name: 'ผ้าห่ม',
				type_class: 'CONSUMABLE',
				returnable: false,
				requested_qty: '1',
				allocated_qty: '1'
			}
		]
	},
	author,
	'01J00000000000000000000000'
);

describe('SuppliesDistributionCard quantity capacity gate', () => {
	it('evaluates the canonical quantity capacity gate without mounting the Svelte component', () => {
		const item = ticket.items[0];
		const capacity = getItemCapacitySummary(ticket._id, item, []);
		expect(capacity.inHandQty).toBe('1');

		const validQty = validatePositiveQuantity('1');
		expect(validQty.isValid).toBe(true);
		expect(qtyGte(capacity.inHandQty, validQty.value ?? '0')).toBe(true);

		const excessiveQty = validatePositiveQuantity('2');
		expect(excessiveQty.isValid).toBe(true);
		expect(qtyGte(capacity.inHandQty, excessiveQty.value ?? '0')).toBe(false);
	});
});
