import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { saveBulkAtomic } from '$lib/db/couch-db';
import { touch, type AuthorContext } from '$lib/db/model';
import { createAuditEntry, type AuditEntry, isAuditEntry } from '$lib/features/shared';
import {
	isSopMaster,
	isSopOverride,
	resolveEffectiveProfile as resolveDomain,
	type SopMaster,
	type SopOverride,
	type SopRatioKey
} from '../domain/sop-ratio';
import type { SopMasterRepository, SopOverrideRepository } from './sop-ratio.repository';

async function fetchAuditsByTargetIds(repo: Repository, ids: string[]): Promise<AuditEntry[]> {
	if (ids.length === 0) return [];
	const chunkSize = 50;
	const results: AuditEntry[] = [];
	for (let i = 0; i < ids.length; i += chunkSize) {
		const chunk = ids.slice(i, i + chunkSize);
		const result = await repo.find<AuditEntry>({
			selector: { type: 'audit', target_id: { $in: chunk } },
			limit: 1000
		});
		results.push(...result.filter(isAuditEntry));
	}
	return results;
}

export class SopMasterRemoteRepository implements SopMasterRepository {
	private readonly dbName: string;
	private readonly repo: Repository;

	constructor(dbName: string = 'catalog') {
		this.dbName = dbName;
		this.repo = createRemoteRepository(dbName);
	}

	async listActive(): Promise<SopMaster[]> {
		const all = await this.repo.allByType('sop_profile', isSopMaster);
		return all.filter((p) => p.active);
	}

	async listVersions(name: string): Promise<SopMaster[]> {
		const results = await this.repo.find<SopMaster>({
			selector: { type: 'sop_profile', name: name },
			limit: 1000
		});
		return results.filter(isSopMaster);
	}

	async getById(id: string): Promise<SopMaster | null> {
		return this.repo.get<SopMaster>(id);
	}

	async listAuditsByTargetIds(ids: string[]): Promise<AuditEntry[]> {
		return fetchAuditsByTargetIds(this.repo, ids);
	}

	async createVersion(
		deactivatedPrev: SopMaster | null,
		profile: SopMaster,
		audit: AuditEntry | null
	): Promise<{ profile: SopMaster; deactivatedPrev: SopMaster | null; audit: AuditEntry | null }> {
		const docs: Array<SopMaster | AuditEntry> = [profile];
		if (deactivatedPrev) docs.push(deactivatedPrev);
		if (audit) docs.push(audit);

		const saved = await saveBulkAtomic(this.dbName, docs, 'master versions');

		return {
			profile: saved.find((d) => d._id === profile._id) as SopMaster,
			deactivatedPrev: deactivatedPrev
				? (saved.find((d) => d._id === deactivatedPrev._id) as SopMaster)
				: null,
			audit: audit ? (saved.find((d) => d._id === audit._id) as AuditEntry) : null
		};
	}

	async setActive(id: string, ctx?: { createdBy: string }): Promise<void> {
		const target = await this.getById(id);
		if (!target) {
			throw new Error(`SOP master profile with ID ${id} not found`);
		}

		const activeProfiles = await this.listActive();
		const sameNameActive = activeProfiles.filter(
			(p) => p.name === target.name && p._id !== target._id
		);

		const docsToSave: Array<SopMaster | AuditEntry> = [];

		for (const p of sameNameActive) {
			docsToSave.push({ ...touch(p), active: false });
		}

		if (!target.active) {
			docsToSave.push({ ...touch(target), active: true });
		}

		if (docsToSave.length > 0 && ctx) {
			const audit = createAuditEntry(
				{
					action: 'manual_adjust',
					target_type: 'sop_profile',
					target_id: target._id,
					reason: `Set version ${target.version} of profile "${target.name}" as active`,
					context: { deactivated_ids: sameNameActive.map((p) => p._id) }
				},
				{ shelterCode: 'catalog', createdBy: ctx.createdBy }
			);
			docsToSave.push(audit);
		}

		if (docsToSave.length > 0) {
			await saveBulkAtomic(this.dbName, docsToSave, 'active master');
		}
	}
}

export class SopOverrideRemoteRepository implements SopOverrideRepository {
	private readonly dbName: string;
	private readonly repo: Repository;

	constructor(shelterCode: string, dbName?: string) {
		if (!shelterCode || shelterCode.trim() === '') {
			throw new Error('SopOverrideRemoteRepository: shelterCode is mandatory');
		}
		this.dbName = dbName ?? `shelter_${shelterCode.toLowerCase()}`;
		this.repo = createRemoteRepository(this.dbName);
	}

	async listActive(): Promise<SopOverride[]> {
		const all = await this.repo.allByType('sop_override', isSopOverride);
		return all.filter((p) => p.active);
	}

	async listVersions(name: string): Promise<SopOverride[]> {
		const results = await this.repo.find<SopOverride>({
			selector: { type: 'sop_override', name: name },
			limit: 1000
		});
		return results.filter(isSopOverride);
	}

