import { findDocs } from '$lib/db/couch-db';
import { getShelterDb } from '$lib/db/shelter';

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
/** The only fields requested from CouchDB; ID card, phone and address never cross the wire. */
const NAME_FIELDS = ['_id', 'first_name', 'last_name', 'nickname'];

/** Distinct `evacuee:` ids, sorted; ids with another prefix are dropped. */
export function uniqueEvacueeIds(ids: readonly string[]): string[] {
	return [...new Set(ids.filter((id) => id.startsWith(EVACUEE_ID_PREFIX)))].sort();
}

/** Shape of a `_find` row projected to `NAME_FIELDS`; the full evacuee guard cannot apply to it. */
function isEvacueeNameProjection(value: unknown): value is EvacueeNameRecord {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v._id === 'string' &&
		v._id.startsWith(EVACUEE_ID_PREFIX) &&
		typeof v.first_name === 'string' &&
		typeof v.last_name === 'string' &&
		(v.nickname === undefined || v.nickname === null || typeof v.nickname === 'string')
	);
}

/**
 * Names of the named evacuees of one shelter, read by id with a Mango `_find` (`_id` `$in`,
 * chunked) that projects name fields only, so nothing else leaves CouchDB. Missing or malformed
 * docs are omitted. `shelterCode` omitted reads the active shelter.
 */
export async function getEvacueeNamesByIds(
	ids: readonly string[],
	shelterCode?: string
): Promise<EvacueeNameRecord[]> {
	const wanted = uniqueEvacueeIds(ids);
	if (wanted.length === 0) return [];
	const db = getShelterDb(shelterCode);
	// `wanted` is sorted, so each chunk is too: its first and last id bound the `_all_docs` range
	// that `$gte`/`$lte` hand to CouchDB; `$in` alone cannot, and would scan from the start.
	const chunks: string[][] = [];
	for (let i = 0; i < wanted.length; i += KEYS_PER_READ) {
		chunks.push(wanted.slice(i, i + KEYS_PER_READ));
	}
	const rows = (
		await Promise.all(
			chunks.map((chunk) =>
				findDocs<unknown>(db, {
					selector: { _id: { $gte: chunk[0], $lte: chunk.at(-1), $in: chunk } },
					fields: NAME_FIELDS,
					limit: chunk.length
				})
			)
		)
	).flat();
	const requested = new Set(wanted);
	return rows
		.filter(isEvacueeNameProjection)
		.filter((doc) => requested.has(doc._id))
		.map((doc) => ({
			_id: doc._id,
			first_name: doc.first_name,
			last_name: doc.last_name,
			...(doc.nickname ? { nickname: doc.nickname } : {})
		}));
}
