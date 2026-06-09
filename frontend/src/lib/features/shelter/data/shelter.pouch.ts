import { namedLocalDb } from '$lib/db/pouch';
import {
	isInventoryItem,
	isOccupant,
	isStockTxn,
	shelterDbName,
	type InventoryItem,
	type Occupant,
	type ShelterConfig,
	type ShelterId,
	type StockTxn
} from '../domain/shelter';
import type { ShelterRepository } from './shelter.repository';

/**
 * PouchDB-backed repository for one shelter. The only file in the feature that
 * knows PouchDB exists. Each shelter maps to its own local DB (`shelter_<id>`),
 * synced to the matching remote CouchDB database.
 */
export class PouchShelterRepository implements ShelterRepository {
	private readonly db: PouchDB.Database;

	constructor(id: ShelterId) {
		this.db = namedLocalDb(shelterDbName(id));
	}

	private async filtered<T>(guard: (d: unknown) => d is T): Promise<T[]> {
		const res = await this.db.allDocs({ include_docs: true });
		return res.rows.map((r) => r.doc as unknown).filter((d): d is T => guard(d));
	}

	async getConfig(): Promise<ShelterConfig | null> {
		try {
			return await this.db.get<ShelterConfig>('config');
		} catch (e) {
			if ((e as { status?: number }).status === 404) return null;
			throw e;
		}
	}

	async saveConfig(config: ShelterConfig): Promise<void> {
		await this.db.put(config as PouchDB.Core.PutDocument<ShelterConfig>);
	}

	listOccupants(): Promise<Occupant[]> {
		return this.filtered<Occupant>(isOccupant);
	}

	async saveOccupant(occupant: Occupant): Promise<void> {
		await this.db.put(occupant as PouchDB.Core.PutDocument<Occupant>);
	}

	listItems(): Promise<InventoryItem[]> {
		return this.filtered<InventoryItem>(isInventoryItem);
	}

	async saveItem(item: InventoryItem): Promise<void> {
		await this.db.put(item as PouchDB.Core.PutDocument<InventoryItem>);
	}

	listTxns(): Promise<StockTxn[]> {
		return this.filtered<StockTxn>(isStockTxn);
	}

	async addTxn(txn: StockTxn): Promise<void> {
		await this.db.put(txn as PouchDB.Core.PutDocument<StockTxn>);
	}
}

const repos = new Map<ShelterId, ShelterRepository>();

/** Memoised repository per shelter — one local PouchDB handle each. */
export function shelterRepository(id: ShelterId): ShelterRepository {
	let repo = repos.get(id);
	if (!repo) {
		repo = new PouchShelterRepository(id);
		repos.set(id, repo);
	}
	return repo;
}
