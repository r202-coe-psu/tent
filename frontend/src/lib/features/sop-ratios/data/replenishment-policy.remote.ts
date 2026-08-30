import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { now } from '$lib/db/model';
import {
	isReplenishmentPolicy,
	type ReplenishmentPolicy,
	type ReplenishmentPolicyInput
} from '../domain/replenishment-policy';

export class ReplenishmentPolicyRemoteRepository {
	private readonly catalogRepo: Repository;

	constructor() {
		this.catalogRepo = createRemoteRepository('catalog');
	}

	private getShelterRepo(shelterCode: string): Repository {
		return createRemoteRepository(`shelter_${shelterCode.toLowerCase()}`);
	}

	async listAll(shelterCode?: string): Promise<ReplenishmentPolicy[]> {
		const baselineDocs = await this.catalogRepo.allByType<ReplenishmentPolicy>(
			'replenishment_policy',
			isReplenishmentPolicy
		);

		if (!shelterCode) {
			return baselineDocs.map((doc) => ({ ...doc, status: doc.status ?? 'active' }));
		}

		try {
			const shelterRepo = this.getShelterRepo(shelterCode);
			const overrideDocs = await shelterRepo.allByType<ReplenishmentPolicy>(
				'replenishment_policy',
				isReplenishmentPolicy
			);

			const effectiveMap = new Map<string, ReplenishmentPolicy>();
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

	async get(id: string, shelterCode?: string): Promise<ReplenishmentPolicy | null> {
		if (shelterCode) {
			try {
				const shelterRepo = this.getShelterRepo(shelterCode);
				const override = await shelterRepo.get<ReplenishmentPolicy>(id);
				if (override && isReplenishmentPolicy(override)) {
					return { ...override, status: override.status ?? 'active' };
				}
			} catch {
				// fallback to catalog
			}
		}
		const baseline = await this.catalogRepo.get<ReplenishmentPolicy>(id);
		if (baseline && isReplenishmentPolicy(baseline)) {
			return { ...baseline, status: baseline.status ?? 'active' };
		}
		return null;
	}

	async save(
		id: string,
		input: ReplenishmentPolicyInput,
		ctx: { createdBy: string; shelterCode?: string }
	): Promise<ReplenishmentPolicy> {
		const isOverride = input.source === 'SHELTER_OVERRIDE' && !!ctx.shelterCode;
		const repo = isOverride ? this.getShelterRepo(ctx.shelterCode!) : this.catalogRepo;

		const existing = await repo.get<ReplenishmentPolicy>(id).catch(() => null);
		const ts = now();

		const docToSave: ReplenishmentPolicy = {
			_id: id,
			...(existing?._rev ? { _rev: existing._rev } : {}),
			type: 'replenishment_policy',
			schema_v: 1,
			scope_type: input.scope_type,
			target_id: input.target_id,
			lead_time_days: Number(input.lead_time_days),
			review_period_days: Number(input.review_period_days),
			safety_days: Number(input.safety_days),
			min_doc_days: Number(input.min_doc_days),
			max_doc_days: Number(input.max_doc_days),
			status: input.status ?? existing?.status ?? 'active',
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
	): Promise<ReplenishmentPolicy | null> {
		const repo = shelterCode ? this.getShelterRepo(shelterCode) : this.catalogRepo;
		const doc = await repo.get<ReplenishmentPolicy>(id);
		if (doc) {
			const updated: ReplenishmentPolicy = {
				...doc,
				status,
				updated_at: now()
			};
			return repo.put(updated);
		}
		return null;
	}
}

let instance: ReplenishmentPolicyRemoteRepository | null = null;
export function replenishmentPolicyRepository(): ReplenishmentPolicyRemoteRepository {
	if (!instance) {
		instance = new ReplenishmentPolicyRemoteRepository();
	}
	return instance;
}
