import type { SopMaster, SopOverride, SopRatioKey } from '../domain/sop-ratio';
import type { AuditEntry } from '$lib/features/shared';
import type { AuthorContext } from '$lib/db/model';

export interface SopMasterRepository {
	/** Latest version of every master profile, ordered by display name. */
	listAll(): Promise<SopMaster[]>;
	listActive(): Promise<SopMaster[]>;

	/** Immutable version history for one stable profile slug, newest first. */
	listVersions(slug: string): Promise<SopMaster[]>;

	/** Latest version of one profile, or null when the slug is unknown. */
	getBySlug(slug: string): Promise<SopMaster | null>;

	getById(id: string): Promise<SopMaster | null>;

	listAuditsByTargetIds(ids: string[]): Promise<AuditEntry[]>;

	createVersion(
		deactivatedPrev: SopMaster | null,
		profile: SopMaster,
		audit: AuditEntry | null
	): Promise<{ profile: SopMaster; deactivatedPrev: SopMaster | null; audit: AuditEntry | null }>;

	/** Creates an immutable next revision, retrying a new version number on create conflict. */
	createNextVersion(
		prev: SopMaster,
		changes: Partial<Record<SopRatioKey, string>>,
		reason: string,
		ctx: { createdBy: string }
	): Promise<{ profile: SopMaster; deactivatedPrev: SopMaster | null; audit: AuditEntry | null }>;

	/** Creates version 1 and makes it the one globally active master profile. */
	createInitial(
		name: string,
		ratios: SopMaster['ratios'],
		createdBy: string
	): Promise<{ profile: SopMaster; audit: AuditEntry }>;

	/**
	 * Sets the master profile as active.
	 * Master profiles reside in the catalog DB which lacks a shelter context,
	 * so only `createdBy` is required for the audit entry. (The audit internal logic
	 * will default to shelterCode: 'catalog').
	 */
	setActive(id: string, ctx?: { createdBy: string }): Promise<void>;

	/** Refuses to leave the system without an active master profile. */
	setInactive(id: string, ctx?: { createdBy: string }): Promise<void>;
}

export interface SopOverrideRepository {
	listActive(): Promise<SopOverride[]>;
	listVersions(name: string): Promise<SopOverride[]>;
	getById(id: string): Promise<SopOverride | null>;
	listAuditsByTargetIds(ids: string[]): Promise<AuditEntry[]>;
	createVersion(
		deactivatedPrev: SopOverride | null,
		profile: SopOverride,
		audit: AuditEntry | null
	): Promise<{
		profile: SopOverride;
		deactivatedPrev: SopOverride | null;
		audit: AuditEntry | null;
	}>;
	createNextVersion(
		prev: SopOverride,
		changes: Partial<Record<SopRatioKey, string>>,
		reason: string,
		ctx: AuthorContext
	): Promise<{
		profile: SopOverride;
		deactivatedPrev: SopOverride | null;
		audit: AuditEntry | null;
	}>;

	/**
	 * Sets the override profile as active for the shelter.
	 * Overrides are shelter-specific, requiring the full AuthorContext
	 * (including shelterCode) for proper auditing.
	 */
	setActive(id: string, ctx?: AuthorContext): Promise<void>;

	/**
	 * Deactivates the specified override profile.
	 * When the shelter has no active override, it falls back to the active master profile.
	 */
	setInactive(id: string, ctx?: AuthorContext): Promise<void>;
}
