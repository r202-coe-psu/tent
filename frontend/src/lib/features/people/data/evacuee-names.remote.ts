import { allDocsByIds } from '$lib/db/couch-db';
import { getShelterDb } from '$lib/db/shelter';
import { isEvacuee } from '../domain/people';

/**
 * Name-only projection of an evacuee. The by-ids lookup returns nothing else, so callers that
 * only label a person never hold the rest of the evacuee doc.
 */
export interface EvacueeNameRecord {
	_id: string;
	first_name: string;
	last_name: string;
	nickname?: string;
}

const EVACUEE_ID_PREFIX = 'evacuee:';
const KEYS_PER_READ = 100;

/** Distinct `evacuee:` ids, sorted; ids with another prefix are dropped. */
export function uniqueEvacueeIds(ids: readonly string[]): string[] {
	return [...new Set(ids.filter((id) => id.startsWith(EVACUEE_ID_PREFIX)))].sort();
}

/**
 * Names of the named evacuees of one shelter, read by id (`_all_docs` keys, chunked) and mapped to
 * name fields before they leave the data layer. Missing, deleted or malformed docs are omitted.
 * `shelterCode` omitted reads the active shelter.
 */
export async function getEvacueeNamesByIds(
	ids: readonly string[],
	shelterCode?: string
): Promise<EvacueeNameRecord[]> {
	const wanted = uniqueEvacueeIds(ids);
	if (wanted.length === 0) return [];
	const db = getShelterDb(shelterCode);
	const chunks: string[][] = [];
	for (let i = 0; i < wanted.length; i += KEYS_PER_READ) {
		chunks.push(wanted.slice(i, i + KEYS_PER_READ));
	}
	const docs = (
		await Promise.all(chunks.map((chunk) => allDocsByIds(db, chunk, isEvacuee)))
	).flat();
	const requested = new Set(wanted);
	return docs
		.filter((doc) => requested.has(doc._id))
		.map((doc) => ({
			_id: doc._id,
			first_name: doc.first_name,
			last_name: doc.last_name,
			...(doc.nickname ? { nickname: doc.nickname } : {})
		}));
}
