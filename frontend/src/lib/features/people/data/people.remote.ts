import { createRemoteRepository, type Repository, type PaginatedResult } from '$lib/db/repository';
import { now, touch, type AuthorContext } from '$lib/db/model';
import { getShelterDb } from '$lib/db/shelter';
import { createAuditEntry } from '$lib/features/shared';
import {
	createEvacuee as buildEvacuee,
	evacueeInputSchema,
	createMovement,
	assertMovementAllowed,
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
	migrateHouseholdV3ToV4,
	matchesEvacueeSearch,
	formatPersonName,
	assertEvacueeHouseholdAssignment,
	assertHouseholdStatusTransition,
	assertCheckoutDestination,
	deriveHouseholdStatus,
	isActiveHouseholdStatus,
	canCancelEvacueePreRegistration,
	replacePersonId,
	migrateVulnerableGroupCodes,
	listPendingZoneArrivalConfirmations,
	type Medical,
	type MedicalInput,
	type Movement,
	type MovementAction
} from '../domain/people';
import type {
	EvacueeFilters,
	EvacueePatch,
	HouseholdFilters,
	HouseholdPatch,
	HouseholdSearchLabels,
	MedicalPatch,
	PeopleRepository
} from './people.repository';

function paginateSlice<T>(matched: T[], page: number, pageSize: number): PaginatedResult<T> {
	const total = matched.length;
	const totalPages = Math.max(1, Math.ceil(total / pageSize));
	const safePage = Math.max(1, Math.min(page, totalPages));
	const start = (safePage - 1) * pageSize;
	return {
		items: matched.slice(start, start + pageSize),
		total,
		page: safePage,
		pageSize,
		totalPages
	};
}

function matchesHouseholdSearch(
	household: Household,
	query: string,
	headName: string,
	labels?: HouseholdSearchLabels
): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	const mzLabel = (
		labels?.municipalityZone[household.municipality_zone ?? ''] ??
		household.municipality_zone ??
		''
	).toLowerCase();
	const commLabel = (
		labels?.community[household.community ?? ''] ??
		household.community ??
		''
	).toLowerCase();
	return (
		household.label.toLowerCase().includes(needle) ||
		mzLabel.includes(needle) ||
		commLabel.includes(needle) ||
		headName.includes(needle)
	);
}

/**
 * Remote CouchDB repository for the people feature. Writes go to the active
 * central endpoint via cookie-authenticated HTTP PUT.
 */
export class PeopleRemoteRepository implements PeopleRepository {
	private readonly repo: Repository;

	constructor(private readonly dbName: string) {
		this.repo = createRemoteRepository(dbName);
	}

