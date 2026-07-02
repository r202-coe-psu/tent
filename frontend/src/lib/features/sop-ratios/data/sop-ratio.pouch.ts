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

/**
 * Helper utility to atomic bulk save documents to PouchDB with a retry loop
 * for Multi-Version Concurrency Control (MVCC) document conflict (409) resolution.
 *
 * Technical Trade-offs & Caveats:
 * 1. Whole-Batch Revision Refresh: PouchDB bulkDocs is not transactional-atomic.
 *    If one document in the batch conflicts (409), we refresh the revision (_rev)
 *    of all documents in the batch and retry. This may cause documents that were
 *    successfully written in the previous attempt to be overwritten and get an
 *    unnecessary revision counter bump. This is safe and does not corrupt data.
 * 2. Mixed-Error Masking: If a batch contains both a conflict error (409) and a
 *    different database/validation error, the check for hasConflict will trigger
 *    a retry of the entire batch up to MAX_RETRIES. If it continues failing, it
 *    will report a Document Conflict error message instead of the true validation error.
 */
async function saveBulkAtomic<T extends { _id: string; _rev?: string }>(
	db: PouchDB.Database,
	docs: T[],
	label: string
): Promise<T[]> {
	const MAX_RETRIES = 3;
	let attempts = 0;
	const currentDocs = [...docs];

	while (attempts < MAX_RETRIES) {
		try {
			const results = await db.bulkDocs(currentDocs);
			const errors = results.filter((r) => 'error' in r);

			const hasConflict = errors.some((e: unknown) => {
				const err = e as { status?: number; name?: string; error?: string };
				return err.status === 409 || err.name === 'conflict' || err.error === 'conflict';
			});

			if (hasConflict) {
				throw new Error('409_CONFLICT');
			} else if (errors.length > 0) {
				throw new Error(`Failed to save ${label} atomically: ${JSON.stringify(errors)}`);
			}

			// Map updated revs back
			return currentDocs.map((doc) => {
				const res = results.find((r) => 'ok' in r && r.ok && r.id === doc._id);
				if (res && 'rev' in res) {
					return { ...doc, _rev: res.rev };
				}
				return doc;
			});
		} catch (error: unknown) {
			if (error instanceof Error && error.message === '409_CONFLICT') {
				attempts++;
				if (attempts >= MAX_RETRIES) {
					throw new Error(`Max retries reached due to Document Conflicts (409) in ${label}.`);
				}
				await new Promise((resolve) => setTimeout(resolve, 50 * attempts));

				// Fetch fresh revs for existing documents in currentDocs
				for (let i = 0; i < currentDocs.length; i++) {
					const doc = currentDocs[i];
					try {
						const fresh = await db.get(doc._id);
						currentDocs[i] = { ...doc, _rev: fresh._rev };
					} catch (e) {
						// 404/not found means it's a new document being inserted, no rev yet.
					}
				}
				continue;
			}
			throw error;
		}
	}
	throw new Error(`Unexpected error in saveBulkAtomic for ${label}`);
}

export class SopMasterPouchRepository implements SopMasterRepository {
	private readonly db: PouchDB.Database;
	private readonly repo: Repository;

	constructor(db: PouchDB.Database = namedLocalDb('catalog')) {
		this.db = db;
		this.repo = createRepository(db);
	}

	async listActive(): Promise<SopMaster[]> {
		const db = this.db as PouchDB.Database & {
			find?: (req: object) => Promise<{ docs: unknown[] }>;
		};
		if (typeof db.find === 'function') {
			// TODO(provisioning): Ensure secondary index on ['type', 'active'] is created during DB init per CR-006 §indexes
			try {
				const result = await db.find({
					selector: { type: 'sop_profile', active: true }
				});
				return (result.docs as unknown[]).filter(isSopMaster);
			} catch (error) {
				// Fallback gracefully if find executes but fails due to environment setup
			}
		}

		// Structural Fallback
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
		const docs: Array<SopMaster | AuditEntry> = [profile];
		if (deactivatedPrev) {
			docs.push(deactivatedPrev);
		}
		if (audit) {
			docs.push(audit);
		}

		const saved = await saveBulkAtomic(this.db, docs, 'master versions');

		const updatedProfile = saved.find((d) => d._id === profile._id) as SopMaster;
		const updatedDeactivatedPrev = deactivatedPrev
			? (saved.find((d) => d._id === deactivatedPrev._id) as SopMaster)
			: null;
		const updatedAudit = audit ? (saved.find((d) => d._id === audit._id) as AuditEntry) : null;

		return {
			profile: updatedProfile,
			deactivatedPrev: updatedDeactivatedPrev,
			audit: updatedAudit
		};
	}

	/**
	 * Sets the specified master profile as active and deactivates any other active master profiles.
	 *
	 * Note: `ctx` is optional. If omitted, the status change is written to PouchDB but no
	 * audit entry is generated. In strict audit compliance environments, consider forcing ctx.
	 */
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

