import { describe, expect, it } from 'vitest';
import type { RequisitionTicketInput } from '../../domain/food-supplies';
import { createFlow2RequisitionTicket } from '../../domain/food-supplies';
import {
	isEligibleDistributionCatalogItem,
	READY_MEAL_CATEGORY_ID,
	KITCHEN_FOOD_CATEGORY_ID
} from '../model/catalog-eligibility';
import type { ItemMaster } from '$lib/features/catalog';
import type { AuthorContext } from '$lib/db/model';

const MOCK_CTX: AuthorContext = {
	shelterCode: 'SH001',
	createdBy: 'staff_test',
	roles: ['warehouse_staff']
};

const mockItemMaster = (
	id: string,
	name: string,
	category: string,
	overrides: Partial<ItemMaster> = {}
): ItemMaster => {
	const base: ItemMaster = {
		_id: id,
		type: 'item_master',
		schema_v: 1,
		created_at: '2026-09-19T10:00:00.000Z',
		updated_at: '2026-09-19T10:00:00.000Z',
		created_by: 'staff_test',
		name,
		category,
		base_unit: 'box',
		conversions: [],
		type_class: 'CONSUMABLE',
		dietary: [],
		returnable: false
	};
	return {
		...base,
		...overrides,
		schema_v: overrides.schema_v ?? base.schema_v,
		created_at: overrides.created_at ?? base.created_at,
		updated_at: overrides.updated_at ?? base.updated_at,
		created_by: overrides.created_by ?? base.created_by
	};
};

