import { namedLocalDb } from '$lib/db/pouch';
import { createRepository, type Repository, type PaginatedResult } from '$lib/db/repository';
import { touch, type AuthorContext } from '$lib/db/model';
import { SHELTER_CODE, SHELTER_DB, shelterDb as _shelterDb } from '$lib/db/shelter';
import {
	createEvacuee as buildEvacuee,
	isEvacuee,
	createMedical as buildMedical,
	type Evacuee,
	type EvacueeInput,
	createHousehold as buildHousehold,
	isHousehold,
	type Household,
	type HouseholdInput,
	createScreening as buildScreening,
	type Screening,
	type ScreeningInput
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
	async createEvacuee(input: EvacueeInput, ctx: AuthorContext): Promise<Evacuee> {
		const evacuee = buildEvacuee(input, ctx);
		await this.repo.put(evacuee);

		if (
			(input.medical_conditions && input.medical_conditions.length > 0) ||
			(input.medical_allergies && input.medical_allergies.length > 0) ||
			(input.medical_medications && input.medical_medications.length > 0) ||
			(input.medical_note && input.medical_note.length > 0)
		) {
			const medicalInput = {
				evacuee_id: evacuee._id,
				conditions: input.medical_conditions || [],
				allergies: input.medical_allergies || [],
				medications: input.medical_medications || [],
				notes: input.medical_note || '',
				track: 'normal' as const
			};
			const medicalDoc = buildMedical(medicalInput, ctx);
			await this.repo.put(medicalDoc);
		}

		return evacuee;
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

	/** Mint a household from form input + author context and persist it. */
	createHousehold(input: HouseholdInput, ctx: AuthorContext): Promise<Household> {
		return this.repo.put(buildHousehold(input, ctx));
	}

	/** Every household in this shelter database. */
	listHouseholds(): Promise<Household[]> {
		return this.repo.allByType('household', isHousehold);
	}

	/** Paginated list of households. */
	listHouseholdsPaginated(page: number, pageSize: number): Promise<PaginatedResult<Household>> {
		return this.repo.pageByType('household', isHousehold, page, pageSize);
	}

	/** One household by `_id`, or `null` when absent. */
	getHousehold(id: string): Promise<Household | null> {
		return this.repo.get<Household>(id);
	}

	/** Persist an edited household (LWW: bumps `updated_at`). */
	updateHousehold(household: Household): Promise<Household> {
		return this.repo.put(touch(household));
	}

	/** Mint a screening from input + author context and persist it. */
	createScreening(input: ScreeningInput, ctx: AuthorContext): Promise<Screening> {
		return this.repo.put(buildScreening(input, ctx));
	}
}

let singleton: PeopleRepository | null = null;

/** Memoised repository over the shelter database — one local handle. */
export function peopleRepository(): PeopleRepository {
	if (!singleton) singleton = new PeoplePouchRepository();
	return singleton;
}

export const shelterDb = _shelterDb;
