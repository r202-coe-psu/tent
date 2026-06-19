import type { ProductionLog, ProductionLogInput } from '../domain/kitchen';
import type { AuthorContext } from '$lib/db/model';

export interface KitchenRepository {
	createProductionLog(input: ProductionLogInput, ctx: AuthorContext): Promise<ProductionLog>;
	listProductionLogs(): Promise<ProductionLog[]>;
	getProductionLog(id: string): Promise<ProductionLog | null>;
	updateProductionLog(log: ProductionLog): Promise<ProductionLog>;
}
