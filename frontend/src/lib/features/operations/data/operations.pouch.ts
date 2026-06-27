import { namedLocalDb } from '$lib/db/pouch';
import { createRepository, type Repository } from '$lib/db/repository';
import { SHELTER_CODE, SHELTER_DB, shelterDb as _shelterDb } from '$lib/db/shelter';
import type { AuthorContext } from '$lib/db/model';
import {
    isStockLedger,
    stockBalance,
    createStockLedger,
    receiveInputSchema,
    type StockLedger,
    type ReceiveInput
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
        const d = receiveInputSchema.parse(input);
        const entry = createStockLedger({ ...d, reason: 'receive' }, ctx);
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

export const shelterDb = _shelterDb;