	async createEvacuee(
		input: EvacueeInput & { draft_id?: string },
		ctx: AuthorContext
	): Promise<Evacuee> {
		const parsedInput = evacueeInputSchema.parse(input);
		if (parsedInput.household_id) {
			const targetHousehold = await this.repo.get<Household>(parsedInput.household_id);
			if (!targetHousehold) throw new Error('ไม่พบครัวเรือนปลายทาง');
			if (!isActiveHouseholdStatus(migrateHouseholdV3ToV4(targetHousehold).status)) {
				throw new Error('ไม่สามารถเพิ่มสมาชิกเข้าครัวเรือนที่ยกเลิกหรือเช็คเอาท์แล้ว');
			}
		}

		let saved: Evacuee;
		if (input.draft_id) {
			const existing = await this.repo.get<Evacuee>(input.draft_id);
			if (existing && isEvacuee(existing)) {
				let next: Evacuee = {
					...existing,
					first_name: parsedInput.first_name,
					last_name: parsedInput.last_name,
					gender: parsedInput.gender,
					phone: parsedInput.phone,
					...(parsedInput.nickname ? { nickname: parsedInput.nickname } : {}),
					...(parsedInput.birth_year !== undefined ? { birth_year: parsedInput.birth_year } : {}),
					...(parsedInput.age !== undefined ? { age: parsedInput.age } : {}),
					...(parsedInput.religion ? { religion: parsedInput.religion } : {}),
					country: parsedInput.country,
					vulnerable_groups: migrateVulnerableGroupCodes(parsedInput.vulnerable_groups),
					special_needs: parsedInput.special_needs,
					...(parsedInput.emergency_contact
						? { emergency_contact: parsedInput.emergency_contact }
						: {}),
					...(parsedInput.photo ? { photo: parsedInput.photo } : {}),
					household_id: parsedInput.household_id,
					current_stay: {
						status: parsedInput.status || existing.current_stay.status || 'pre_registered',
						zone: existing.current_stay.zone ?? null,
						since: now()
					}
				};
				if (parsedInput.person_id) {
					next = replacePersonId(next, parsedInput.person_id);
				}
				saved = await this.repo.put(touch(next));
			} else {
				const evacuee = buildEvacuee(parsedInput, ctx);
				saved = await this.repo.put(evacuee);
			}
		} else {
			const evacuee = buildEvacuee(parsedInput, ctx);
			saved = await this.repo.put(evacuee);
		}

		const needsMedical =
			(input.medical_conditions && input.medical_conditions.length > 0) ||
			(input.medical_allergies && input.medical_allergies.length > 0) ||
			(input.medical_medications && input.medical_medications.length > 0) ||
			(input.medical_note && input.medical_note.length > 0);

		if (needsMedical) {
			const medicalInput = {
				evacuee_id: saved._id,
				conditions: input.medical_conditions || [],
				allergies: input.medical_allergies || [],
				medications: input.medical_medications || [],
				notes: input.medical_note || '',
				track: input.track || ('normal' as const)
			};
			const medicalDoc = buildMedical(medicalInput, ctx);

			try {
				await this.repo.put(medicalDoc);
			} catch (err) {
				await this.compensateFailedEvacueeRegistration(saved._id);
				throw err;
			}
		}

		return saved;
	}

	listEvacuees(): Promise<Evacuee[]> {
		return this.repo.allByType('evacuee', isEvacuee);
	}

	async listHouseholdMembers(householdId: string): Promise<Evacuee[]> {
		const docs = await this.repo.find<Evacuee>({
			selector: { type: 'evacuee', household_id: householdId },
			limit: 10_000
		});
		return docs.filter(isEvacuee);
	}

	async listEvacueesPaginated(
		page: number,
		pageSize: number,
		search?: string,
		filters?: EvacueeFilters
	): Promise<PaginatedResult<Evacuee>> {
		const matched = await this.filterEvacuees(search, filters);
		return paginateSlice(matched, page, pageSize);
	}

	async listMatchingEvacueeIds(search?: string, filters?: EvacueeFilters): Promise<string[]> {
		const matched = await this.filterEvacuees(search, filters);
		return matched.map((e) => e._id);
	}

	private async filterEvacuees(search?: string, filters?: EvacueeFilters): Promise<Evacuee[]> {
		const all = await this.repo.allByType('evacuee', isEvacuee);
		const q = search?.trim();
		let matched = q ? all.filter((e) => matchesEvacueeSearch(e, q)) : all;
		if (filters?.specialNeed) {
			matched = matched.filter((e) => e.special_needs.some((need) => need === filters.specialNeed));
		}
		if (filters?.zone) {
			matched = matched.filter((e) => e.current_stay.zone === filters.zone);
		}
		if (filters?.status) {
			matched = matched.filter((e) => e.current_stay.status === filters.status);
		}
		return matched;
	}

	getEvacuee(id: string): Promise<Evacuee | null> {
		return this.repo.get<Evacuee>(id);
	}

