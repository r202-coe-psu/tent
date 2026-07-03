import { namedLocalDb } from '$lib/db/pouch';
import { createRepository, type Repository } from '$lib/db/repository';
import { SHELTER_CODE, SHELTER_DB } from '$lib/db/shelter';
import type { AuthorContext } from '$lib/db/model';
import {
	isStockLedger,
	stockBalance,
	createReceiveEntry,
	createDistributeEntry,
	type StockLedger,
	type ReceiveInput,
	type DistributeInput
} from '../domain/operations';
import type { OperationsRepository } from './operations.repository';

export { SHELTER_CODE, SHELTER_DB };

/**
 * PouchDB-backed repository implementation for Operations (Stock Ledger).
 */
export class OperationsPouchRepository implements OperationsRepository {
	private readonly repo: Repository;

	constructor(dbName: string = SHELTER_DB) {
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
		return this.addLedgerEntry(entry);
	}

	async distributeStock(input: DistributeInput, ctx: AuthorContext): Promise<StockLedger> {
		const entry = createDistributeEntry(input, ctx);
		
		// WARNING (C-1): This read-then-write is not atomic. Concurrent distributes
		// may both pass the balance check before either write lands, potentially
		// causing negative stock. Acceptable for single-user shelter scenario;
		// tracked for future hardening.
		const balances = await this.getBalance();
		const currentQty = balances.get(entry.item_id) ?? 0;
		const requestedQty = Math.abs(entry.qty);

		if (currentQty < requestedQty) {
			throw new Error(
				`Insufficient stock for item ${entry.item_id} (requested ${requestedQty}, have ${currentQty})`
			);
		}

		return this.addLedgerEntry(entry);
	}
}

let singleton: OperationsRepository | null = null;

/**
 * Singleton accessor for the operations repository.
 */
export function operationsRepository(): OperationsRepository {
	if (!singleton) singleton = new OperationsPouchRepository();
	return singleton;
}
