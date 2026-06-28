import type { AuthorContext } from '$lib/db/model';
import type { PaginatedResult } from '$lib/db/repository';
import type {
	Evacuee,
	EvacueeInput,
	Household,
	HouseholdInput,
	Screening,
	ScreeningInput
} from '../domain/people';

/**
 * Persistence contract for the `people` feature. The application layer depends
 * on this interface — never on PouchDB directly — so the store can be swapped
 * (in-memory in tests) without touching queries or UI.
 *
 * The device writes local PouchDB first; the ULID minted by the factory is the
 * idempotency key. Conflict resolution beyond append-only retry is a central
 * repair job (data-model.md §5) — do not merge here.
 */
export interface PeopleRepository {
	/** Mint an evacuee from form input + author context and persist it. */
	createEvacuee(input: EvacueeInput, ctx: AuthorContext): Promise<Evacuee>;
	/** Every evacuee in this shelter database. */
	listEvacuees(): Promise<Evacuee[]>;
	/** Paginated list of evacuees — fetches all then slices by page/pageSize. */
	listEvacueesPaginated(page: number, pageSize: number): Promise<PaginatedResult<Evacuee>>;
	/** One evacuee by `_id`, or `null` when absent. */
	getEvacuee(id: string): Promise<Evacuee | null>;
	/** Persist an edited evacuee (LWW: bumps `updated_at`). */
	updateEvacuee(evacuee: Evacuee): Promise<Evacuee>;

	/** Mint a household from form input + author context and persist it. */
	createHousehold(input: HouseholdInput, ctx: AuthorContext): Promise<Household>;
	/** Every household in this shelter database. */
	listHouseholds(): Promise<Household[]>;
	/** Paginated list of households — fetches all then slices by page/pageSize. */
	listHouseholdsPaginated(page: number, pageSize: number): Promise<PaginatedResult<Household>>;
	/** One household by `_id`, or `null` when absent. */
	getHousehold(id: string): Promise<Household | null>;
	/** Persist an edited household (LWW: bumps `updated_at`). */
	updateHousehold(household: Household): Promise<Household>;

	/** Search evacuees by name, phone, or national ID. */
	searchEvacuees(query: string): Promise<Evacuee[]>;

	/** Mint a screening from input + author context and persist it. */
	createScreening(input: ScreeningInput, ctx: AuthorContext): Promise<Screening>;
}
