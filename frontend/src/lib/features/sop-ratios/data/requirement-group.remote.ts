import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { now } from '$lib/db/model';
import {
	isRequirementGroup,
	type RequirementGroup,
	type RequirementGroupInput
} from '../domain/requirement-group';

export class RequirementGroupRemoteRepository {
	private readonly catalogRepo: Repository;

	constructor() {
		this.catalogRepo = createRemoteRepository('catalog');
	}

	private getShelterRepo(shelterCode: string): Repository {
		return createRemoteRepository(`shelter_${shelterCode.toLowerCase()}`);
	}

	async listAll(shelterCode?: string): Promise<RequirementGroup[]> {
		const baselineDocs = await this.catalogRepo.allByType<RequirementGroup>(
			'requirement_group',
			isRequirementGroup
		);

		if (!shelterCode) {
			return baselineDocs.map((doc) => ({ ...doc, status: doc.status ?? 'active' }));
		}

		try {
			const shelterRepo = this.getShelterRepo(shelterCode);
			const overrideDocs = await shelterRepo.allByType<RequirementGroup>(
				'requirement_group',
				isRequirementGroup
			);

			const effectiveMap = new Map<string, RequirementGroup>();
			for (const b of baselineDocs) {
				effectiveMap.set(b._id, b);
			}
			for (const o of overrideDocs) {
				effectiveMap.set(o._id, o);
			}
			return Array.from(effectiveMap.values()).map((doc) => ({
				...doc,
				status: doc.status ?? 'active'
			}));
		} catch {
			return baselineDocs.map((doc) => ({ ...doc, status: doc.status ?? 'active' }));
		}
	}

	async get(id: string, shelterCode?: string): Promise<RequirementGroup | null> {
		if (shelterCode) {
			try {
				const shelterRepo = this.getShelterRepo(shelterCode);
				const override = await shelterRepo.get<RequirementGroup>(id);
				if (override && isRequirementGroup(override)) {
					return { ...override, status: override.status ?? 'active' };
				}
			} catch {
				// fallback to catalog
			}
		}
		const baseline = await this.catalogRepo.get<RequirementGroup>(id);
		if (baseline && isRequirementGroup(baseline)) {
			return { ...baseline, status: baseline.status ?? 'active' };
		}
		return null;
	}

	async save(
		id: string,
		input: RequirementGroupInput,
		ctx: { createdBy: string; shelterCode?: string }
	): Promise<RequirementGroup> {
		const isOverride = input.source === 'SHELTER_OVERRIDE' && !!ctx.shelterCode;
		const repo = isOverride ? this.getShelterRepo(ctx.shelterCode!) : this.catalogRepo;

		const existing = await repo.get<RequirementGroup>(id).catch(() => null);
		const ts = now();

		const docToSave: RequirementGroup = {
			_id: id,
			...(existing?._rev ? { _rev: existing._rev } : {}),
			type: 'requirement_group',
			schema_v: 1,
			name: input.name,
			standard_uom: input.standard_uom,
			status: input.status ?? existing?.status ?? 'active',
			item_maps: input.item_maps ?? [],
			source: isOverride ? 'SHELTER_OVERRIDE' : 'SPHERE_BASELINE',
			...(isOverride ? { shelter_code: ctx.shelterCode } : {}),
			created_at: existing?.created_at ?? ts,
			updated_at: ts,
			created_by: existing?.created_by ?? ctx.createdBy
		};

		return repo.put(docToSave);
	}

	async delete(id: string, shelterCode?: string): Promise<void> {
		await this.setStatus(id, 'inactive', shelterCode);
	}

	async setStatus(
		id: string,
		status: 'active' | 'inactive',
		shelterCode?: string
	): Promise<RequirementGroup | null> {
		const repo = shelterCode ? this.getShelterRepo(shelterCode) : this.catalogRepo;
		const doc = await repo.get<RequirementGroup>(id);
		if (doc) {
			const updated: RequirementGroup = {
				...doc,
				status,
				updated_at: now()
			};
			return repo.put(updated);
		}
		return null;
	}
}

let instance: RequirementGroupRemoteRepository | null = null;
export function requirementGroupRepository(): RequirementGroupRemoteRepository {
	if (!instance) {
		instance = new RequirementGroupRemoteRepository();
	}
	return instance;
}
