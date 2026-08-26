import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { now } from '$lib/db/model';
import {
	isFoodSphereStandard,
	type FoodSphereStandard,
	type FoodSphereStandardInput
} from '../domain/food-sphere';

export class FoodSphereRemoteRepository {
	private readonly catalogRepo: Repository;

	constructor() {
		this.catalogRepo = createRemoteRepository('catalog');
	}

	private getShelterRepo(shelterCode: string): Repository {
		return createRemoteRepository(`shelter_${shelterCode.toLowerCase()}`);
	}

	async listAll(shelterCode?: string): Promise<FoodSphereStandard[]> {
		const baselineDocs = await this.catalogRepo.allByType<FoodSphereStandard>(
			'food_sphere_standard',
			isFoodSphereStandard
		);

		if (!shelterCode) {
			return baselineDocs;
		}

		try {
			const shelterRepo = this.getShelterRepo(shelterCode);
			const overrideDocs = await shelterRepo.allByType<FoodSphereStandard>(
				'food_sphere_standard',
				isFoodSphereStandard
			);

			const effectiveMap = new Map<string, FoodSphereStandard>();
			for (const b of baselineDocs) {
				effectiveMap.set(b._id, b);
			}
			for (const o of overrideDocs) {
				effectiveMap.set(o._id, o);
			}
			return Array.from(effectiveMap.values());
		} catch {
			return baselineDocs;
		}
	}

	async get(id: string, shelterCode?: string): Promise<FoodSphereStandard | null> {
		if (shelterCode) {
			try {
				const shelterRepo = this.getShelterRepo(shelterCode);
				const override = await shelterRepo.get<FoodSphereStandard>(id);
				if (override && isFoodSphereStandard(override)) return override;
			} catch {
				// fallback to catalog
			}
		}
		const baseline = await this.catalogRepo.get<FoodSphereStandard>(id);
		if (baseline && isFoodSphereStandard(baseline)) return baseline;
		return null;
	}

	async save(
		id: string,
		input: FoodSphereStandardInput,
		ctx: { createdBy: string; shelterCode?: string }
	): Promise<FoodSphereStandard> {
		const isOverride = input.source === 'SHELTER_OVERRIDE' && !!ctx.shelterCode;
		const repo = isOverride ? this.getShelterRepo(ctx.shelterCode!) : this.catalogRepo;

		const existing = await repo.get<FoodSphereStandard>(id).catch(() => null);
		const ts = now();

		const docToSave: FoodSphereStandard = {
			_id: id,
			...(existing?._rev ? { _rev: existing._rev } : {}),
			type: 'food_sphere_standard',
			schema_v: 1,
			target_segment: input.target_segment,
			req_group_id: input.req_group_id,
			daily_demand: Number(input.daily_demand),
			standard_uom: input.standard_uom,
			effective_date: input.effective_date,
			source: isOverride ? 'SHELTER_OVERRIDE' : 'SPHERE_BASELINE',
			...(isOverride ? { shelter_code: ctx.shelterCode } : {}),
			created_at: existing?.created_at ?? ts,
			updated_at: ts,
			created_by: existing?.created_by ?? ctx.createdBy
		};

		return repo.put(docToSave);
	}

	async delete(id: string, shelterCode?: string): Promise<void> {
		const repo = shelterCode ? this.getShelterRepo(shelterCode) : this.catalogRepo;
		const doc = await repo.get<FoodSphereStandard>(id);
		if (doc) {
			await repo.remove(doc);
		}
	}
}

let instance: FoodSphereRemoteRepository | null = null;
export function foodSphereRepository(): FoodSphereRemoteRepository {
	if (!instance) {
		instance = new FoodSphereRemoteRepository();
	}
	return instance;
}
