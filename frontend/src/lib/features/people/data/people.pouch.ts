import { namedLocalDb } from '$lib/db/pouch';
import { createRepository, type Repository, type PaginatedResult } from '$lib/db/repository';
import { touch, type AuthorContext } from '$lib/db/model';
import { SHELTER_CODE, SHELTER_DB, shelterDb as _shelterDb } from '$lib/db/shelter';
import {
	createEvacuee as buildEvacuee,
	createMovement,
	applyMovementToStay,
	isEvacuee,
	type Evacuee,
	type EvacueeInput
} from '../domain/people';
import type { PeopleRepository } from './people.repository';

export { SHELTER_CODE, SHELTER_DB };

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

	/** Mint an evacuee from form input + author context and persist it. */
	createEvacuee(input: EvacueeInput, ctx: AuthorContext): Promise<Evacuee> {
		return this.repo.put(buildEvacuee(input, ctx));
	}

	/** Every evacuee in this shelter database. */
	listEvacuees(): Promise<Evacuee[]> {
		return this.repo.allByType('evacuee', isEvacuee);
	}

	/** Paginated list of evacuees — fetches all then slices by page/pageSize. */
	listEvacueesPaginated(page: number, pageSize: number): Promise<PaginatedResult<Evacuee>> {
		return this.repo.pageByType('evacuee', isEvacuee, page, pageSize);
	}

	/** One evacuee by `_id`, or `null` when absent. */
	getEvacuee(id: string): Promise<Evacuee | null> {
		return this.repo.get<Evacuee>(id);
	}

	/** Persist an edited evacuee (LWW: bumps `updated_at`). */
	updateEvacuee(evacuee: Evacuee): Promise<Evacuee> {
		return this.repo.put(touch(evacuee));
	}

	/** Record a check-in movement, then apply it to the evacuee's current_stay. */
	async checkInEvacuee(
		evacuee: Evacuee,
		ctx: AuthorContext,
		zone: string | null = null
	): Promise<Evacuee> {
		const movement = createMovement({ evacuee_id: evacuee._id, action: 'check_in', zone }, ctx);
		await this.repo.put(movement);
		return this.repo.put(applyMovementToStay(evacuee, movement));
	}
}

let singleton: PeopleRepository | null = null;

/** Memoised repository over the shelter database — one local handle. */
export function peopleRepository(): PeopleRepository {
	if (!singleton) singleton = new PeoplePouchRepository();
	return singleton;
}

export const shelterDb = _shelterDb;