	async updateEvacuee(evacuee: Evacuee): Promise<Evacuee> {
		const latest = await this.repo.get<Evacuee>(evacuee._id);
		if (!latest) throw new Error('ไม่พบข้อมูลผู้ประสบภัย');

		const oldHouseholdId = latest.household_id;
		if (oldHouseholdId !== evacuee.household_id) {
			const [households, evacuees] = await Promise.all([
				this.repo.allByType('household', isHousehold),
				this.repo.allByType('evacuee', isEvacuee)
			]);
			assertEvacueeHouseholdAssignment(
				latest,
				evacuee.household_id,
				households.map(migrateHouseholdV3ToV4),
				evacuees
			);
		}

		const saved = await this.repo.put(
			touch({
				...evacuee,
				vulnerable_groups: migrateVulnerableGroupCodes(evacuee.vulnerable_groups ?? []),
				_rev: latest._rev
			})
		);
		if (oldHouseholdId && oldHouseholdId !== saved.household_id) {
			await this.cancelHouseholdIfEmpty(oldHouseholdId);
			await this.refreshDerivedHouseholdStatus(oldHouseholdId);
		}
		await this.refreshDerivedHouseholdStatus(saved.household_id);
		return saved;
	}

	async patchEvacuee(id: string, patch: EvacueePatch): Promise<Evacuee> {
		const latest = await this.repo.get<Evacuee>(id);
		if (!latest) throw new Error('ไม่พบข้อมูลผู้ประสบภัย');
		const { person_id: personIdPatch, ...rest } = patch;
		let next: Evacuee = { ...latest, ...rest };
		if (rest.vulnerable_groups) {
			next = {
				...next,
				vulnerable_groups: migrateVulnerableGroupCodes(rest.vulnerable_groups)
			};
		}
		if (personIdPatch) {
			next = replacePersonId(next, personIdPatch);
		}
		const oldHouseholdId = latest.household_id;
		if (oldHouseholdId !== next.household_id) {
			const [households, evacuees] = await Promise.all([
				this.repo.allByType('household', isHousehold),
				this.repo.allByType('evacuee', isEvacuee)
			]);
			assertEvacueeHouseholdAssignment(
				latest,
				next.household_id,
				households.map(migrateHouseholdV3ToV4),
				evacuees
			);
		}

		const saved = await this.repo.put(touch(next));
		if (oldHouseholdId && oldHouseholdId !== saved.household_id) {
			await this.cancelHouseholdIfEmpty(oldHouseholdId);
			await this.refreshDerivedHouseholdStatus(oldHouseholdId);
		}
		await this.refreshDerivedHouseholdStatus(saved.household_id);
		return saved;
	}

	async searchEvacuees(query: string): Promise<Evacuee[]> {
		const q = query.trim();
		if (!q) return [];
		const all = await this.repo.allByType('evacuee', isEvacuee);
		return all.filter((e) => matchesEvacueeSearch(e, q));
	}

	createHousehold(input: HouseholdInput, ctx: AuthorContext): Promise<Household> {
		return this.repo.put(buildHousehold(input, ctx));
	}

	async listHouseholds(): Promise<Household[]> {
		const docs = await this.repo.allByType('household', isHousehold);
		return docs.map(migrateHouseholdV3ToV4);
	}

	async listHouseholdsPaginated(
		page: number,
		pageSize: number,
		search?: string,
		labels?: HouseholdSearchLabels,
		filters?: HouseholdFilters
	): Promise<PaginatedResult<Household>> {
		const matched = await this.filterHouseholds(search, labels, filters);
		return paginateSlice(matched, page, pageSize);
	}

	async listMatchingHouseholdIds(
		search?: string,
		labels?: HouseholdSearchLabels,
		filters?: HouseholdFilters
	): Promise<string[]> {
		const matched = await this.filterHouseholds(search, labels, filters);
		return matched.map((h) => h._id);
	}

