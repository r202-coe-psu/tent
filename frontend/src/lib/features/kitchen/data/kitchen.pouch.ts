import { namedLocalDb } from '$lib/db/pouch';
import { createRepository, type Repository } from '$lib/db/repository';
import { touch, type AuthorContext } from '$lib/db/model';
import {
	createProductionLog as buildLog,
	isProductionLog,
	type ProductionLog,
	type ProductionLogInput
} from '../domain/kitchen';
import type { KitchenRepository } from './kitchen.repository';

export const SHELTER_CODE = 'SH001';
export const SHELTER_DB = `shelter_${SHELTER_CODE.toLowerCase()}`;

export class KitchenPouchRepository implements KitchenRepository {
	private readonly repo: Repository;

	constructor(dbName: string = SHELTER_DB) {
		this.repo = createRepository(namedLocalDb(dbName));
	}

	createProductionLog(input: ProductionLogInput, ctx: AuthorContext): Promise<ProductionLog> {
		return this.repo.put(buildLog(input, ctx));
	}

	listProductionLogs(): Promise<ProductionLog[]> {
		return this.repo.allByType('production_log', isProductionLog);
	}

	getProductionLog(id: string): Promise<ProductionLog | null> {
		return this.repo.get<ProductionLog>(id);
	}

	updateProductionLog(log: ProductionLog): Promise<ProductionLog> {
		return this.repo.put(touch(log));
	}
}

let singleton: KitchenRepository | null = null;

export function kitchenRepository(): KitchenRepository {
	if (!singleton) singleton = new KitchenPouchRepository();
	return singleton;
}

export function kitchenDb(): PouchDB.Database {
	return namedLocalDb(SHELTER_DB);
}