	async getById(id: string): Promise<SopOverride | null> {
		return this.repo.get<SopOverride>(id);
	}

	async listAuditsByTargetIds(ids: string[]): Promise<AuditEntry[]> {
		return fetchAuditsByTargetIds(this.repo, ids);
	}

	async createVersion(
		deactivatedPrev: SopOverride | null,
		profile: SopOverride,
		audit: AuditEntry | null
	): Promise<{
		profile: SopOverride;
		deactivatedPrev: SopOverride | null;
		audit: AuditEntry | null;
	}> {
		const docs: Array<SopOverride | AuditEntry> = [profile];
		if (deactivatedPrev) docs.push(deactivatedPrev);
		if (audit) docs.push(audit);

		const saved = await saveBulkAtomic(this.dbName, docs, 'override versions');

		return {
			profile: saved.find((d) => d._id === profile._id) as SopOverride,
			deactivatedPrev: deactivatedPrev
				? (saved.find((d) => d._id === deactivatedPrev._id) as SopOverride)
				: null,
			audit: audit ? (saved.find((d) => d._id === audit._id) as AuditEntry) : null
		};
	}

	async setActive(id: string, ctx?: AuthorContext): Promise<void> {
		const target = await this.getById(id);
		if (!target) {
			throw new Error(`SOP override with ID ${id} not found`);
		}

		const activeOverrides = await this.listActive();
		const otherActive = activeOverrides.filter((p) => p._id !== target._id);

		const docsToSave: Array<SopOverride | AuditEntry> = [];

		for (const p of otherActive) {
			docsToSave.push({ ...touch(p), active: false });
		}

		if (!target.active) {
			docsToSave.push({ ...touch(target), active: true });
		}

		if (docsToSave.length > 0 && ctx) {
			const audit = createAuditEntry(
				{
					action: 'manual_adjust',
					target_type: 'sop_override',
					target_id: target._id,
					reason: `Set version ${target.version} of override "${target.name}" as active`,
					context: {
						deactivated_ids: otherActive.map((p) => p._id),
						base_profile_id: target.base_profile_id
					}
				},
				ctx
			);
			docsToSave.push(audit);
		}

		if (docsToSave.length > 0) {
			await saveBulkAtomic(this.dbName, docsToSave, 'active override');
		}
	}

	async setInactive(id: string, ctx?: AuthorContext): Promise<void> {
		const target = await this.getById(id);
		if (!target) {
			throw new Error(`SOP override with ID ${id} not found`);
		}

		if (target.active) {
			const docsToSave: Array<SopOverride | AuditEntry> = [
				{
					...touch(target),
					active: false
				}
			];

			if (ctx) {
				const audit = createAuditEntry(
					{
						action: 'manual_adjust',
						target_type: 'sop_override',
						target_id: target._id,
						reason: `Deactivate override "${target.name}"`,
						context: {
							base_profile_id: target.base_profile_id
						}
					},
					ctx
				);
				docsToSave.push(audit);
			}

			await saveBulkAtomic(this.dbName, docsToSave, 'deactivate override');
		}
	}
}

export async function resolveEffectiveRatios(
	overrideRepo: SopOverrideRepository,
	masterRepo: SopMasterRepository
): Promise<{
	ratios: Record<SopRatioKey, number> | Partial<Record<SopRatioKey, number>>;
	ratio_source: 'master' | 'override';
} | null> {
	const activeOverrides = await overrideRepo.listActive();
	const activeMasters = await masterRepo.listActive();

	const safeOverride =
		activeOverrides.length > 0
			? [...activeOverrides].sort((a, b) => b.version - a.version)[0]
			: null;

	const safeMaster =
		activeMasters.length > 0 ? [...activeMasters].sort((a, b) => b.version - a.version)[0] : null;

	return resolveDomain(safeOverride, safeMaster);
}

let masterSingleton: SopMasterRepository | null = null;
const overrideSingletons = new Map<string, SopOverrideRepository>();

export function sopMasterRepository(): SopMasterRepository {
	if (!masterSingleton) {
		masterSingleton = new SopMasterRemoteRepository();
	}
	return masterSingleton;
}

export function clearSopMasterCache(): void {
	masterSingleton = null;
}

export function sopOverrideRepository(shelterCode: string): SopOverrideRepository {
	if (!overrideSingletons.has(shelterCode)) {
		overrideSingletons.set(shelterCode, new SopOverrideRemoteRepository(shelterCode));
	}
	return overrideSingletons.get(shelterCode)!;
}

export function clearSopOverrideCache(shelterCode?: string): void {
	if (shelterCode) {
		overrideSingletons.delete(shelterCode);
	} else {
		overrideSingletons.clear();
	}
}

export function createSopMasterRepositoryForTest(dbName: string): SopMasterRemoteRepository {
	return new SopMasterRemoteRepository(dbName);
}

export function createSopOverrideRepositoryForTest(
	shelterCode: string,
	dbName: string
): SopOverrideRemoteRepository {
	return new SopOverrideRemoteRepository(shelterCode, dbName);
}