	private async filterHouseholds(
		search?: string,
		labels?: HouseholdSearchLabels,
		filters?: HouseholdFilters
	): Promise<Household[]> {
		let all = await this.repo.allByType('household', isHousehold);
		all = all.map(migrateHouseholdV3ToV4);
		const q = search?.trim();
		if (q) {
			const evacuees = await this.repo.allByType('evacuee', isEvacuee);
			const headNames = new Map(evacuees.map((e) => [e._id, formatPersonName(e).toLowerCase()]));
			all = all.filter((h) =>
				matchesHouseholdSearch(h, q, headNames.get(h.head_evacuee_id ?? '') ?? '', labels)
			);
		}
		if (filters?.status) {
			all = all.filter((h) => h.status === filters.status);
		}
		return all;
	}

	async getHousehold(id: string): Promise<Household | null> {
		const doc = await this.repo.get<Household>(id);
		return doc ? migrateHouseholdV3ToV4(doc) : null;
	}

	/** Refresh compatibility household.status from member Evacuee stays (CR-112 A2). */
	private async refreshDerivedHouseholdStatus(
		householdId: string | null | undefined
	): Promise<void> {
		if (!householdId) return;
		const latestDoc = await this.repo.get<Household>(householdId);
		if (!latestDoc) return;
		const latest = migrateHouseholdV3ToV4(latestDoc);
		const members = await this.listHouseholdMembers(householdId);
		const derived = deriveHouseholdStatus(members.map((m) => m.current_stay.status));
		if (derived === latest.status) return;
		await this.repo.put(touch({ ...latest, status: derived }));
	}

	async updateHousehold(household: Household): Promise<Household> {
		const latestDoc = await this.repo.get<Household>(household._id);
		if (!latestDoc) throw new Error('ไม่พบข้อมูลครัวเรือน');
		const latest = migrateHouseholdV3ToV4(latestDoc);
		const members = await this.listHouseholdMembers(household._id);
		const derived = deriveHouseholdStatus(members.map((m) => m.current_stay.status));
		const next = { ...household, status: derived, _rev: latest._rev };
		if (derived === 'checked_out') {
			assertCheckoutDestination(next.checkout_destination ?? latest.checkout_destination);
		}
		return this.repo.put(touch(next));
	}

	async patchHousehold(id: string, patch: HouseholdPatch): Promise<Household> {
		const latestDoc = await this.repo.get<Household>(id);
		if (!latestDoc) throw new Error('ไม่พบข้อมูลครัวเรือน');
		const latest = migrateHouseholdV3ToV4(latestDoc);
		const members = await this.listHouseholdMembers(id);
		const derived = deriveHouseholdStatus(members.map((m) => m.current_stay.status));
		// Patch may carry status; derived member stays always win (CR-112 A2).
		const next = { ...latest, ...patch, status: derived };
		if (derived === 'checked_out') assertCheckoutDestination(next.checkout_destination);
		return this.repo.put(touch(next));
	}

	/**
	 * When the last member is moved out of an active household (leaving it
	 * empty), retire it as `cancelled` rather than:
	 *  - hard-deleting the doc — history/audit trail for the reservation
	 *    would be lost, and CouchDB tombstones complicate sync;
	 *  - `checked_out` — that status asserts a real physical checkout with a
	 *    `checkout_destination` (R-29-8), which never happened here; the
	 *    household was simply emptied by a member reassignment.
	 * `cancelled` is terminal (no transitions out, `isActiveHouseholdStatus`
	 * excludes it) and mirrors the SM-initiated "cancel pre-registration"
	 * path (`cancelPreRegistration`) that already uses the same status for
	 * an abandoned reservation.
	 */
	private async cancelHouseholdIfEmpty(householdId: string): Promise<void> {
		const [household, evacuees] = await Promise.all([
			this.repo.get<Household>(householdId),
			this.repo.allByType('evacuee', isEvacuee)
		]);
		if (!household || !isActiveHouseholdStatus(migrateHouseholdV3ToV4(household).status)) return;
		if (evacuees.some((evacuee) => evacuee.household_id === householdId)) return;

		const latest = await this.repo.get<Household>(householdId);
		if (!latest || !isActiveHouseholdStatus(migrateHouseholdV3ToV4(latest).status)) return;
		await this.repo.put(touch({ ...latest, head_evacuee_id: null, status: 'cancelled' as const }));
	}

