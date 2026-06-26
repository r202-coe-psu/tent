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
	): Promise<{ profile: SopMaster; deactivatedPrev: SopMaster | null; audit: AuditEntry | null }> {
		const docs: Array<SopMaster | AuditEntry> = [];
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
		let updatedDeactivatedPrev: SopMaster | null = deactivatedPrev;
		let updatedProfile = profile;
		let updatedAudit: AuditEntry | null = audit;
		for (const res of results) {
			if ('ok' in res && res.ok) {
				if (deactivatedPrev && deactivatedPrev._id === res.id) {
					updatedDeactivatedPrev = { ...deactivatedPrev, _rev: res.rev };
				} else if (profile._id === res.id) {
					updatedProfile = { ...profile, _rev: res.rev };
				} else if (audit && audit._id === res.id) {
					updatedAudit = { ...audit, _rev: res.rev };
				}
			}
		}
		return { profile: updatedProfile, deactivatedPrev: updatedDeactivatedPrev, audit: updatedAudit };
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

	/**
	 * shelterCode is mandatory — no hardcoded default to prevent cross-shelter data leaks.
	 * Pass db explicitly in tests (pouchdb-adapter-memory).
	 */
	constructor(shelterCode: string, db?: PouchDB.Database) {
		if (!shelterCode || shelterCode.trim() === '') {
			throw new Error('SopOverridePouchRepository: shelterCode is mandatory');
		}
		this.db = db ?? namedLocalDb(`shelter_${shelterCode.toLowerCase()}`);
		this.repo = createRepository(this.db);
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
	): Promise<{ profile: SopOverride; deactivatedPrev: SopOverride | null; audit: AuditEntry | null }> {
		const docs: Array<SopOverride | AuditEntry> = [];
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
		let updatedDeactivatedPrev: SopOverride | null = deactivatedPrev;
		let updatedProfile = profile;
		let updatedAudit: AuditEntry | null = audit;
		for (const res of results) {
			if ('ok' in res && res.ok) {
				if (deactivatedPrev && deactivatedPrev._id === res.id) {
					updatedDeactivatedPrev = { ...deactivatedPrev, _rev: res.rev };
				} else if (profile._id === res.id) {
					updatedProfile = { ...profile, _rev: res.rev };
				} else if (audit && audit._id === res.id) {
					updatedAudit = { ...audit, _rev: res.rev };
				}
			}
		}
		return { profile: updatedProfile, deactivatedPrev: updatedDeactivatedPrev, audit: updatedAudit };
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

		const docsToSave: Array<SopOverride | AuditEntry> = [];

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
 *
 * Named `resolveEffectiveRatios` (not `resolveEffective`) to distinguish clearly
 * from the pure-domain `resolveEffectiveProfile` in the barrel export.
 */
export async function resolveEffectiveRatios(
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
/**
 * Per-shelter singleton cache — keyed by shelterCode.
 * Using a Map prevents cross-shelter data leaks where SH001's repo would be
 * returned for SH002 requests when a single shared variable is used.
 */
const overrideSingletons = new Map<string, SopOverrideRepository>();

export function sopMasterRepository(db?: PouchDB.Database): SopMasterRepository {
	if (db) {
		masterSingleton = new SopMasterPouchRepository(db);
	} else if (!masterSingleton) {
		masterSingleton = new SopMasterPouchRepository();
	}
	return masterSingleton;
}

export function sopOverrideRepository(shelterCode: string, db?: PouchDB.Database): SopOverrideRepository {
	if (db) {
		const r = new SopOverridePouchRepository(shelterCode, db);
		overrideSingletons.set(shelterCode, r);
		return r;
	}
	if (!overrideSingletons.has(shelterCode)) {
		overrideSingletons.set(shelterCode, new SopOverridePouchRepository(shelterCode));
	}
	return overrideSingletons.get(shelterCode)!;
}
