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
	MedicalInput,
	Movement
} from '../domain/people';

export type HouseholdSearchLabels = {
	municipalityZone: Record<string, string>;
	community: Record<string, string>;
};

export type EvacueeFilters = {
	specialNeed?: string;
	zone?: string;
};

export type EvacueePatch = Partial<
	Pick<
		Evacuee,
		| 'first_name'
		| 'last_name'
		| 'nickname'
		| 'birth_year'
		| 'age'
		| 'gender'
		| 'phone'
		| 'person_id'
		| 'country'
		| 'religion'
		| 'photo'
		| 'special_needs'
		| 'emergency_contact'
		| 'household_id'
		| 'current_stay'
	>
>;

export type HouseholdPatch = Partial<
	Pick<
		Household,
		| 'head_evacuee_id'
		| 'address_no'
		| 'village_no'
		| 'subdistrict'
		| 'district'
		| 'province'
		| 'postal_code'
		| 'vehicles'
		| 'assets'
		| 'pets'
	>
>;

export type MedicalPatch = Partial<
	Pick<Medical, 'blood_group' | 'conditions' | 'medications' | 'allergies' | 'track' | 'notes'>
>;

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
	/** Members linked to one household, resolved through the household_id Mango index. */
	listHouseholdMembers(householdId: string): Promise<Evacuee[]>;
	/** Paginated list of evacuees — optional `search` filters before paging. */
	listEvacueesPaginated(
		page: number,
		pageSize: number,
		search?: string,
		filters?: EvacueeFilters
	): Promise<PaginatedResult<Evacuee>>;
	/** One evacuee by `_id`, or `null` when absent. */
	getEvacuee(id: string): Promise<Evacuee | null>;
	/** Persist an edited evacuee (LWW: bumps `updated_at`). */
	updateEvacuee(evacuee: Evacuee): Promise<Evacuee>;
	/** Merge section-owned evacuee fields into the latest persisted revision. */
	patchEvacuee(id: string, patch: EvacueePatch): Promise<Evacuee>;
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
	/** Merge section-owned household fields into the latest persisted revision. */
	patchHousehold(id: string, patch: HouseholdPatch): Promise<Household>;

	/** Search evacuees by name, phone, or national ID. */
	searchEvacuees(query: string): Promise<Evacuee[]>;

	/** Mint a screening from input + author context and persist it. */
	createScreening(input: ScreeningInput, ctx: AuthorContext): Promise<Screening>;
	/**
	 * Create evacuee (+ optional medical) then screening as one save unit.
	 * On screening failure, deletes medicals and the evacuee created in this call
	 * so the wizard does not leave orphan `pre_registered` people.
	 */
	createEvacueeWithScreening(
		input: EvacueeInput,
		screening: Omit<ScreeningInput, 'evacuee_id'> & { evacuee_id?: string },
		ctx: AuthorContext
	): Promise<{ evacuee: Evacuee; screening: Screening }>;
	/**
	 * Compensate a failed registration unit: remove medicals for the evacuee,
	 * then the evacuee. Screening/movement are append-only and are not deleted.
	 */
	compensateFailedEvacueeRegistration(evacueeId: string): Promise<void>;
	/**
	 * Remove a household created in a failed registration submit when it still
	 * has no members (arriving / pre_registered only).
	 */
	compensateFailedHouseholdCreate(householdId: string): Promise<void>;
	/** Mint a medical record from input + author context and persist it. */
	createMedical(input: MedicalInput, ctx: AuthorContext): Promise<Medical>;
	/** Every medical record in this shelter database. */
	listMedicals(): Promise<Medical[]>;
	/** Persist an edited medical record (LWW: bumps `updated_at`). */
	updateMedical(medical: Medical): Promise<Medical>;
	/** Merge section-owned medical fields into the latest persisted revision. */
	patchMedical(id: string, patch: MedicalPatch): Promise<Medical>;
	/** Remove a medical record, used to compensate a failed multi-document health save. */
	deleteMedical(id: string): Promise<void>;
	/** Every movement record in this shelter database. */
	listMovements(): Promise<Movement[]>;
	/** Every screening record in this shelter database. */
	listScreenings(): Promise<Screening[]>;

	/**
	 * Record a check-in movement and apply it to the evacuee's `current_stay`.
	 * Writes the append-only `movement` doc first, then the updated evacuee —
	 * this is the only path that flips occupancy to `active` (T-06).
	 */
	checkInEvacuee(evacuee: Evacuee, ctx: AuthorContext, zone?: string | null): Promise<Evacuee>;
	/**
	 * Record a check-out movement and apply it to the evacuee's `current_stay`.
	 * Writes the append-only `movement` doc first, then the updated evacuee —
	 * this is the only path that flips occupancy to `checked_out` (T-06).
	 */
	checkOutEvacuee(evacuee: Evacuee, ctx: AuthorContext): Promise<Evacuee>;
	/**
	 * Cancel a pre-registered household and persist an actor-attributed audit entry.
	 * Person stay status is unchanged because `cancelled` belongs to HouseholdStatus only.
	 */
	cancelPreRegistration(householdId: string, ctx: AuthorContext): Promise<void>;
}
