import type { SopMaster, SopOverride } from '../domain/sop-ratio';
import type { AuditEntry } from '$lib/features/shared';
import type { AuthorContext } from '$lib/db/model';

export interface SopMasterRepository {
	listActive(): Promise<SopMaster[]>;

	listVersions(name: string): Promise<SopMaster[]>;

	getById(id: string): Promise<SopMaster | null>;

	createVersion(
		deactivatedPrev: SopMaster | null,
		profile: SopMaster,
		audit: AuditEntry | null
	): Promise<{ profile: SopMaster; deactivatedPrev: SopMaster | null; audit: AuditEntry | null }>;

	/**
	 * Sets the master profile as active.
	 * Master profiles reside in the catalog DB which lacks a shelter context,
	 * so only `createdBy` is required for the audit entry. (The audit internal logic
	 * will default to shelterCode: 'catalog').
	 */
	setActive(id: string, ctx?: { createdBy: string }): Promise<void>;
}

export interface SopOverrideRepository {
	listActive(): Promise<SopOverride[]>;
	listVersions(name: string): Promise<SopOverride[]>;
	getById(id: string): Promise<SopOverride | null>;
	createVersion(
		deactivatedPrev: SopOverride | null,
		profile: SopOverride,
		audit: AuditEntry | null
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
}
