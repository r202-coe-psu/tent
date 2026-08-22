import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { getDoc, getDocWithConflicts, putDoc, saveBulkAtomic } from '$lib/db/couch-db';
import { AppError, ConflictError, SopMasterIntegrityError } from '$lib/utils/errors';
import { touch, type AuthorContext } from '$lib/db/model';
import { createAuditEntry, type AuditEntry, isAuditEntry } from '$lib/features/shared';
import {
	createInitialProfile,
	createNewVersion,
	createProfileSlug,
	isSopMaster,
	isSopOverride,
	resolveEffectiveProfile as resolveDomain,
	SOP_MASTER_ACTIVE_POINTER_ID,
	sopMasterActivePointerSchema,
	sopMasterSchema,
	verifyMasterPointerMatch,
	type SopMaster,
	type SopMasterActivePointer,
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

	async getActivePointer(): Promise<SopMasterActivePointer | null> {
		const doc = await this.repo.get<SopMasterActivePointer>(SOP_MASTER_ACTIVE_POINTER_ID);
		if (!doc) return null;
		const parse = sopMasterActivePointerSchema.safeParse(doc);
		return parse.success ? parse.data : null;
	}

	async listAll(): Promise<SopMaster[]> {
		const all = await this.repo.allByType('sop_profile', isSopMaster);
		const pointer = await this.getActivePointer();
		const activeId = pointer?.active_profile_id;

		const latestBySlug = new Map<string, SopMaster>();
		for (const rawProfile of all) {
			const profile: SopMaster = {
				...rawProfile,
				active: activeId ? rawProfile._id === activeId : rawProfile.active
			};
			const slug = profile.slug ?? createProfileSlug(profile.name);
			const current = latestBySlug.get(slug);
			if (
				!current ||
				(profile.active && !current.active) ||
				(profile.active === current.active && profile.version > current.version)
			) {
				latestBySlug.set(slug, profile);
			}
		}
		return [...latestBySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	async listActive(): Promise<SopMaster[]> {
		const pointer = await this.getActivePointer();
		if (pointer) {
			const profile = await this.getById(pointer.active_profile_id);
			if (profile) return [{ ...profile, active: true }];
			const bySlug = await this.getBySlug(pointer.active_slug);
			if (bySlug) return [{ ...bySlug, active: true }];
			return [];
		}

		// Legacy migration / bootstrap path:
		const all = await this.repo.allByType('sop_profile', isSopMaster);
		const legacyActive = all.filter((p) => p.active);
		if (legacyActive.length === 1) {
			const target = legacyActive[0];
			const pointerDoc: SopMasterActivePointer = {
				_id: SOP_MASTER_ACTIVE_POINTER_ID,
				type: 'sop_profile_active',
				schema_v: 1,
				active_profile_id: target._id,
				active_slug: target.slug ?? createProfileSlug(target.name),
				active_version: target.version,
				updated_at: new Date().toISOString(),
				updated_by: 'system_migration'
			};
			try {
				await putDoc(this.dbName, pointerDoc);
			} catch {
				// Ignore CAS race on bootstrap
			}
			return [{ ...target, active: true }];
		}
		if (legacyActive.length > 1) {
			throw new Error(
				'Multiple active master profiles found without active pointer; manual repair required'
			);
		}
		return [];
	}

	async listVersions(slug: string): Promise<SopMaster[]> {
		const all = await this.repo.allByType('sop_profile', isSopMaster);
		const pointer = await this.getActivePointer();
		const activeId = pointer?.active_profile_id;

		return all
			.filter((profile) => (profile.slug ?? createProfileSlug(profile.name)) === slug)
			.map((profile) => ({
				...profile,
				active: activeId ? profile._id === activeId : profile.active
			}))
			.sort((a, b) => b.version - a.version);
	}

	async getBySlug(slug: string): Promise<SopMaster | null> {
		return (await this.listVersions(slug))[0] ?? null;
	}

	async getById(id: string): Promise<SopMaster | null> {
		const doc = await this.repo.get<SopMaster>(id);
		if (!doc || !isSopMaster(doc)) return null;
		const pointer = await this.getActivePointer();
		return {
			...doc,
			active: pointer ? pointer.active_profile_id === doc._id : doc.active
		};
	}

	async listAuditsByTargetIds(ids: string[]): Promise<AuditEntry[]> {
		return fetchAuditsByTargetIds(this.repo, ids);
	}

	async createVersion(
		deactivatedPrev: SopMaster | null,
		profile: SopMaster,
		audit: AuditEntry | null
	): Promise<{ profile: SopMaster; deactivatedPrev: SopMaster | null; audit: AuditEntry | null }> {
		const draftProfile: SopMaster = { ...profile, active: false };
		const docsToSave: Array<SopMaster | AuditEntry> = [draftProfile];
		if (audit) docsToSave.push(audit);

		const saved = await saveBulkAtomic(this.dbName, docsToSave, 'master versions', undefined, {
			onConflict: 'throw'
		});
		const savedProfile = saved.find((d) => d._id === profile._id) as SopMaster;

		// Single-doc CAS on pointer to promote the new version as active master
		const pointer = await this.getActivePointer();
		const nextPointer: SopMasterActivePointer = {
			_id: SOP_MASTER_ACTIVE_POINTER_ID,
			...(pointer?._rev ? { _rev: pointer._rev } : {}),
			type: 'sop_profile_active',
			schema_v: 1,
			active_profile_id: savedProfile._id,
			active_slug: savedProfile.slug ?? createProfileSlug(savedProfile.name),
			active_version: savedProfile.version,
			updated_at: new Date().toISOString(),
			updated_by: profile.created_by
		};

		try {
			await putDoc(this.dbName, nextPointer, undefined, { onConflict: 'throw' });
		} catch (error) {
			await this.getActivePointer();
			if (error instanceof ConflictError) {
				throw new ConflictError(
					`SOP master version ${savedProfile.version} was saved as draft, but could not be promoted to active master due to concurrent pointer update.`
				);
			}
			if (error instanceof AppError) throw error;
			throw new ConflictError(
				`SOP master version ${savedProfile.version} was saved as draft, but active pointer CAS failed.`
			);
		}

		await this.verifyActiveMasterPromotion(
			savedProfile._id,
			`SOP master version ${savedProfile.version}`
		);

		return {
			profile: { ...savedProfile, active: true },
			deactivatedPrev: null,
			audit: audit ? (saved.find((d) => d._id === audit._id) as AuditEntry) : null
		};
	}

	async createNextVersion(
		prev: SopMaster,
		changes: Partial<Record<SopRatioKey, string>>,
		reason: string,
		ctx: { createdBy: string }
	): Promise<{ profile: SopMaster; deactivatedPrev: SopMaster | null; audit: AuditEntry | null }> {
		const slug = prev.slug ?? createProfileSlug(prev.name);
		const versions = await this.listVersions(slug);
		const currentPrev = versions.find((version) => version._id === prev._id) ?? prev;
		const maxVersion = Math.max(currentPrev.version, ...versions.map((version) => version.version));
		const next = createNewVersion(currentPrev, changes, reason, ctx, maxVersion);

		return await this.createVersion(next.deactivatedPrev, next.profile, next.audit);
	}

	async createInitial(
		name: string,
		ratios: SopMaster['ratios'],
		createdBy: string
	): Promise<{ profile: SopMaster; audit: AuditEntry }> {
		const slug = createProfileSlug(name);
		if (!slug) throw new Error('Profile name must contain at least one Latin letter or number');
		if (await this.getBySlug(slug)) throw new Error('Profile name already exists');

		const { profile, audit } = createInitialProfile('sop_profile', name, ratios, { createdBy });
		const draftProfile: SopMaster = { ...profile, active: false };
		await putDoc(this.dbName, draftProfile);
		await putDoc(this.dbName, audit);

		const pointer = await this.getActivePointer();
		let isFirstActive = false;
		if (!pointer) {
			const nextPointer: SopMasterActivePointer = {
				_id: SOP_MASTER_ACTIVE_POINTER_ID,
				type: 'sop_profile_active',
				schema_v: 1,
				active_profile_id: draftProfile._id,
				active_slug: slug,
				active_version: draftProfile.version,
				updated_at: new Date().toISOString(),
				updated_by: createdBy
			};
			try {
				await putDoc(this.dbName, nextPointer, undefined, {
					onConflict: 'throw'
				});
			} catch (error) {
				await this.getActivePointer();
				if (error instanceof AppError) throw error;
				throw new ConflictError(
					error instanceof Error ? error.message : 'Active pointer creation conflict'
				);
			}

			await this.verifyActiveMasterPromotion(
				draftProfile._id,
				`Initial SOP master profile "${draftProfile.name}"`
			);

			isFirstActive = true;
		}

		return {
			profile: { ...draftProfile, active: isFirstActive },
			audit
		};
	}

	private async verifyActiveMasterPromotion(
		expectedProfileId: string,
		operationContext: string
	): Promise<void> {
		const verifiedMaster = await getVerifiedActiveMaster(this.dbName);

		if (verifiedMaster._id !== expectedProfileId) {
			throw new ConflictError(
				`${operationContext} was saved as a draft, but post-write verification found active pointer targets another profile.`
			);
		}
	}

	async setActive(id: string, ctx?: { createdBy: string }): Promise<void> {
		const target = await this.getById(id);
		if (!target) {
			throw new Error(`SOP master profile with ID ${id} not found`);
		}

		const pointer = await this.getActivePointer();
		const nextPointer: SopMasterActivePointer = {
			_id: SOP_MASTER_ACTIVE_POINTER_ID,
			...(pointer?._rev ? { _rev: pointer._rev } : {}),
			type: 'sop_profile_active',
			schema_v: 1,
			active_profile_id: target._id,
			active_slug: target.slug ?? createProfileSlug(target.name),
			active_version: target.version,
			updated_at: new Date().toISOString(),
			updated_by: ctx?.createdBy ?? 'system'
		};

		try {
			await putDoc(this.dbName, nextPointer, undefined, { onConflict: 'throw' });
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new ConflictError(
				'ไม่สามารถเปลี่ยน Active Profile ได้ เนื่องจากมีการปรับเปลี่ยนโดยผู้ใช้อื่นในระหว่างนี้ (409 Conflict)'
			);
		}

		// Post-write verification: confirm that active pointer targets the intended profile before audit write / success
		await this.verifyActiveMasterPromotion(
			target._id,
			`Active pointer update for SOP master profile ${target._id}`
		);

		if (ctx) {
			const audit = createAuditEntry(
				{
					action: 'manual_adjust',
					target_type: 'sop_profile',
					target_id: target._id,
					reason: `Set version ${target.version} of profile "${target.name}" as active`,
					context: { previous_pointer: pointer?.active_profile_id ?? null }
				},
				{ shelterCode: 'catalog', createdBy: ctx.createdBy }
			);
			await putDoc(this.dbName, audit);
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	async setInactive(_id: string, _ctx?: { createdBy: string }): Promise<void> {
		throw new Error(
			'Cannot deactivate the active master profile directly. Activate another master profile instead.'
		);
	}
}

/**
 * Reads the singleton active pointer (`sop_profile_active:global`), fetches its target profile,
 * and strictly verifies their alignment (id, slug, version, Zod schemas).
 * Throws `SopMasterIntegrityError` if any check fails.
 */
export async function getVerifiedActiveMaster(
	catalogDbName: string = 'catalog'
): Promise<SopMaster> {
	// 1. Fetch raw pointer document with conflict metadata
	const rawPointer = await getDocWithConflicts<{ _id: string }>(
		catalogDbName,
		SOP_MASTER_ACTIVE_POINTER_ID
	);
	if (!rawPointer) {
		throw new SopMasterIntegrityError(
			'pointer_missing',
			'Active master pointer document is missing (sop_profile_active:global)'
		);
	}

	// Detect unresolved CouchDB conflicts
	if (
		typeof rawPointer === 'object' &&
		rawPointer !== null &&
		Array.isArray((rawPointer as { _conflicts?: unknown[] })._conflicts) &&
		(rawPointer as { _conflicts?: unknown[] })._conflicts!.length > 0
	) {
		throw new SopMasterIntegrityError(
			'pointer_conflicted',
			'Active master pointer document (sop_profile_active:global) has unresolved CouchDB conflicts'
		);
	}

	// 2. Validate pointer shape
	const pointerParse = sopMasterActivePointerSchema.safeParse(rawPointer);
	if (!pointerParse.success) {
		throw new SopMasterIntegrityError(
			'pointer_malformed',
			'Active master pointer document (sop_profile_active:global) is malformed',
			pointerParse.error
		);
	}
	const pointer = pointerParse.data;

	// 3. Fetch target profile document
	const rawProfile = await getDoc<{ _id: string }>(catalogDbName, pointer.active_profile_id);
	if (!rawProfile) {
		throw new SopMasterIntegrityError(
			'profile_missing',
			`Target active SOP master profile (${pointer.active_profile_id}) is missing`
		);
	}

	// 4. Validate profile shape
	const profileParse = sopMasterSchema.safeParse(rawProfile);
	if (!profileParse.success) {
		throw new SopMasterIntegrityError(
			'profile_malformed',
			`Target active SOP master profile (${pointer.active_profile_id}) is malformed`,
			profileParse.error
		);
	}
	const profile = profileParse.data;

	// 5. Verify triple identity alignment: id, slug, version
	const match = verifyMasterPointerMatch(pointer, profile);
	if (!match.ok) {
		throw new SopMasterIntegrityError('pointer_target_mismatch', match.message);
	}

	return { ...profile, active: true };
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

	async createNextVersion(
		prev: SopOverride,
		changes: Partial<Record<SopRatioKey, string>>,
		reason: string,
		ctx: AuthorContext
	): Promise<{
		profile: SopOverride;
		deactivatedPrev: SopOverride | null;
		audit: AuditEntry | null;
	}> {
		const next = createNewVersion(prev, changes, reason, ctx);
		return await this.createVersion(next.deactivatedPrev, next.profile, next.audit);
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
	ratios: Record<SopRatioKey, string> | Partial<Record<SopRatioKey, string>>;
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
