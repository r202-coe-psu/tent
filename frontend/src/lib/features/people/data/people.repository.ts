import type { AuthorContext } from '$lib/db/model';
import type { PaginatedResult } from '$lib/db/repository';
import type {
	Evacuee,
	EvacueeInput,
	Household,
	HouseholdInput,
	Screening,
	ScreeningInput,
	Medical,
	Movement
} from '../domain/people';

export type HouseholdSearchLabels = {
	municipalityZone: Record<string, string>;
	community: Record<string, string>;
};

/**
 * Persistence contract for the `people` feature. The application layer depends
 * on this interface — never on CouchDB directly — so the store can be swapped
 * (in-memory in tests) without touching queries or UI.
 *
 * Writes go to the active central CouchDB endpoint. The ULID minted by the factory is the
 * idempotency key. Conflict resolution beyond append-only retry is a central
 * repair job (data-model.md §5) — do not merge here.
 */
export interface PeopleRepository {
	/** Mint an evacuee from form input + author context and persist it. */
	createEvacuee(input: EvacueeInput, ctx: AuthorContext): Promise<Evacuee>;
	/** Every evacuee in this shelter database. */
	listEvacuees(): Promise<Evacuee[]>;
	/** Paginated list of evacuees — optional `search` filters before paging. */
	listEvacueesPaginated(
		page: number,
		pageSize: number,
		search?: string
	): Promise<PaginatedResult<Evacuee>>;
	/** One evacuee by `_id`, or `null` when absent. */
	getEvacuee(id: string): Promise<Evacuee | null>;
	/** Persist an edited evacuee (LWW: bumps `updated_at`). */
	updateEvacuee(evacuee: Evacuee): Promise<Evacuee>;
	/** Mint a household from form input + author context and persist it. */
	createHousehold(input: HouseholdInput, ctx: AuthorContext): Promise<Household>;
	/** Every household in this shelter database. */
	listHouseholds(): Promise<Household[]>;
	/** Paginated list of households — optional `search` filters before paging. */
	listHouseholdsPaginated(
		page: number,
		pageSize: number,
		search?: string,
		labels?: HouseholdSearchLabels
	): Promise<PaginatedResult<Household>>;
	/** One household by `_id`, or `null` when absent. */
	getHousehold(id: string): Promise<Household | null>;
	/** Persist an edited household (LWW: bumps `updated_at`). */
	updateHousehold(household: Household): Promise<Household>;

	/** Search evacuees by name, phone, or national ID. */
	searchEvacuees(query: string): Promise<Evacuee[]>;

	/** Mint a screening from input + author context and persist it. */
	createScreening(input: ScreeningInput, ctx: AuthorContext): Promise<Screening>;
	/** Every medical record in this shelter database. */
	listMedicals(): Promise<Medical[]>;
	/** Every movement record in this shelter database. */
	listMovements(): Promise<Movement[]>;
	/** Every screening record in this shelter database. */
	listScreenings(): Promise<Screening[]>;

	/**
	 * Record a check-in movement and apply it to the evacuee's `current_stay`.
	 * Writes the append-only `movement` doc first, then the updated evacuee —
	 * this is the only path that flips occupancy to `checked_in` (T-06).
	 */
	checkInEvacuee(evacuee: Evacuee, ctx: AuthorContext, zone?: string | null): Promise<Evacuee>;
	/**
	 * Record a check-out movement and apply it to the evacuee's `current_stay`.
	 * Writes the append-only `movement` doc first, then the updated evacuee —
	 * this is the only path that flips occupancy to `checked_out` (T-06).
	 */
	checkOutEvacuee(evacuee: Evacuee, ctx: AuthorContext): Promise<Evacuee>;
}
