import { createRemoteRepository, type Repository, type PaginatedResult } from '$lib/db/repository';
import { touch, type AuthorContext } from '$lib/db/model';
import { getShelterDb } from '$lib/db/shelter';
import { createAuditEntry } from '$lib/features/shared';
import {
	createEvacuee as buildEvacuee,
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
	assertEvacueeHouseholdAssignment,
	assertHouseholdStatusTransition,
	isActiveHouseholdStatus,
	type Medical,
	type Movement
} from '../domain/people';
import type { HouseholdSearchLabels, PeopleRepository } from './people.repository';

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
		search?: string
	): Promise<PaginatedResult<Evacuee>> {
		const all = await this.repo.allByType('evacuee', isEvacuee);
		const q = search?.trim();
		const matched = q ? all.filter((e) => matchesEvacueeSearch(e, q)) : all;
		return paginateSlice(matched, page, pageSize);
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

		const saved = await this.repo.put(touch({ ...evacuee, _rev: latest._rev }));
		if (oldHouseholdId && oldHouseholdId !== saved.household_id) {
			await this.cancelHouseholdIfEmpty(oldHouseholdId);
		}
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
		labels?: HouseholdSearchLabels
	): Promise<PaginatedResult<Household>> {
		let all = await this.repo.allByType('household', isHousehold);
		all = all.map(migrateHouseholdV3ToV4);
		const q = search?.trim();
		if (q) {
			const evacuees = await this.repo.allByType('evacuee', isEvacuee);
			const headNames = new Map(
				evacuees.map((e) => [e._id, `${e.first_name} ${e.last_name}`.toLowerCase()])
			);
			all = all.filter((h) =>
				matchesHouseholdSearch(h, q, headNames.get(h.head_evacuee_id ?? '') ?? '', labels)
			);
		}
		return paginateSlice(all, page, pageSize);
	}

	async getHousehold(id: string): Promise<Household | null> {
		const doc = await this.repo.get<Household>(id);
		return doc ? migrateHouseholdV3ToV4(doc) : null;
	}

	async updateHousehold(household: Household): Promise<Household> {
		const latestDoc = await this.repo.get<Household>(household._id);
		if (!latestDoc) throw new Error('ไม่พบข้อมูลครัวเรือน');
		const latest = migrateHouseholdV3ToV4(latestDoc);
		assertHouseholdStatusTransition(latest.status, household.status);
		return this.repo.put(touch({ ...household, _rev: latest._rev }));
	}

	private async cancelHouseholdIfEmpty(householdId: string): Promise<void> {
		const [household, evacuees] = await Promise.all([
			this.repo.get<Household>(householdId),
			this.repo.allByType('evacuee', isEvacuee)
		]);
		if (!household || !isActiveHouseholdStatus(migrateHouseholdV3ToV4(household).status)) return;
		if (evacuees.some((evacuee) => evacuee.household_id === householdId)) return;

		const latest = await this.repo.get<Household>(householdId);
		if (!latest || !isActiveHouseholdStatus(migrateHouseholdV3ToV4(latest).status)) return;
		await this.repo.put(touch({ ...latest, status: 'cancelled' as const }));
	}

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

	async checkInEvacuee(
		evacuee: Evacuee,
		ctx: AuthorContext,
		zone: string | null = null
	): Promise<Evacuee> {
		assertMovementAllowed(evacuee, 'check_in');
		const movement = createMovement({ evacuee_id: evacuee._id, action: 'check_in', zone }, ctx);
		await this.repo.put(movement);

		if (evacuee.household_id) {
			const hh = await this.repo.get<Household>(evacuee.household_id);
			if (hh && (hh.status === 'pre_registered' || hh.status === 'arriving')) {
				await this.repo.put(
					touch({
						...hh,
						status: 'checked_in' as const
					})
				);
			}
		}

		const latest = await this.repo.get<Evacuee>(evacuee._id);
		return this.repo.put(
			applyMovementToStay({ ...evacuee, _rev: latest?._rev ?? evacuee._rev }, movement)
		);
	}

	/** Record a check-out movement, then apply it to the evacuee's current_stay.
	 *  Fetches the latest _rev first to avoid stale-revision conflicts from live sync. */
	async checkOutEvacuee(evacuee: Evacuee, ctx: AuthorContext): Promise<Evacuee> {
		assertMovementAllowed(evacuee, 'check_out');
		const movement = createMovement(
			{ evacuee_id: evacuee._id, action: 'check_out', zone: null },
			ctx
		);
		await this.repo.put(movement);
		const latest = await this.repo.get<Evacuee>(evacuee._id);
		return this.repo.put(
			applyMovementToStay({ ...evacuee, _rev: latest?._rev ?? evacuee._rev }, movement)
		);
	}

	async cancelPreRegistration(householdId: string, ctx: AuthorContext): Promise<void> {
		const household = await this.getHousehold(householdId);
		if (!household) {
			throw new Error('ไม่พบข้อมูลครัวเรือน');
		}
		if (household.status !== 'pre_registered') {
			throw new Error('สามารถยกเลิกได้เฉพาะครัวเรือนที่อยู่ในสถานะลงทะเบียนล่วงหน้าเท่านั้น');
		}

		const members = await this.listHouseholdMembers(householdId);

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
					member_count: members.length
				}
			},
			ctx
		);
		await this.repo.put(audit);
	}
}

let singleton: PeopleRepository | null = null;
let singletonDbName: string | null = null;

export function peopleRepository(): PeopleRepository {
	const currentDb = getShelterDb();
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new PeopleRemoteRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}
