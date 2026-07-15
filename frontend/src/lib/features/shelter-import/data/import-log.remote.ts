import { createRemoteRepository } from '$lib/db/repository';
import { emitDataChange } from '$lib/db/subscribe-data-changes';
import {
	SHELTER_IMPORT_LOG_TYPE,
	isShelterImportLog,
	type ShelterImportLog
} from '../domain/import-log';

/**
 * `shelter_import_log` persistence (CR-039). Reads/writes the `registry` DB
 * directly over HTTP (remote-first — same DB and access model as the shelter
 * registry master). System-admin only; the import route guards on `requireAdmin`.
 */

export const IMPORT_LOG_REGISTRY_DB = 'registry';

function repo() {
	return createRemoteRepository(IMPORT_LOG_REGISTRY_DB);
}

export async function writeImportLog(doc: ShelterImportLog): Promise<ShelterImportLog> {
	const saved = await repo().put(doc);
	// Nudge the writer's own UI immediately (registry changes feed covers others).
	emitDataChange(IMPORT_LOG_REGISTRY_DB, SHELTER_IMPORT_LOG_TYPE, doc._id);
	return saved;
}

export async function listImportLogs(): Promise<ShelterImportLog[]> {
	const logs = await repo().allByType<ShelterImportLog>(
		SHELTER_IMPORT_LOG_TYPE,
		isShelterImportLog
	);
	// ULID ids sort lexicographically by creation time; newest batch first.
	return logs.sort((a, b) => (a._id < b._id ? 1 : -1));
}