describe('Create Ticket Flow Invariants & Boundary Validation (Slice 5.1 §42)', () => {
	const readyMealItem = mockItemMaster('item:rm_01', 'ข้าวกะเพราไก่', READY_MEAL_CATEGORY_ID);
	const kitchenFoodItem = mockItemMaster('item:kf_01', 'ข้าวสารหอมมะลิ', KITCHEN_FOOD_CATEGORY_ID);
	const blanketItem = mockItemMaster('item:sup_01', 'ผ้าห่มกันหนาว', 'item_category:bedding', {
		type_class: 'DURABLE',
		returnable: true
	});

	describe('Food vs Supplies Type Invariants', () => {
		it('Food Ticket requires meal and succeeds with ready-meal item', () => {
			const input: RequisitionTicketInput = {
				ticket_no: 'TKT-FOOD-1001',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'ครัวกลาง',
				destination_location: 'เต็นท์ A',
				items: [
					{
						item_id: readyMealItem._id,
						item_name: readyMealItem.name,
						category: readyMealItem.category,
						type_class: readyMealItem.type_class,
						returnable: false,
						requested_qty: '100',
						allocated_qty: '100'
					}
				]
			};

			// Eligibility check
			expect(isEligibleDistributionCatalogItem(readyMealItem, 'food')).toBe(true);

			// Contract creation check
			const ticket = createFlow2RequisitionTicket(input, MOCK_CTX);
			expect(ticket.status).toBe('PENDING_PICK');
			expect(ticket.requisition_type).toBe('food');
			expect(ticket.meal).toBe('lunch');
			expect(ticket.requested_by).toBe('staff_test');
			expect(ticket.destination_location).toBe('เต็นท์ A');
		});

		it('Food Ticket fails validation when meal is omitted', () => {
			const input = {
				ticket_no: 'TKT-FOOD-1002',
				requisition_type: 'food' as const,
				source_location: 'ครัวกลาง',
				destination_location: 'เต็นท์ A',
				items: [
					{
						item_id: readyMealItem._id,
						item_name: readyMealItem.name,
						category: readyMealItem.category,
						type_class: readyMealItem.type_class,
						requested_qty: '50',
						allocated_qty: '50'
					}
				]
			};

			expect(() => createFlow2RequisitionTicket(input, MOCK_CTX)).toThrow(
				/Food requisition tickets require meal/
			);
		});

		it('Supplies Ticket succeeds without meal and excludes meal in document', () => {
			const input: RequisitionTicketInput = {
				ticket_no: 'TKT-SUPPLIES-2001',
				requisition_type: 'supplies',
				source_location: 'คลังสินค้า',
				destination_location: 'ศูนย์รับบริจาค',
				items: [
					{
						item_id: blanketItem._id,
						item_name: blanketItem.name,
						category: blanketItem.category,
						type_class: blanketItem.type_class,
						returnable: true,
						requested_qty: '20',
						allocated_qty: '20'
					}
				]
			};

			expect(isEligibleDistributionCatalogItem(blanketItem, 'supplies')).toBe(true);

			const ticket = createFlow2RequisitionTicket(input, MOCK_CTX);
			expect(ticket.status).toBe('PENDING_PICK');
			expect(ticket.requisition_type).toBe('supplies');
			expect(ticket.meal).toBeUndefined();
			expect(ticket.destination_location).toBe('ศูนย์รับบริจาค');
		});

		it('Strictly rejects mixing food categories into Supplies Ticket', () => {
			expect(isEligibleDistributionCatalogItem(readyMealItem, 'supplies')).toBe(false);
			expect(isEligibleDistributionCatalogItem(kitchenFoodItem, 'supplies')).toBe(false);
		});

		it('Strictly rejects kitchen raw ingredients in Food Ticket', () => {
			expect(isEligibleDistributionCatalogItem(kitchenFoodItem, 'food')).toBe(false);
		});
	});

	describe('Item Invariants & Validation', () => {
		it('strictly rejects duplicate item_ids in the same ticket', () => {
			const input: RequisitionTicketInput = {
				ticket_no: 'TKT-FOOD-1003',
				requisition_type: 'food',
				meal: 'breakfast',
				source_location: 'ครัวกลาง',
				destination_location: 'เต็นท์ B',
				items: [
					{
						item_id: readyMealItem._id,
						item_name: readyMealItem.name,
						type_class: 'CONSUMABLE',
						requested_qty: '10',
						allocated_qty: '10'
					},
					{
						item_id: readyMealItem._id,
						item_name: readyMealItem.name,
						type_class: 'CONSUMABLE',
						requested_qty: '20',
						allocated_qty: '20'
					}
				]
			};

			expect(() => createFlow2RequisitionTicket(input, MOCK_CTX)).toThrow(
				/Ticket item_id values must be unique/
			);
		});

		it('strictly requires positive requested_qty', () => {
			const zeroQtyInput = {
				ticket_no: 'TKT-FOOD-1004',
				requisition_type: 'food' as const,
				meal: 'dinner' as const,
				source_location: 'ครัวกลาง',
				destination_location: 'เต็นท์ C',
				items: [
					{
						item_id: readyMealItem._id,
						item_name: readyMealItem.name,
						type_class: 'CONSUMABLE' as const,
						requested_qty: '0',
						allocated_qty: '0'
					}
				]
			};

			expect(() => createFlow2RequisitionTicket(zeroQtyInput, MOCK_CTX)).toThrow();
		});

		it('strictly requires at least one item', () => {
			const emptyItemsInput = {
				ticket_no: 'TKT-FOOD-1005',
				requisition_type: 'food' as const,
				meal: 'dinner' as const,
				source_location: 'ครัวกลาง',
				destination_location: 'เต็นท์ C',
				items: []
			};

			expect(() => createFlow2RequisitionTicket(emptyItemsInput, MOCK_CTX)).toThrow();
		});
	});

	describe('Creation Lifecycle Boundary (Stops strictly at PENDING_PICK)', () => {
		it('created ticket always has status PENDING_PICK and no stock ledger or approvals', () => {
			const input: RequisitionTicketInput = {
				ticket_no: 'TKT-FOOD-1006',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'ครัวกลาง',
				destination_location: 'เต็นท์ D',
				items: [
					{
						item_id: readyMealItem._id,
						item_name: readyMealItem.name,
						type_class: 'CONSUMABLE',
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			};

			const ticket = createFlow2RequisitionTicket(input, MOCK_CTX);
			expect(ticket.status).toBe('PENDING_PICK');
			expect(ticket.approved_by).toBeUndefined();
			expect(ticket.dispatched_by).toBeUndefined();
			expect(ticket.received_by).toBeUndefined();
			expect(ticket.driver_name).toBeUndefined();
			expect(ticket.license_plate).toBeUndefined();
		});

		it('derives requester identity from authenticated context without manual input', () => {
			const input: RequisitionTicketInput = {
				ticket_no: 'TKT-SUPPLIES-2002',
				requisition_type: 'supplies',
				source_location: 'คลังสินค้า',
				destination_location: 'อาคารอเนกประสงค์',
				items: [
					{
						item_id: blanketItem._id,
						item_name: blanketItem.name,
						type_class: 'DURABLE',
						requested_qty: '5',
						allocated_qty: '5'
					}
				]
			};

			const ticket = createFlow2RequisitionTicket(input, MOCK_CTX);
			expect(ticket.requested_by).toBe(MOCK_CTX.createdBy);
		});
	});
});
