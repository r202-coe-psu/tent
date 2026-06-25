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
	): Promise<{ profile: SopOverride; deactivatedPrev: SopOverride | null; audit: AuditEntry | null }>;

	setActive(id: string, ctx?: AuthorContext): Promise<void>;
}
