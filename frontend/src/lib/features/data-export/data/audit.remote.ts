import { createRemoteRepository } from '$lib/db/repository';
import { getShelterDb } from '$lib/db/shelter';
import type { AuditEntry } from '$lib/features/shared';

/** Persist one audit doc into `shelter_{code}` (CR-232 FR-40). Rejects when the write fails. */
export async function putAuditEntry(shelterCode: string, entry: AuditEntry): Promise<void> {
	await createRemoteRepository(getShelterDb(shelterCode)).put(entry);
}
