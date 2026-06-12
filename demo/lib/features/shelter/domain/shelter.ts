import { z } from 'zod';

/**
 * Shelter demo domain. Pure — knows nothing about PouchDB/CouchDB.
 * Each shelter is an isolated CouchDB database (`shelter_a` / `_b` / `_c`);
 * the documents below all live inside one shelter's database.
 */

export const SHELTER_IDS = ['A', 'B', 'C'] as const;
export type ShelterId = (typeof SHELTER_IDS)[number];

export type ShelterRole = 'manager' | 'volunteer';

/** CouchDB database name for a shelter, e.g. "A" -> "shelter_a". */
export function shelterDbName(id: ShelterId): string {
	return `shelter_${id.toLowerCase()}`;
}

/** CouchDB role strings, e.g. "A" + "manager" -> "shelter_a_manager". */
export function shelterRole(id: ShelterId, role: ShelterRole): string {
	return `shelter_${id.toLowerCase()}_${role}`;
}

export interface ShelterAccess {
	id: ShelterId;
	role: ShelterRole;
}

const ROLE_RE = /^shelter_([abc])_(manager|volunteer)$/;

/** Resolve which shelters (and at what role) a userCtx can access from its roles. */
export function parseAccessibleShelters(roles: string[]): ShelterAccess[] {
	// CouchDB server admins can read/write every database and bypass
	// validate_doc_update, so surface all shelters at manager level.
	if (roles.includes('_admin')) {
		return SHELTER_IDS.map((id) => ({ id, role: 'manager' as const }));
	}

	const access = new Map<ShelterId, ShelterRole>();
	for (const r of roles) {
		const m = ROLE_RE.exec(r);
		if (!m) continue;
		const id = m[1].toUpperCase() as ShelterId;
		const role = m[2] as ShelterRole;
		// manager outranks volunteer if both somehow present
		if (access.get(id) !== 'manager') access.set(id, role);
	}
	return SHELTER_IDS.filter((id) => access.has(id)).map((id) => ({ id, role: access.get(id)! }));
}

// ---------------------------------------------------------------- documents

export interface ShelterConfig {
	_id: 'config';
	_rev?: string;
	type: 'shelter_config';
	shelterId: ShelterId;
	name: string;
	capacity: number;
}

export interface Occupant {
	_id: string;
	_rev?: string;
	type: 'occupant';
	name: string;
	note: string;
	status: 'in' | 'out';
	checkInAt: string;
	checkOutAt?: string;
}

export interface InventoryItem {
	_id: string;
	_rev?: string;
	type: 'inventory_item';
	name: string;
	unit: string;
}

/**
 * Event-sourced stock movement. Current quantity of an item is the SUM of all
 * its txn deltas — never stored on the item — so concurrent offline edits merge
 * without update conflicts. delta < 0 = dispense, delta > 0 = restock.
 */
export interface StockTxn {
	_id: string;
	_rev?: string;
	type: 'stock_txn';
	itemId: string;
	delta: number;
	reason: string;
	byUser: string;
	at: string;
}

export type ShelterDoc = ShelterConfig | Occupant | InventoryItem | StockTxn;

// ---------------------------------------------------------------- input schemas

export const occupantInputSchema = z.object({
	name: z.string().trim().min(1, 'Name is required'),
	note: z.string().trim().default('')
});
export type OccupantInput = z.infer<typeof occupantInputSchema>;

export const inventoryItemInputSchema = z.object({
	name: z.string().trim().min(1, 'Item name is required'),
	unit: z.string().trim().min(1, 'Unit is required')
});
export type InventoryItemInput = z.infer<typeof inventoryItemInputSchema>;

export const dispenseInputSchema = z.object({
	itemId: z.string().min(1, 'Item is required'),
	quantity: z.coerce.number().int().positive('Quantity must be a positive integer'),
	reason: z.string().trim().default('')
});
export type DispenseInput = z.infer<typeof dispenseInputSchema>;

export const restockInputSchema = dispenseInputSchema;
export type RestockInput = DispenseInput;

export const configInputSchema = z.object({
	name: z.string().trim().min(1, 'Name is required'),
	capacity: z.coerce.number().int().nonnegative('Capacity cannot be negative')
});
export type ConfigInput = z.infer<typeof configInputSchema>;

// ---------------------------------------------------------------- factories

export function createOccupant(input: OccupantInput): Occupant {
	const data = occupantInputSchema.parse(input);
	return {
		_id: `occupant:${crypto.randomUUID()}`,
		type: 'occupant',
		name: data.name,
		note: data.note,
		status: 'in',
		checkInAt: new Date().toISOString()
	};
}

export function checkOutOccupant(occ: Occupant): Occupant {
	return { ...occ, status: 'out', checkOutAt: new Date().toISOString() };
}

export function createInventoryItem(input: InventoryItemInput): InventoryItem {
	const data = inventoryItemInputSchema.parse(input);
	return {
		_id: `item:${crypto.randomUUID()}`,
		type: 'inventory_item',
		name: data.name,
		unit: data.unit
	};
}

export function createStockTxn(input: {
	itemId: string;
	delta: number;
	reason: string;
	byUser: string;
}): StockTxn {
	return {
		_id: `txn:${crypto.randomUUID()}`,
		type: 'stock_txn',
		itemId: input.itemId,
		delta: input.delta,
		reason: input.reason,
		byUser: input.byUser,
		at: new Date().toISOString()
	};
}

export function makeShelterConfig(id: ShelterId, input: ConfigInput): ShelterConfig {
	const data = configInputSchema.parse(input);
	return {
		_id: 'config',
		type: 'shelter_config',
		shelterId: id,
		name: data.name,
		capacity: data.capacity
	};
}

// ---------------------------------------------------------------- type guards

export const isShelterConfig = (d: unknown): d is ShelterConfig =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'shelter_config';
export const isOccupant = (d: unknown): d is Occupant =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'occupant';
export const isInventoryItem = (d: unknown): d is InventoryItem =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'inventory_item';
export const isStockTxn = (d: unknown): d is StockTxn =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'stock_txn';

// ---------------------------------------------------------------- derived

/** Occupants currently checked in. */
export function countCheckedIn(occupants: Occupant[]): number {
	return occupants.filter((o) => o.status === 'in').length;
}

/** Current quantity of each item = sum of its txn deltas. Returns id -> qty. */
export function deriveQuantities(items: InventoryItem[], txns: StockTxn[]): Map<string, number> {
	const qty = new Map<string, number>();
	for (const item of items) qty.set(item._id, 0);
	for (const t of txns) qty.set(t.itemId, (qty.get(t.itemId) ?? 0) + t.delta);
	return qty;
}