	createScreening(input: ScreeningInput, ctx: AuthorContext): Promise<Screening> {
		return this.repo.put(buildScreening(input, ctx));
	}

	async recordMedicalScreening(
		input: {
			screening: ScreeningInput;
			zone?: string | null;
			checkIn?: boolean;
			medical?: MedicalInput;
		},
		ctx: AuthorContext
	): Promise<{ screening: Screening; evacuee?: Evacuee; medical?: Medical }> {
		const screening = await this.createScreening(input.screening, ctx);
		let evacuee: Evacuee | undefined;
		if (input.checkIn && input.zone) {
			const targetEvacuee = await this.getEvacuee(input.screening.evacuee_id);
			if (!targetEvacuee) {
				throw new Error('ไม่พบข้อมูลผู้ประสบภัย');
			}
			evacuee = await this.checkInEvacuee(targetEvacuee, ctx, input.zone);
		}
		let medical: Medical | undefined;
		if (input.medical) {
			const existingMedicals = await this.repo.find<Medical>({
				selector: { type: 'medical', evacuee_id: input.screening.evacuee_id },
				limit: 1
			});
			const existing = existingMedicals.find(isMedical);
			if (existing) {
				medical = await this.updateMedical({
					...existing,
					...input.medical,
					evacuee_id: input.screening.evacuee_id
				});
			} else {
				medical = await this.createMedical(
					{ ...input.medical, evacuee_id: input.screening.evacuee_id },
					ctx
				);
			}
		}
		return { screening, ...(evacuee ? { evacuee } : {}), ...(medical ? { medical } : {}) };
	}

	async createEvacueeWithScreening(
		input: EvacueeInput,
		screening: Omit<ScreeningInput, 'evacuee_id'> & { evacuee_id?: string },
		ctx: AuthorContext
	): Promise<{ evacuee: Evacuee; screening: Screening }> {
		const evacuee = await this.createEvacuee(input, ctx);
		try {
			const screeningDoc = await this.createScreening(
				{ ...screening, evacuee_id: evacuee._id },
				ctx
			);
			return { evacuee, screening: screeningDoc };
		} catch (err) {
			await this.compensateFailedEvacueeRegistration(evacuee._id);
			throw err;
		}
	}

	async compensateFailedEvacueeRegistration(evacueeId: string): Promise<void> {
		const medicals = await this.repo.find<Medical>({
			selector: { type: 'medical', evacuee_id: evacueeId },
			limit: 100
		});
		for (const medical of medicals.filter(isMedical)) {
			try {
				await this.repo.remove(medical);
			} catch {
				// Best-effort compensation; surface the original save error to the UI.
			}
		}

		const latest = await this.repo.get<Evacuee>(evacueeId);
		if (latest) {
			try {
				await this.repo.remove(latest);
			} catch {
				// Best-effort compensation.
			}
		}
	}

	async compensateFailedHouseholdCreate(householdId: string): Promise<void> {
		const latestDoc = await this.repo.get<Household>(householdId);
		if (!latestDoc) return;
		const latest = migrateHouseholdV3ToV4(latestDoc);
		if (latest.status !== 'arriving' && latest.status !== 'pre_registered') return;
		const members = await this.listHouseholdMembers(householdId);
		if (members.length > 0) return;
		try {
			await this.repo.remove(latest);
		} catch {
			// Best-effort compensation.
		}
	}

	createMedical(input: MedicalInput, ctx: AuthorContext): Promise<Medical> {
		return this.repo.put(buildMedical(input, ctx));
	}

