import { namedLocalDb } from '$lib/db/pouch';
import { createRepository, type Repository } from '$lib/db/repository';
import { touch, type AuthorContext } from '$lib/db/model';
import { createAuditEntry, type AuditEntry } from '$lib/features/shared';
import {
	isSopMaster,
	isSopOverride,
	resolveEffectiveProfile as resolveDomain,
	type SopMaster,
	type SopOverride,
	type SopRatioKey
} from '../domain/sop-ratio';
import type { SopMasterRepository, SopOverrideRepository } from './sop-ratio.repository';

export class SopMasterPouchRepository implements SopMasterRepository {
	private readonly db: PouchDB.Database;
	private readonly repo: Repository;

	constructor(db: PouchDB.Database = namedLocalDb('catalog')) {
		this.db = db;
		this.repo = createRepository(db);
	}

	async listActive(): Promise<SopMaster[]> {
		const all = await this.repo.allByType('sop_profile', isSopMaster);
		return all.filter((p) => p.active);
	}

	async listVersions(name: string): Promise<SopMaster[]> {
		const all = await this.repo.allByType('sop_profile', isSopMaster);
		return all.filter((p) => p.name === name);
	}

	async getById(id: string): Promise<SopMaster | null> {
		return this.repo.get<SopMaster>(id);
	}

	async createVersion(
		deactivatedPrev: SopMaster | null,
		profile: SopMaster,
		audit: AuditEntry | null
	): Promise<void> {
		const docs: any[] = [];
		if (deactivatedPrev) {
			docs.push(deactivatedPrev);
		}
		docs.push(profile);
		if (audit) {
			docs.push(audit);
		}
		const results = await this.db.bulkDocs(docs);
		const errors = results.filter((r) => 'error' in r);
		if (errors.length > 0) {
			throw new Error(`Failed to save master versions atomically: ${JSON.stringify(errors)}`);
		}
		for (const res of results) {
			if ('ok' in res && res.ok) {
				if (deactivatedPrev && deactivatedPrev._id === res.id) {
					deactivatedPrev._rev = res.rev;
				} else if (profile._id === res.id) {
					profile._rev = res.rev;
				} else if (audit && audit._id === res.id) {
					audit._rev = res.rev;
				}
			}
		}
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

		const docsToSave: any[] = [];

		for (const p of sameNameActive) {
			docsToSave.push({
				...touch(p),
				active: false
			});
		}

		if (!target.active) {
			docsToSave.push({
				...touch(target),
				active: true
			});
		}

		if (ctx) {
			const audit = createAuditEntry(
				{
					action: 'manual_adjust',
					target_type: 'sop_profile',
					target_id: target._id,
					reason: `Set version ${target.version} of profile "${target.name}" as active`,
					context: {
						deactivated_ids: sameNameActive.map((p) => p._id)
					}
				},
				{ shelterCode: 'catalog', createdBy: ctx.createdBy }
			);
			docsToSave.push(audit);
		}

		if (docsToSave.length > 0) {
			const results = await this.db.bulkDocs(docsToSave);
			const errors = results.filter((r) => 'error' in r);
			if (errors.length > 0) {
				throw new Error(`Failed to set active master atomically: ${JSON.stringify(errors)}`);
			}
		}
	}
}

export class SopOverridePouchRepository implements SopOverrideRepository {
	private readonly db: PouchDB.Database;
	private readonly repo: Repository;

	constructor(db: PouchDB.Database = namedLocalDb('shelter_sh001')) {
		this.db = db;
		this.repo = createRepository(db);
	}

	async listActive(): Promise<SopOverride[]> {
		const all = await this.repo.allByType('sop_override', isSopOverride);
		return all.filter((p) => p.active);
	}

	async listVersions(name: string): Promise<SopOverride[]> {
		const all = await this.repo.allByType('sop_override', isSopOverride);
		return all.filter((p) => p.name === name);
	}

	async getById(id: string): Promise<SopOverride | null> {
		return this.repo.get<SopOverride>(id);
	}

	async createVersion(
		deactivatedPrev: SopOverride | null,
		profile: SopOverride,
		audit: AuditEntry | null
	): Promise<void> {
		const docs: any[] = [];
		if (deactivatedPrev) {
			docs.push(deactivatedPrev);
		}
		docs.push(profile);
		if (audit) {
			docs.push(audit);
		}
		const results = await this.db.bulkDocs(docs);
		const errors = results.filter((r) => 'error' in r);
		if (errors.length > 0) {
			throw new Error(`Failed to save override versions atomically: ${JSON.stringify(errors)}`);
		}
		for (const res of results) {
			if ('ok' in res && res.ok) {
				if (deactivatedPrev && deactivatedPrev._id === res.id) {
					deactivatedPrev._rev = res.rev;
				} else if (profile._id === res.id) {
					profile._rev = res.rev;
				} else if (audit && audit._id === res.id) {
					audit._rev = res.rev;
				}
			}
		}
	}

	async setActive(id: string, ctx?: AuthorContext): Promise<void> {
		const target = await this.getById(id);
		if (!target) {
			throw new Error(`SOP override with ID ${id} not found`);
		}

		const activeOverrides = await this.listActive();
		const sameNameActive = activeOverrides.filter(
			(p) => p.name === target.name && p._id !== target._id
		);

		const docsToSave: any[] = [];

		for (const p of sameNameActive) {
			docsToSave.push({
				...touch(p),
				active: false
			});
		}

		if (!target.active) {
			docsToSave.push({
				...touch(target),
				active: true
			});
		}

		if (ctx) {
			const audit = createAuditEntry(
				{
					action: 'manual_adjust',
					target_type: 'sop_override',
					target_id: target._id,
					reason: `Set version ${target.version} of override "${target.name}" as active`,
					context: {
						deactivated_ids: sameNameActive.map((p) => p._id),
						base_profile_id: target.base_profile_id
					}
				},
				ctx
			);
			docsToSave.push(audit);
		}

		if (docsToSave.length > 0) {
			const results = await this.db.bulkDocs(docsToSave);
			const errors = results.filter((r) => 'error' in r);
			if (errors.length > 0) {
				throw new Error(`Failed to set active override atomically: ${JSON.stringify(errors)}`);
			}
		}
	}
}

/**
 * Resolves the effective profile ratios at the application/data layer.
 * Pulls the active override and the active master, then resolves them.
 */
export async function resolveEffective(
	overrideRepo: SopOverrideRepository,
	masterRepo: SopMasterRepository
): Promise<{
	ratios: Partial<Record<SopRatioKey, number>>;
	ratio_source: 'master' | 'override';
} | null> {
	const activeOverrides = await overrideRepo.listActive();
	const activeMasters = await masterRepo.listActive();
	return resolveDomain(activeOverrides[0] || null, activeMasters[0] || null);
}

let masterSingleton: SopMasterRepository | null = null;
let overrideSingleton: SopOverrideRepository | null = null;

export function sopMasterRepository(db?: PouchDB.Database): SopMasterRepository {
	if (db) return new SopMasterPouchRepository(db);
	if (!masterSingleton) masterSingleton = new SopMasterPouchRepository();
	return masterSingleton;
}

export function sopOverrideRepository(db?: PouchDB.Database): SopOverrideRepository {
	if (db) return new SopOverridePouchRepository(db);
	if (!overrideSingleton) overrideSingleton = new SopOverridePouchRepository();
	return overrideSingleton;
}
