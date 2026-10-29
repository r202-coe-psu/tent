import { allDocsByIds } from '$lib/db/couch-db';
import { getShelterDb } from '$lib/db/shelter';
import { isVolunteer } from '../domain/volunteer.schema';

/**
 * Name-only projection of a volunteer. The by-ids lookup returns nothing else, so callers that
 * only label a person never hold the rest of the volunteer doc.
 */
export interface VolunteerNameRecord {
	_id: string;
	first_name: string;
	last_name: string;
}

const VOLUNTEER_ID_PREFIX = 'volunteer:';
const KEYS_PER_READ = 100;

/** Distinct `volunteer:` ids, sorted; ids with another prefix are dropped. */
export function uniqueVolunteerIds(ids: readonly string[]): string[] {
	return [...new Set(ids.filter((id) => id.startsWith(VOLUNTEER_ID_PREFIX)))].sort();
}

/**
 * Names of the named volunteers of one shelter, read by id (`_all_docs` keys, chunked) and mapped
 * to name fields before they leave the data layer. Missing, deleted or malformed docs are omitted.
 * `shelterCode` omitted reads the active shelter.
 */
export async function getVolunteerNamesByIds(
	ids: readonly string[],
	shelterCode?: string
): Promise<VolunteerNameRecord[]> {
	const wanted = uniqueVolunteerIds(ids);
	if (wanted.length === 0) return [];
	const db = getShelterDb(shelterCode);
	const chunks: string[][] = [];
	for (let i = 0; i < wanted.length; i += KEYS_PER_READ) {
		chunks.push(wanted.slice(i, i + KEYS_PER_READ));
	}
	const docs = (
		await Promise.all(chunks.map((chunk) => allDocsByIds(db, chunk, isVolunteer)))
	).flat();
	const requested = new Set(wanted);
	return docs
		.filter((doc) => requested.has(doc._id))
		.map((doc) => ({ _id: doc._id, first_name: doc.first_name, last_name: doc.last_name }));
}