	listMedicals(): Promise<Medical[]> {
		return this.repo.allByType('medical', isMedical);
	}

	async updateMedical(medical: Medical): Promise<Medical> {
		const latest = await this.repo.get<Medical>(medical._id);
		if (!latest) throw new Error('ไม่พบข้อมูลสุขภาพ');
		return this.repo.put(touch({ ...medical, _rev: latest._rev }));
	}

	async patchMedical(id: string, patch: MedicalPatch): Promise<Medical> {
		const latest = await this.repo.get<Medical>(id);
		if (!latest) throw new Error('ไม่พบข้อมูลสุขภาพ');
		return this.repo.put(touch({ ...latest, ...patch }));
	}

	async deleteMedical(id: string): Promise<void> {
		const latest = await this.repo.get<Medical>(id);
		if (latest) await this.repo.remove(latest);
	}

	listMovements(): Promise<Movement[]> {
		return this.repo.allByType('movement', isMovement);
	}

	listScreenings(): Promise<Screening[]> {
		return this.repo.allByType('screening', isScreening);
	}

	async getPendingScreeningEvacuees(shelterCode?: string): Promise<Evacuee[]> {
		const [allEvacuees, screenings] = await Promise.all([
			this.repo.allByType('evacuee', isEvacuee),
			this.repo.allByType('screening', isScreening)
		]);
		const screenedIds = new Set(screenings.map((s) => s.evacuee_id));
		return allEvacuees.filter((e) => {
			if (
				shelterCode &&
				e.shelter_code &&
				e.shelter_code.toUpperCase() !== shelterCode.toUpperCase()
			) {
				return false;
			}
			const status = e.current_stay?.status;
			const isPendingStatus = status === 'arriving' || status === 'pre_registered';
			return isPendingStatus && !screenedIds.has(e._id);
		});
	}

	async checkInEvacuee(evacuee: Evacuee, ctx: AuthorContext, zone: string): Promise<Evacuee> {
		const nextZone = zone.trim();
		if (!nextZone) {
			throw new Error('การเช็คอินต้องระบุโซน');
		}
		assertMovementAllowed(evacuee, 'check_in');
		const movement = createMovement(
			{ evacuee_id: evacuee._id, action: 'check_in', zone: nextZone },
			ctx
		);
		await this.repo.put(movement);

		const latest = await this.repo.get<Evacuee>(evacuee._id);
		const updated = await this.repo.put(
			applyMovementToStay({ ...evacuee, _rev: latest?._rev ?? evacuee._rev }, movement)
		);
		await this.refreshDerivedHouseholdStatus(updated.household_id);
		return updated;
	}

	/** Record a check-out movement, then apply it to the evacuee's current_stay.
	 *  Fetches the latest _rev first to avoid stale-revision conflicts from live sync.
	 *  Check-out requires a nonempty trimmed reason/notes (CR-112). */
	async checkOutEvacuee(
		evacuee: Evacuee,
		ctx: AuthorContext,
		opts: { reason?: string; notes?: string } = {}
	): Promise<Evacuee> {
		const reason = (opts.reason ?? opts.notes ?? '').trim();
		assertMovementAllowed(evacuee, 'check_out', { reason });
		const movement = createMovement(
			{ evacuee_id: evacuee._id, action: 'check_out', zone: null, reason },
			ctx
		);
		await this.repo.put(movement);
		const latest = await this.repo.get<Evacuee>(evacuee._id);
		const updated = await this.repo.put(
			applyMovementToStay({ ...evacuee, _rev: latest?._rev ?? evacuee._rev }, movement)
		);
		await this.refreshDerivedHouseholdStatus(updated.household_id);
		return updated;
	}

