import { namedLocalDb } from '$lib/db/pouch';
import { createRepository, type Repository } from '$lib/db/repository';
import { touch, type AuthorContext } from '$lib/db/model';
import {
	createEvacuee as buildEvacuee,
	isEvacuee,
	type Evacuee,
	type EvacueeInput
} from '../domain/people';
import type { PeopleRepository } from './people.repository';

/**
 * The single shelter database this skeleton syncs to. For the walking skeleton
 * the shelter is fixed; remote selection (Edge fallback) is T-54, out of scope.
 *
 * INVARIANT: the repository, the changes-feed live-query, and `startNamedSync`
 * must all target THIS name. A changes feed on the wrong db silently never
 * fires.
 */
export const SHELTER_CODE = 'SH001';
// CouchDB database names must be lowercase (illegal_database_name otherwise),
// so the db name lower-cases the code; the `shelter_code` envelope field stays
// canonical 'SH001'.
export const SHELTER_DB = `shelter_${SHELTER_CODE.toLowerCase()}`;

/**
 * PouchDB-backed repository for the people feature. The only file here that
 * knows PouchDB exists — everything goes through the {@link Repository}
 * primitive, which honours the doc envelope + `{type}:{ulid}` id convention.
 */
export class PeoplePouchRepository implements PeopleRepository {
	private readonly repo: Repository;

	constructor(dbName: string = SHELTER_DB) {
		this.repo = createRepository(namedLocalDb(dbName));
	}

	createEvacuee(input: EvacueeInput, ctx: AuthorContext): Promise<Evacuee> {
		return this.repo.put(buildEvacuee(input, ctx));
	}

	listEvacuees(): Promise<Evacuee[]> {
		return this.repo.allByType('evacuee', isEvacuee);
	}

	getEvacuee(id: string): Promise<Evacuee | null> {
		return this.repo.get<Evacuee>(id);
	}

	updateEvacuee(evacuee: Evacuee): Promise<Evacuee> {
		return this.repo.put(touch(evacuee));
	}
}

let singleton: PeopleRepository | null = null;

/** Memoised repository over the shelter database — one local handle. */
export function peopleRepository(): PeopleRepository {
	if (!singleton) singleton = new PeoplePouchRepository();
	return singleton;
}

/**
 * The local shelter PouchDB handle — the SAME one the repository writes to, so
 * the changes-feed live-query observes local + replicated writes alike.
 */
export function shelterDb(): PouchDB.Database {
	return namedLocalDb(SHELTER_DB);
}
