import { InvalidRatioQtyError } from '../domain/qty-input';
import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { persistQty } from '$lib/utils/qty';
import { now } from '$lib/db/model';
import {
	isRequirementGroup,
	normalizeRequirementGroup,
	REQUIREMENT_GROUP_SCHEMA_VERSION,
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
			return baselineDocs.map(normalizeRequirementGroup);
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
			return Array.from(effectiveMap.values()).map(normalizeRequirementGroup);
		} catch (error) {
			if (error instanceof InvalidRatioQtyError) throw error;
			return baselineDocs.map(normalizeRequirementGroup);
		}
	}

	async get(id: string, shelterCode?: string): Promise<RequirementGroup | null> {
		if (shelterCode) {
			try {
				const shelterRepo = this.getShelterRepo(shelterCode);
				const override = await shelterRepo.get<RequirementGroup>(id);
				if (override && isRequirementGroup(override)) {
					return normalizeRequirementGroup(override);
				}
			} catch (error) {
				if (error instanceof InvalidRatioQtyError) throw error;
				// fallback to catalog
			}
		}
		const baseline = await this.catalogRepo.get<RequirementGroup>(id);
		if (baseline && isRequirementGroup(baseline)) {
			return normalizeRequirementGroup(baseline);
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
			schema_v: REQUIREMENT_GROUP_SCHEMA_VERSION,
			name: input.name,
			standard_uom: input.standard_uom,
			status: input.status ?? existing?.status ?? 'active',
			item_maps: (input.item_maps ?? []).map((m) => ({
				...m,
				conversion_factor: persistQty(m.conversion_factor),
				...(m.share_percent === undefined ? {} : { share_percent: persistQty(m.share_percent) })
			})),
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