	/** Zone Arrival Confirmation: active → room_confirmed (CR-112). */
	async confirmRoom(evacuee: Evacuee, ctx: AuthorContext): Promise<Evacuee> {
		assertMovementAllowed(evacuee, 'confirm_room');
		const movement = createMovement(
			{
				evacuee_id: evacuee._id,
				action: 'confirm_room',
				zone: evacuee.current_stay.zone
			},
			ctx
		);
		await this.repo.put(movement);
		const latest = await this.repo.get<Evacuee>(evacuee._id);
		const updated = await this.repo.put(
			applyMovementToStay({ ...evacuee, _rev: latest?._rev ?? evacuee._rev }, movement)
		);
		await this.refreshDerivedHouseholdStatus(updated.household_id);
		return updated;
	}

	/** Bulk Zone Arrival Confirmation for every pending member of a Household. */
	async confirmRoomForHousehold(
		householdId: string,
		evacuees: readonly Evacuee[],
		ctx: AuthorContext
	): Promise<Evacuee[]> {
		const pending = listPendingZoneArrivalConfirmations(
			evacuees.filter((e) => e.household_id === householdId)
		);
		const results: Evacuee[] = [];
		for (const evacuee of pending) {
			results.push(await this.confirmRoom(evacuee, ctx));
		}
		return results;
	}

	/** Rezone an active/room_confirmed evacuee via append-only `zone_change` (CR-106/CR-112). */
	async changeEvacueeZone(evacuee: Evacuee, ctx: AuthorContext, zone: string): Promise<Evacuee> {
		const nextZone = zone.trim();
		if (!nextZone) {
			throw new Error('การเปลี่ยนโซนต้องระบุโซนปลายทาง');
		}
		assertMovementAllowed(evacuee, 'zone_change');
		const movement = createMovement(
			{ evacuee_id: evacuee._id, action: 'zone_change', zone: nextZone },
			ctx
		);
		await this.repo.put(movement);
		const latest = await this.repo.get<Evacuee>(evacuee._id);
		const updated = await this.repo.put(
			applyMovementToStay({ ...evacuee, _rev: latest?._rev ?? evacuee._rev }, movement)
		);
		await this.refreshDerivedHouseholdStatus(updated.household_id);
		return updated;
	}

	/** Record a non-check-in/out movement, then apply it to the evacuee's current_stay.
	 *  Fetches the latest _rev first to avoid stale-revision conflicts from live sync. */
	async recordMovement(
		evacuee: Evacuee,
		action: Exclude<MovementAction, 'check_in' | 'check_out' | 'confirm_room'>,
		ctx: AuthorContext
	): Promise<Evacuee> {
		assertMovementAllowed(evacuee, action);
		const movement = createMovement(
			{ evacuee_id: evacuee._id, action, zone: evacuee.current_stay.zone },
			ctx
		);
		await this.repo.put(movement);
		const latest = await this.repo.get<Evacuee>(evacuee._id);
		const updated = await this.repo.put(
			applyMovementToStay({ ...evacuee, _rev: latest?._rev ?? evacuee._rev }, movement)
		);
		await this.refreshDerivedHouseholdStatus(updated.household_id);
		return updated;
	}

	async cancelPreRegistration(householdId: string, ctx: AuthorContext): Promise<void> {
		const household = await this.getHousehold(householdId);
		if (!household) {
			throw new Error('ไม่พบข้อมูลครัวเรือน');
		}
		if (household.status !== 'pre_registered') {
			throw new Error('สามารถยกเลิกได้เฉพาะครัวเรือนที่อยู่ในสถานะลงทะเบียนล่วงหน้าเท่านั้น');
		}
		assertHouseholdStatusTransition(household.status, 'cancelled');

		const members = await this.listHouseholdMembers(householdId);
		const since = now();
		let cancelledMembers = 0;

		for (const member of members) {
			if (member.current_stay.status !== 'pre_registered') continue;
			await this.repo.put(
				touch({
					...member,
					current_stay: {
						...member.current_stay,
						status: 'cancelled' as const,
						since
					}
				})
			);
			cancelledMembers += 1;
		}

		const updatedHousehold = touch({
			...household,
			status: 'cancelled' as const
		});
		await this.repo.put(updatedHousehold);

		const audit = createAuditEntry(
			{
				action: 'other',
				target_type: 'household',
				target_id: householdId,
				reason: 'ยกเลิกการลงทะเบียนครัวเรือนล่วงหน้า',
				context: {
					previous_status: household.status,
					next_status: 'cancelled',
					member_count: members.length,
					cancelled_member_count: cancelledMembers
				}
			},
			ctx
		);
		await this.repo.put(audit);
	}