		// Only push audit entry if there is actually a profile status change being written.
		if (docsToSave.length > 0 && ctx) {
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
			await saveBulkAtomic(this.db, docsToSave, 'active master');
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
		const db = this.db as PouchDB.Database & {
			find?: (req: object) => Promise<{ docs: unknown[] }>;
		};
		if (typeof db.find === 'function') {
			// TODO(provisioning): Ensure secondary index on ['type', 'active'] is created during DB init per CR-006 §indexes
			try {
				const result = await db.find({
					selector: { type: 'sop_override', active: true }
				});
				return (result.docs as unknown[]).filter(isSopOverride);
			} catch (error) {
				// Fallback gracefully if find executes but fails due to environment setup
			}
		}

		// Structural Fallback
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
	): Promise<{
		profile: SopOverride;
		deactivatedPrev: SopOverride | null;
		audit: AuditEntry | null;
	}> {
		const docs: Array<SopOverride | AuditEntry> = [profile];
		if (deactivatedPrev) {
			docs.push(deactivatedPrev);
		}
		if (audit) {
			docs.push(audit);
		}

		const saved = await saveBulkAtomic(this.db, docs, 'override versions');

		const updatedProfile = saved.find((d) => d._id === profile._id) as SopOverride;
		const updatedDeactivatedPrev = deactivatedPrev
			? (saved.find((d) => d._id === deactivatedPrev._id) as SopOverride)
			: null;
		const updatedAudit = audit ? (saved.find((d) => d._id === audit._id) as AuditEntry) : null;

		return {
			profile: updatedProfile,
			deactivatedPrev: updatedDeactivatedPrev,
			audit: updatedAudit
		};
	}

	/**
	 * Sets the specified override profile as active and deactivates any other active override profiles.
	 *
	 * Note: `ctx` is optional. If omitted, the status change is written to PouchDB but no
	 * audit entry is generated. In strict audit compliance environments, consider forcing ctx.
	 */
	async setActive(id: string, ctx?: AuthorContext): Promise<void> {
		const target = await this.getById(id);
		if (!target) {
			throw new Error(`SOP override with ID ${id} not found`);
		}

		const activeOverrides = await this.listActive();
		const otherActive = activeOverrides.filter((p) => p._id !== target._id);

		const docsToSave: Array<SopOverride | AuditEntry> = [];

		for (const p of otherActive) {
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

		// Only push audit entry if there is actually an override status change being written.
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
			await saveBulkAtomic(this.db, docsToSave, 'active override');
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
	// Master ratios may be a partial set (>=1 key, CR-006/CR-018 #2) if no override is active;
	// override ratios are always the full canonical set.
	ratios: Record<SopRatioKey, number> | Partial<Record<SopRatioKey, number>>;
	ratio_source: 'master' | 'override';
} | null> {
	const activeOverrides = await overrideRepo.listActive();
	const activeMasters = await masterRepo.listActive();

	// 🛡️ Defensive Fallback: ป้องกันกรณี Database เอ๋อแล้วมี Active 2 ตัว
	// โดยการบังคับเรียง version จากมากไปน้อย แล้วหยิบตัวล่าสุด (index 0) เสมอ
	const safeOverride =
		activeOverrides.length > 0
			? [...activeOverrides].sort((a, b) => b.version - a.version)[0]
			: null;

	const safeMaster =
		activeMasters.length > 0 ? [...activeMasters].sort((a, b) => b.version - a.version)[0] : null;

	return resolveDomain(safeOverride, safeMaster);
}

let masterSingleton: SopMasterRepository | null = null;
/**
 * Per-shelter singleton cache — keyed by shelterCode.
 * Using a Map prevents cross-shelter data leaks where SH001's repo would be
 * returned for SH002 requests when a single shared variable is used.
 */
const overrideSingletons = new Map<string, SopOverrideRepository>();

export function sopMasterRepository(): SopMasterRepository {
	if (!masterSingleton) {
		masterSingleton = new SopMasterPouchRepository();
	}
	return masterSingleton;
}

export function clearSopMasterCache(): void {
	masterSingleton = null;
}

export function sopOverrideRepository(shelterCode: string): SopOverrideRepository {
	if (!overrideSingletons.has(shelterCode)) {
		overrideSingletons.set(shelterCode, new SopOverridePouchRepository(shelterCode));
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

// --- Test Helpers (not exported from barrel) ---

export function createSopMasterRepositoryForTest(db: PouchDB.Database): SopMasterPouchRepository {
	return new SopMasterPouchRepository(db);
}

export function createSopOverrideRepositoryForTest(
	shelterCode: string,
	db: PouchDB.Database
): SopOverridePouchRepository {
	return new SopOverridePouchRepository(shelterCode, db);
}
