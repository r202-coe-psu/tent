import { createRemoteRepository } from '$lib/db/repository';
import { emitDataChange } from '$lib/db/subscribe-data-changes';
import { getShelterDb } from '$lib/db/shelter';
import {
	PEOPLE_IMPORT_LOG_TYPE,
	isPeopleImportLog,
	type PeopleImportLog
} from '../domain/import-log';

/**
 * `people_import_log` persistence (CR-071 slice A / T-72). Reads and writes the
 * **current shelter's** database directly over HTTP with the user's session
 * cookie (remote-first — same DB and access model as the evacuee documents the
 * log describes, so its names never leave the shelter's scope).
 */

export function importLogDb(): string {
	return getShelterDb();
}

function repo() {
	return createRemoteRepository(importLogDb());
}

export async function writeImportLog(doc: PeopleImportLog): Promise<PeopleImportLog> {
	const saved = await repo().put(doc);
	// Nudge the writer's own UI immediately (the shelter changes feed covers others).
	emitDataChange(importLogDb(), PEOPLE_IMPORT_LOG_TYPE, doc._id);
	return saved;
}

export async function listImportLogs(): Promise<PeopleImportLog[]> {
	const logs = await repo().allByType<PeopleImportLog>(PEOPLE_IMPORT_LOG_TYPE, isPeopleImportLog);
	// ULID ids sort lexicographically by creation time; newest batch first.
	return logs.sort((a, b) => (a._id < b._id ? 1 : -1));
}
