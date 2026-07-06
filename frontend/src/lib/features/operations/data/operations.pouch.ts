import { namedLocalDb } from '$lib/db/pouch';
import { createRepository, type Repository } from '$lib/db/repository';
import { getShelterDb, shelterDb as _shelterDb } from '$lib/db/shelter';
import type { AuthorContext } from '$lib/db/model';
import {
	isStockLedger,
	stockBalance,
	createReceiveEntry,
	type StockLedger,
	type ReceiveInput
} from '../domain/operations';
import type { OperationsRepository } from './operations.repository';
import { supplyRepository, type SupplyItem } from '$lib/features/supply';

/**
 * Validates a receive entry against its catalog item before it's written to the
 * ledger. Pulled out of `receiveStock` so the invariant is testable directly
 * (plain inputs, no PouchDB) and easy to find when `item_master` eventually
 * replaces `supply_item` (CR-013).
 */
export function assertReceiveAgainstCatalog(entry: StockLedger, item: SupplyItem | null): void {
	if (!item) {
		throw new Error(
			`Unknown item: ${entry.item_id} — item must exist in the catalog before receiving stock`
		);
	}
	if (item.unit !== entry.unit) {
		throw new Error(
			`Unit mismatch for item ${entry.item_id}: expected ${item.unit}, got ${entry.unit}`
		);
	}
	if (item.perishable && !entry.lot?.expiry) {
		throw new Error(`Perishable item ${entry.item_id} requires lot.expiry to be set`);
	}
}

/**
 * PouchDB-backed repository implementation for Operations (Stock Ledger).
 */
export class OperationsPouchRepository implements OperationsRepository {
	private readonly repo: Repository;

	constructor(dbName: string = getShelterDb()) {
		this.repo = createRepository(namedLocalDb(dbName));
	}

	async addLedgerEntry(entry: StockLedger): Promise<StockLedger> {
		return this.repo.put(entry);
	}

	async listLedger(): Promise<StockLedger[]> {
		return this.repo.allByType('stock_ledger', isStockLedger);
	}

	async listLedgerByItem(itemId: string): Promise<StockLedger[]> {
		const ledger = await this.listLedger();
		return ledger.filter((entry) => entry.item_id === itemId);
	}

	async getBalance(): Promise<Map<string, number>> {
		const ledger = await this.listLedger();
		return stockBalance(ledger);
	}

	async receiveStock(input: ReceiveInput, ctx: AuthorContext): Promise<StockLedger> {
		const entry = createReceiveEntry(input, ctx);
		const item = await supplyRepository().getItem(entry.item_id);
		assertReceiveAgainstCatalog(entry, item);
		return this.addLedgerEntry(entry);
	}
}

let singleton: OperationsRepository | null = null;
let singletonDbName: string | null = null;

export function operationsRepository(): OperationsRepository {
	const currentDb = getShelterDb();
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new OperationsPouchRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}
