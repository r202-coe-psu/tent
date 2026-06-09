import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import {
	checkOutOccupant,
	countCheckedIn,
	createInventoryItem,
	createOccupant,
	createStockTxn,
	deriveQuantities,
	makeShelterConfig,
	type ConfigInput,
	type DispenseInput,
	type InventoryItem,
	type InventoryItemInput,
	type Occupant,
	type ShelterId
} from '../domain/shelter';
import { shelterRepository } from '../data/shelter.pouch';

export const shelterKeys = {
	root: (id: ShelterId) => ['shelter', id] as const,
	config: (id: ShelterId) => [...shelterKeys.root(id), 'config'] as const,
	occupants: (id: ShelterId) => [...shelterKeys.root(id), 'occupants'] as const,
	inventory: (id: ShelterId) => [...shelterKeys.root(id), 'inventory'] as const
};

// ----------------------------------------------------------------- queries

export const useShelterConfig = (id: ShelterId) =>
	createQuery(() => ({
		queryKey: shelterKeys.config(id),
		queryFn: () => shelterRepository(id).getConfig()
	}));

export const useOccupants = (id: ShelterId) =>
	createQuery(() => ({
		queryKey: shelterKeys.occupants(id),
		queryFn: () => shelterRepository(id).listOccupants()
	}));

export interface InventoryRow {
	item: InventoryItem;
	quantity: number;
}

/** Items joined with their derived current quantity (sum of stock txns). */
export const useInventory = (id: ShelterId) =>
	createQuery(() => ({
		queryKey: shelterKeys.inventory(id),
		queryFn: async (): Promise<InventoryRow[]> => {
			const repo = shelterRepository(id);
			const [items, txns] = await Promise.all([repo.listItems(), repo.listTxns()]);
			const qty = deriveQuantities(items, txns);
			return items
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((item) => ({ item, quantity: qty.get(item._id) ?? 0 }));
		}
	}));

// ----------------------------------------------------------------- mutations

export const useSaveConfig = (id: ShelterId) => {
	const qc = useQueryClient();
	return createMutation(() => ({
		mutationFn: async (input: ConfigInput) => {
			const repo = shelterRepository(id);
			const existing = await repo.getConfig();
			const next = makeShelterConfig(id, input);
			await repo.saveConfig(existing ? { ...next, _rev: existing._rev } : next);
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: shelterKeys.config(id) })
	}));
};

export class ShelterFullError extends Error {
	constructor(capacity: number) {
		super(`Shelter is full (capacity ${capacity})`);
		this.name = 'ShelterFullError';
	}
}

export const useCheckIn = (id: ShelterId) => {
	const qc = useQueryClient();
	return createMutation(() => ({
		mutationFn: async (input: Parameters<typeof createOccupant>[0]) => {
			const repo = shelterRepository(id);
			// Capacity guard — enforced here because validate_doc_update cannot read
			// other documents to count current occupants.
			const [config, occupants] = await Promise.all([repo.getConfig(), repo.listOccupants()]);
			const capacity = config?.capacity ?? 0;
			if (countCheckedIn(occupants) >= capacity) throw new ShelterFullError(capacity);
			await repo.saveOccupant(createOccupant(input));
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: shelterKeys.occupants(id) })
	}));
};

export const useCheckOut = (id: ShelterId) => {
	const qc = useQueryClient();
	return createMutation(() => ({
		mutationFn: (occupant: Occupant) =>
			shelterRepository(id).saveOccupant(checkOutOccupant(occupant)),
		onSuccess: () => qc.invalidateQueries({ queryKey: shelterKeys.occupants(id) })
	}));
};

export const useAddItem = (id: ShelterId) => {
	const qc = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: InventoryItemInput) =>
			shelterRepository(id).saveItem(createInventoryItem(input)),
		onSuccess: () => qc.invalidateQueries({ queryKey: shelterKeys.inventory(id) })
	}));
};

/** Dispense (delta < 0) or restock (delta > 0) — both append a stock txn. */
function useStockMovement(id: ShelterId, direction: -1 | 1) {
	const qc = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: DispenseInput & { byUser: string }) =>
			shelterRepository(id).addTxn(
				createStockTxn({
					itemId: input.itemId,
					delta: direction * input.quantity,
					reason: input.reason,
					byUser: input.byUser
				})
			),
		onSuccess: () => qc.invalidateQueries({ queryKey: shelterKeys.inventory(id) })
	}));
}

export const useDispense = (id: ShelterId) => useStockMovement(id, -1);
export const useRestock = (id: ShelterId) => useStockMovement(id, 1);
