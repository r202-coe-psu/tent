import { namedLocalDb } from '$lib/db/pouch';
import { createRepository, type Repository, type PaginatedResult } from '$lib/db/repository';
import { touch, type AuthorContext } from '$lib/db/model';
import { getShelterDb, shelterDb as _shelterDb } from '$lib/db/shelter';
import {
	createEvacuee as buildEvacuee,
	createMovement,
	applyMovementToStay,
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
	type ScreeningInput,
	isMedical,
	isMovement,
	isScreening,
	type Medical,
	type Movement
} from '../domain/people';
import type { PeopleRepository } from './people.repository';

/**
 * PouchDB-backed repository for the people feature. The only file here that
 * knows PouchDB exists — everything goes through the {@link Repository}
 * primitive, which honours the doc envelope + `{type}:{ulid}` id convention.
 */
export class PeoplePouchRepository implements PeopleRepository {
	private readonly repo: Repository;

	constructor(dbName: string) {
		this.repo = createRepository(namedLocalDb(dbName));
	}

	/** Mint an evacuee from form input + author context and persist it. */
	async createEvacuee(input: EvacueeInput, ctx: AuthorContext): Promise<Evacuee> {
		const evacuee = buildEvacuee(input, ctx);
		const saved = await this.repo.put(evacuee);

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
				track: input.track || ('normal' as const)
			};
			const medicalDoc = buildMedical(medicalInput, ctx);
			await this.repo.put(medicalDoc);
		}

		return saved;
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

	/** Persist an edited evacuee (LWW: bumps `updated_at`). Fetches the latest _rev first to avoid stale-revision conflicts from live sync. */
	async updateEvacuee(evacuee: Evacuee): Promise<Evacuee> {
		const latest = await this.repo.get<Evacuee>(evacuee._id);
		return this.repo.put(touch({ ...evacuee, _rev: latest?._rev ?? evacuee._rev }));
	}

	/** Search evacuees by name, phone, or national ID — in-memory filter over prefix scan. */
	async searchEvacuees(query: string): Promise<Evacuee[]> {
		const q = query.trim().toLowerCase();
		if (!q) return [];

		const all = await this.repo.allByType('evacuee', isEvacuee);
		const digitsOnly = q.replace(/\D/g, '');

		return all.filter((e) => {
			if (e.privacy?.search_excluded) return false;
			if (
				e.first_name.toLowerCase().includes(q) ||
				e.last_name.toLowerCase().includes(q) ||
				`${e.first_name} ${e.last_name}`.toLowerCase().includes(q)
			)
				return true;
			if (digitsOnly) {
				if (e.phone?.replace(/\D/g, '').includes(digitsOnly)) return true;
				if (e.person_id?.number?.replace(/\D/g, '').includes(digitsOnly)) return true;
			}
			return false;
		});
	}

	/** Mint a household from form input + author context and persist it. */
	createHousehold(input: HouseholdInput, ctx: AuthorContext): Promise<Household> {
		return this.repo.put(buildHousehold(input, ctx));
	}

	/** Every household in this shelter database. */
	async listHouseholds(): Promise<Household[]> {
		const docs = await this.repo.allByType('household', isHousehold);
		return docs.map(migrateHouseholdV3ToV4);
	}

	/** Paginated list of households. */
	async listHouseholdsPaginated(page: number, pageSize: number): Promise<PaginatedResult<Household>> {
		const result = await this.repo.pageByType('household', isHousehold, page, pageSize);
		return {
			...result,
			items: result.items.map(migrateHouseholdV3ToV4)
		};
	}

	/** One household by `_id`, or `null` when absent. */
	async getHousehold(id: string): Promise<Household | null> {
		const doc = await this.repo.get<Household>(id);
		return doc ? migrateHouseholdV3ToV4(doc) : null;
	}

	/** Persist an edited household (LWW: bumps `updated_at`). Fetches the latest _rev first to avoid stale-revision conflicts from live sync. */
	async updateHousehold(household: Household): Promise<Household> {
		const latest = await this.repo.get<Household>(household._id);
		return this.repo.put(touch({ ...household, _rev: latest?._rev ?? household._rev }));
	}

	/** Mint a screening from input + author context and persist it. */
	createScreening(input: ScreeningInput, ctx: AuthorContext): Promise<Screening> {
		return this.repo.put(buildScreening(input, ctx));
	}

	listMedicals(): Promise<Medical[]> {
		return this.repo.allByType('medical', isMedical);
	}

	listMovements(): Promise<Movement[]> {
		return this.repo.allByType('movement', isMovement);
	}

	listScreenings(): Promise<Screening[]> {
		return this.repo.allByType('screening', isScreening);
	}

	/** Record a check-in movement, then apply it to the evacuee's current_stay.
	 *  Fetches the latest _rev first to avoid stale-revision conflicts from live sync. */
	async checkInEvacuee(
		evacuee: Evacuee,
		ctx: AuthorContext,
		zone: string | null = null
	): Promise<Evacuee> {
		const movement = createMovement({ evacuee_id: evacuee._id, action: 'check_in', zone }, ctx);
		await this.repo.put(movement);
		const latest = await this.repo.get<Evacuee>(evacuee._id);
		return this.repo.put(
			applyMovementToStay({ ...evacuee, _rev: latest?._rev ?? evacuee._rev }, movement)
		);
	}
}

let singleton: PeopleRepository | null = null;
let singletonDbName: string | null = null;

/**
 * Memoised repository over the shelter database — one local handle.
 * Resets automatically when the active shelter database name changes
 * (e.g. a different user logs in with a different shelter scope).
 */
export function peopleRepository(): PeopleRepository {
	const currentDb = getShelterDb();
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new PeoplePouchRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}

export const shelterDb = _shelterDb;

export function migrateHouseholdV3ToV4(doc: any): Household {
	if (doc && doc.type === 'household' && (!doc.schema_v || doc.schema_v < 4)) {
		let vehicles = doc.vehicles;
		if (!vehicles) {
			if (doc.vehicle) {
				vehicles = [doc.vehicle];
			} else {
				vehicles = [];
			}
		}
		const migrated = {
			...doc,
			schema_v: 4,
			status: doc.status || 'checked_in',
			checkout_destination: doc.checkout_destination || null,
			vehicles
		};
		delete migrated.vehicle;
		return migrated;
	}
	return doc;
}
