import type { AuthorContext } from '$lib/db/model';
import type { StockLedger, ReceiveInput } from '../domain/operations';

export interface OperationsRepository {
    addLedgerEntry(entry: StockLedger): Promise<StockLedger>;
    listLedger(): Promise<StockLedger[]>;
    listLedgerByItem(itemId: string): Promise<StockLedger[]>;
    getBalance(): Promise<Map<string, number>>;
    receiveStock(input: ReceiveInput, ctx: AuthorContext): Promise<StockLedger>;
}