	async cancelEvacueePreRegistration(evacueeId: string, ctx: AuthorContext): Promise<void> {
		const evacuee = await this.getEvacuee(evacueeId);
		if (!evacuee) {
			throw new Error('ไม่พบข้อมูลผู้ประสบภัย');
		}
		if (!canCancelEvacueePreRegistration(evacuee)) {
			throw new Error('สามารถยกเลิกได้เฉพาะผู้ที่อยู่ในสถานะลงทะเบียนล่วงหน้าเท่านั้น');
		}

		const since = now();
		await this.repo.put(
			touch({
				...evacuee,
				current_stay: {
					...evacuee.current_stay,
					status: 'cancelled' as const,
					since
				}
			})
		);

		const audit = createAuditEntry(
			{
				action: 'other',
				target_type: 'evacuee',
				target_id: evacueeId,
				reason: 'ยกเลิกการลงทะเบียนล่วงหน้า',
				context: {
					previous_status: 'pre_registered',
					next_status: 'cancelled',
					household_id: evacuee.household_id
				}
			},
			ctx
		);
		await this.repo.put(audit);

		if (!evacuee.household_id) return;

		const household = await this.getHousehold(evacuee.household_id);
		if (!household || household.status !== 'pre_registered') return;

		const members = await this.listHouseholdMembers(household._id);
		const stillPreRegistered = members.some(
			(m) => m._id !== evacueeId && m.current_stay.status === 'pre_registered'
		);
		if (stillPreRegistered) return;

		assertHouseholdStatusTransition(household.status, 'cancelled');
		await this.repo.put(
			touch({
				...household,
				status: 'cancelled' as const
			})
		);

		const householdAudit = createAuditEntry(
			{
				action: 'other',
				target_type: 'household',
				target_id: household._id,
				reason: 'ยกเลิกการลงทะเบียนครัวเรือนล่วงหน้า — ไม่มีสมาชิกค้าง pre_registered',
				context: {
					previous_status: 'pre_registered',
					next_status: 'cancelled',
					triggered_by_evacuee_id: evacueeId
				}
			},
			ctx
		);
		await this.repo.put(householdAudit);
	}

	/**
	 * Station 1 Report-in: promote `pre_registered` → `arriving`, zone null.
	 * Does not create screening or assign a zone (CR-106 FR-03d).
	 */
	async promoteReportIn(evacueeId: string): Promise<Evacuee> {
		const latest = await this.repo.get<Evacuee>(evacueeId);
		if (!latest || !isEvacuee(latest)) {
			throw new Error('ไม่พบข้อมูลผู้ประสบภัย');
		}
		if (latest.current_stay.status !== 'pre_registered') {
			throw new Error('รายงานตัวได้เฉพาะผู้ที่ลงทะเบียนล่วงหน้า (pre_registered)');
		}
		const saved = await this.repo.put(
			touch({
				...latest,
				current_stay: {
					status: 'arriving' as const,
					zone: null,
					since: now()
				}
			})
		);

		await this.refreshDerivedHouseholdStatus(saved.household_id);
		return saved;
	}
}

let singleton: PeopleRepository | null = null;
let singletonDbName: string | null = null;

export function peopleRepository(shelterCode?: string): PeopleRepository {
	const currentDb = getShelterDb(shelterCode);
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new PeopleRemoteRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}
