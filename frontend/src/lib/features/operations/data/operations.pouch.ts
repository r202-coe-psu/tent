import { namedLocalDb } from '$lib/db/pouch';
import { createRepository, type Repository } from '$lib/db/repository';
import { isStockLedger, stockBalance, type StockLedger } from '../domain/operations';
import type { OperationsRepository } from './operations.repository';

export const SHELTER_CODE = 'SH001';
export const SHELTER_DB = `shelter_${SHELTER_CODE.toLowerCase()}`;

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
}

let singleton: OperationsRepository | null = null;

/**
 * Singleton accessor for the operations repository.
 */
export function operationsRepository(): OperationsRepository {
	if (!singleton) singleton = new OperationsPouchRepository();
	return singleton;
}

/**
 * Returns the raw shelter PouchDB database handle for live sync queries.
 */
export function shelterDb(): PouchDB.Database {
	return namedLocalDb(SHELTER_DB);
}
