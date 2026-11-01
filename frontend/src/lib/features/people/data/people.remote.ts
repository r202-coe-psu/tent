import { bulkDocsDetailed } from '$lib/db/couch-db';
import { paginateItems } from '$lib/db/paginate';
import { createRemoteRepository, type Repository, type PaginatedResult } from '$lib/db/repository';
import { makeDocId, now, touch, type AuthorContext } from '$lib/db/model';
import { ulid } from '$lib/db/ulid';
import type { UlidReservation } from '$lib/db/ulid-reservation';
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
	type EmergencyContact,
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
	canCancelHouseholdPreRegistration,
	replacePersonId,
	migrateVulnerableGroupCode,
	migrateVulnerableGroupCodes,
	listPendingZoneArrivalConfirmations,
	type Medical,
	type MedicalInput,
	type Movement,
	type MovementAction,
	dormFieldsFor,
	memberExtrasFor,
	registrationMedicalInput,
	withoutBookingRef
} from '../domain/people';
import {
	planFamilyRegistration,
	planMemberConsents,
	type FamilyReportInPayload,
	type RegistrationConsent,
	type UnifiedRegistrationChannel,
	type UnifiedRegistrationInput
} from '../domain/unified-registration';
import {
	bindConsent,
	EVACUEE_SCHEMA_V,
	type MemberConsentPlan
} from '$lib/features/consent/server';
import { autoHouseholdLabel } from '../domain/registration-shell';
import { planSearchVisibilityChange } from '../domain/search-visibility';
import {
	STATION_LOG_STALE_WINDOW_MS,
	createStationLog,
	hasOpenStationStart,
	type StationLogInput,
	type StationNumber
} from '../domain/station-log';
import type {
	EvacueeFilters,
	EvacueePatch,
	HouseholdFilters,
	HouseholdPatch,
	HouseholdSearchLabels,
	MedicalPatch,
	PeopleRepository,
	StationLogWriteOptions
} from './people.repository';

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

function hasEvacueeClientFilters(search?: string, filters?: EvacueeFilters): boolean {
	return !!(search?.trim() || filters?.specialNeed || filters?.zone || filters?.status);
}

function hasHouseholdClientFilters(search?: string, filters?: HouseholdFilters): boolean {
	return !!(search?.trim() || filters?.status);
}

function consentWrite(
	plan: MemberConsentPlan | undefined,
	registrantEvacueeId: string | undefined
) {
	if (!plan) return null;
	if (!registrantEvacueeId) throw new Error('ต้องมีสมาชิกอย่างน้อย 1 คน');
	return bindConsent(plan, registrantEvacueeId);
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

	/**
	 * Append staff `station_log` docs (CR-192). Best-effort: a failure never reaches the caller as
	 * a rejection — the station action it describes already succeeded (FR-STL-04) — it is only
	 * reported through `onStationLogError` so the UI can warn.
	 */
	private async writeStationLogs(
		entries: readonly Omit<StationLogInput, 'channel'>[],
		ctx: AuthorContext,
		opts?: StationLogWriteOptions
	): Promise<void> {
		if (entries.length === 0) return;
		try {
			await this.repo.bulkDocs(
				entries.map((entry) => createStationLog({ ...entry, channel: 'staff' }, ctx))
			);
		} catch (err) {
			if (opts?.onStationLogError) opts.onStationLogError(err);
			else console.warn('Failed to record station_log:', err);
		}
	}

	/**
	 * Station 1 form logs: `start` (the form-open time, never in the future) + `complete` (now)
	 * for each saved member. Only when the caller passed `startedAt` (CR-192 O11).
	 */
	private async writeStationOneLogs(
		evacueeIds: readonly string[],
		ctx: AuthorContext,
		opts?: StationLogWriteOptions
	): Promise<void> {
		if (!opts?.startedAt) return;
		const completedAt = now();
		const parsed = Date.parse(opts.startedAt);
		const startedAt =
			Number.isFinite(parsed) && parsed < Date.parse(completedAt)
				? new Date(parsed).toISOString()
				: completedAt;
		await this.writeStationLogs(
			evacueeIds.flatMap((evacuee_id) => [
				{ evacuee_id, station: 1 as const, action: 'start' as const, occurred_at: startedAt },
				{ evacuee_id, station: 1 as const, action: 'complete' as const, occurred_at: completedAt }
			]),
			ctx,
			opts
		);
	}

	async recordStationStart(
		evacueeId: string,
		station: StationNumber,
		ctx: AuthorContext
	): Promise<boolean> {
		const nowMs = Date.now();
		// Only logs inside the stale window can make a `start` live, so the Mango range stays tiny.
		const recent = await this.repo.find<{ action: 'start' | 'complete'; occurred_at: string }>({
			selector: {
				type: 'station_log',
				evacuee_id: evacueeId,
				station,
				occurred_at: { $gte: new Date(nowMs - STATION_LOG_STALE_WINDOW_MS).toISOString() }
			},
			limit: 100
		});
		if (hasOpenStationStart(recent, nowMs)) return false;
		await this.repo.put(
			createStationLog({ evacuee_id: evacueeId, station, action: 'start', channel: 'staff' }, ctx)
		);
		return true;
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
				const evacuee = buildEvacuee(parsedInput, ctx, null);
				saved = await this.repo.put(evacuee);
			}
		} else {
			const evacuee = buildEvacuee(parsedInput, ctx, null);
			saved = await this.repo.put(evacuee);
		}

		const medicalInput = registrationMedicalInput(input, saved._id, null, input.track || 'normal');
		if (medicalInput) {
			const medicalDoc = buildMedical(medicalInput, ctx);

			try {
				await this.repo.put(medicalDoc);
			} catch (err) {
				await this.compensateFailedEvacueeRegistration(saved._id);
				throw err;
			}
		}

		if (saved.current_stay.zone) {
			try {
				const movement = createMovement(
					{ evacuee_id: saved._id, action: 'check_in', zone: saved.current_stay.zone },
					ctx
				);
				await this.repo.put(movement);
			} catch (err) {
				console.warn('Failed to record initial check-in movement:', err);
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
		// Unfiltered: limited `_all_docs` page (server-side). Filters/search still need a
		// full prefix scan until Mango indexes are provisioned.
		if (!hasEvacueeClientFilters(search, filters)) {
			return this.repo.pageByType('evacuee', isEvacuee, page, pageSize);
		}
		const matched = await this.filterEvacuees(search, filters);
		return paginateItems(matched, page, pageSize);
	}

	async listMatchingEvacueeIds(search?: string, filters?: EvacueeFilters): Promise<string[]> {
		const matched = await this.filterEvacuees(search, filters);
		return matched.map((e) => e._id);
	}

	async listCancellableEvacueeIds(ids: readonly string[]): Promise<string[]> {
		if (ids.length === 0) return [];
		const wanted = new Set(ids);
		const all = await this.repo.allByType('evacuee', isEvacuee);
		return all
			.filter((e) => wanted.has(e._id) && canCancelEvacueePreRegistration(e))
			.map((e) => e._id);
	}

	private async filterEvacuees(search?: string, filters?: EvacueeFilters): Promise<Evacuee[]> {
		const all = await this.repo.allByType('evacuee', isEvacuee);
		const q = search?.trim();
		let matched = q ? all.filter((e) => matchesEvacueeSearch(e, q)) : all;
		if (filters?.specialNeed) {
			// Filter key kept as `specialNeed` for callers; matches `vulnerable_groups` (CR-112).
			const want = migrateVulnerableGroupCode(filters.specialNeed);
			matched = matched.filter((e) =>
				migrateVulnerableGroupCodes(e.vulnerable_groups ?? []).includes(want)
			);
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
			await this.repairHouseholdHeadIfNeeded(oldHouseholdId);
			await this.refreshDerivedHouseholdStatus(oldHouseholdId);
		}
		await this.refreshDerivedHouseholdStatus(saved.household_id);
		return saved;
	}

	async setSearchVisibility(
		evacueeId: string,
		visible: boolean,
		ctx: AuthorContext
	): Promise<Evacuee | null> {
		const latest = await this.repo.get<Evacuee>(evacueeId);
		if (!latest) throw new Error('ไม่พบข้อมูลผู้ประสบภัย');
		const plan = planSearchVisibilityChange(latest, visible, ctx);
		if (!plan) return null;

		const [evacueeOutcome, auditOutcome] = await bulkDocsDetailed(this.dbName, [
			plan.evacuee,
			plan.audit
		]);
		if (!evacueeOutcome.ok) {
			throw new Error(
				`บันทึกการแสดงในระบบค้นหาญาติไม่สำเร็จ (${evacueeOutcome.id}: ${evacueeOutcome.error})`
			);
		}
		// _bulk_docs is not atomic: the change already landed, and a retry from the UI would be a
		// no-op, so the audit entry gets one more attempt here instead of being lost.
		if (!auditOutcome.ok) await this.repo.put(plan.audit);
		return { ...plan.evacuee, _rev: evacueeOutcome.rev };
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
			await this.repairHouseholdHeadIfNeeded(oldHouseholdId);
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

	async searchEvacueesMany(queries: readonly string[]): Promise<Map<string, Evacuee[]>> {
		const trimmed = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
		const results = new Map<string, Evacuee[]>();
		if (trimmed.length === 0) return results;
		const all = await this.repo.allByType('evacuee', isEvacuee);
		for (const q of trimmed) {
			results.set(
				q,
				all.filter((e) => matchesEvacueeSearch(e, q))
			);
		}
		return results;
	}

	createHousehold(input: HouseholdInput, ctx: AuthorContext): Promise<Household> {
		return this.repo.put(buildHousehold(input, ctx));
	}

	/**
	 * Unified multi-person registration (#249): create N Evacuees then 1 Household,
	 * link members, set head = members[0]. Compensates created docs on failure
	 * (intentional — keep even with the 20-member / pets / vehicles batch caps).
	 *
	 * Join mode (`join_household_id`): create members linked to an existing Household;
	 * do not mint Household or overwrite Residence / head; append pets/vehicles/assets.
	 */
	async createFamilyRegistration(
		input: UnifiedRegistrationInput,
		ctx: AuthorContext,
		channel: UnifiedRegistrationChannel = 'onsite',
		ids?: UlidReservation,
		consent: RegistrationConsent | null = null,
		stationLog?: StationLogWriteOptions
	): Promise<{ household: Household; members: Evacuee[] }> {
		const plan = planFamilyRegistration(input, channel);
		const consentPlans = planMemberConsents(
			consent,
			channel === 'onsite' ? 'staff' : 'web',
			plan.memberInputs.map(() => false)
		);
		// Same reservation + same input on a retry → same doc IDs → idempotent 409s.
		ids?.rewind();
		const nextUlid = () => ids?.next() ?? ulid();
		const createdMemberIds: string[] = [];
		let householdId: string | null = null;

		if (plan.mode === 'join') {
			const targetId = plan.targetHouseholdId;
			if (!targetId) throw new Error('ไม่พบครัวเรือนปลายทาง');

			try {
				const targetDoc = await this.repo.get<Household>(targetId);
				if (!targetDoc) throw new Error('ไม่พบครัวเรือนปลายทาง');
				const target = migrateHouseholdV3ToV4(targetDoc);
				if (!isActiveHouseholdStatus(target.status)) {
					throw new Error('ไม่สามารถเพิ่มสมาชิกเข้าครัวเรือนที่ยกเลิกหรือเช็คเอาท์แล้ว');
				}

				const memberDocs: Evacuee[] = [];
				const medicalDocs: Medical[] = [];
				const movementDocs: Movement[] = [];

				for (const [i, memberInput] of plan.memberInputs.entries()) {
					const memberUlid = nextUlid();
					const memberId = makeDocId('evacuee', memberUlid);
					createdMemberIds.push(memberId);

					const write = consentWrite(consentPlans[i], createdMemberIds[0]);
					const evacuee = buildEvacuee(
						{ ...memberInput, household_id: targetId },
						ctx,
						write,
						memberUlid
					);
					memberDocs.push(evacuee);

					const medicalInput = registrationMedicalInput(
						memberInput,
						evacuee._id,
						write,
						memberInput.track || 'normal'
					);
					if (medicalInput) medicalDocs.push(buildMedical(medicalInput, ctx, nextUlid()));

					if (evacuee.current_stay.zone) {
						movementDocs.push(
							createMovement(
								{ evacuee_id: evacuee._id, action: 'check_in', zone: evacuee.current_stay.zone },
								ctx,
								nextUlid()
							)
						);
					}
				}

				const appendPets = (plan.householdInput.pets ?? []) as Household['pets'];
				const appendVehicles = (plan.householdInput.vehicles ?? []) as Household['vehicles'];
				const appendAssets = (plan.householdInput.assets ?? null) as Household['assets'];
				const hasAppend =
					appendPets.length > 0 || appendVehicles.length > 0 || appendAssets != null;

				let updatedHouseholdDoc: Household | null = null;
				if (hasAppend) {
					const mergedAssets =
						appendAssets == null
							? target.assets
							: target.assets
								? {
										description: [target.assets.description, appendAssets.description]
											.filter(Boolean)
											.join('\n')
											.trim(),
										image_url: target.assets.image_url ?? appendAssets.image_url ?? null
									}
								: appendAssets;
					updatedHouseholdDoc = touch({
						...target,
						pets: [...(target.pets ?? []), ...appendPets],
						vehicles: [...(target.vehicles ?? []), ...appendVehicles],
						assets: mergedAssets
					});
				}

				const docsToWrite: Array<{ _id: string; _rev?: string }> = updatedHouseholdDoc
					? [updatedHouseholdDoc, ...memberDocs, ...medicalDocs, ...movementDocs]
					: [...memberDocs, ...medicalDocs, ...movementDocs];

				const savedDocs = await this.repo.bulkDocs(docsToWrite);

				const members = memberDocs.map((m) => {
					const saved = savedDocs.find((d) => d._id === m._id) as Evacuee | undefined;
					return saved ?? m;
				});

				let household: Household;
				if (updatedHouseholdDoc) {
					household =
						(savedDocs.find((d) => d._id === targetId) as Household) ?? updatedHouseholdDoc;
				} else {
					household = target;
				}

				// Members are committed from here on — a failed status refresh (network
				// flap) must not fall through to compensation and delete them.
				try {
					await this.refreshDerivedHouseholdStatus(targetId);
					const refreshed = await this.getHousehold(targetId);
					household = refreshed ?? household;
				} catch {
					// Derived status is recomputed on the next household write.
				}

				await this.writeStationOneLogs(
					members.map((m) => m._id),
					ctx,
					stationLog
				);
				return { household, members };
			} catch (err) {
				const complete = await this.compensateFailedFamilyRegistration(createdMemberIds, null);
				throw markCompensationResult(err, complete);
			}
		}

		try {
			if (plan.memberInputs.length === 0) {
				throw new Error('ต้องมีสมาชิกอย่างน้อย 1 คน');
			}

			const householdUlid = nextUlid();
			householdId = makeDocId('household', householdUlid);

			const memberUlids = plan.memberInputs.map(() => nextUlid());
			const memberIds = memberUlids.map((u) => makeDocId('evacuee', u));
			createdMemberIds.push(...memberIds);
			const headId = memberIds[0];

			const householdDoc = buildHousehold(
				{ ...plan.householdInput, head_evacuee_id: headId },
				ctx,
				householdUlid
			);

			const memberDocs: Evacuee[] = [];
			const medicalDocs: Medical[] = [];
			const movementDocs: Movement[] = [];

			for (let i = 0; i < plan.memberInputs.length; i++) {
				const memberInput = plan.memberInputs[i];
				const write = consentWrite(consentPlans[i], headId);
				const evacuee = buildEvacuee(
					{ ...memberInput, household_id: householdId },
					ctx,
					write,
					memberUlids[i]
				);
				memberDocs.push(evacuee);

				const medicalInput = registrationMedicalInput(
					memberInput,
					evacuee._id,
					write,
					memberInput.track || 'normal'
				);
				if (medicalInput) medicalDocs.push(buildMedical(medicalInput, ctx, nextUlid()));

				if (evacuee.current_stay.zone) {
					movementDocs.push(
						createMovement(
							{ evacuee_id: evacuee._id, action: 'check_in', zone: evacuee.current_stay.zone },
							ctx,
							nextUlid()
						)
					);
				}
			}

			const docsToWrite: Array<{ _id: string; _rev?: string }> = [
				householdDoc,
				...memberDocs,
				...medicalDocs,
				...movementDocs
			];
			const savedDocs = await this.repo.bulkDocs(docsToWrite);

			const household =
				(savedDocs.find((d) => d._id === householdId) as Household | undefined) ?? householdDoc;
			const members = memberDocs.map((m) => {
				const saved = savedDocs.find((d) => d._id === m._id) as Evacuee | undefined;
				return saved ?? m;
			});

			await this.writeStationOneLogs(
				members.map((m) => m._id),
				ctx,
				stationLog
			);
			return { household, members };
		} catch (err) {
			const complete = await this.compensateFailedFamilyRegistration(createdMemberIds, householdId);
			throw markCompensationResult(err, complete);
		}
	}

	/**
	 * Undo a failed family submit: members (and their medical docs) first, then
	 * the household once it has no members left. Never throws — a cleanup error
	 * (typically still offline) must not replace the original save error.
	 * Returns false when any step failed, i.e. docs may remain in CouchDB.
	 * Append-only `check_in` movements are never removed (schema.md §7 rule 2).
	 */
	private async compensateFailedFamilyRegistration(
		memberIds: readonly string[],
		householdId: string | null
	): Promise<boolean> {
		let complete = true;
		for (const id of [...memberIds].reverse()) {
			try {
				await this.compensateFailedEvacueeRegistration(id);
			} catch {
				complete = false;
			}
		}
		if (householdId) {
			try {
				await this.compensateFailedHouseholdCreate(householdId);
			} catch {
				complete = false;
			}
		}
		return complete;
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
		if (!hasHouseholdClientFilters(search, filters)) {
			const result = await this.repo.pageByType('household', isHousehold, page, pageSize);
			return { ...result, items: result.items.map(migrateHouseholdV3ToV4) };
		}
		const matched = await this.filterHouseholds(search, labels, filters);
		return paginateItems(matched, page, pageSize);
	}

	async listMatchingHouseholdIds(
		search?: string,
		labels?: HouseholdSearchLabels,
		filters?: HouseholdFilters
	): Promise<string[]> {
		const matched = await this.filterHouseholds(search, labels, filters);
		return matched.map((h) => h._id);
	}

	async listCancellableHouseholdIds(ids: readonly string[]): Promise<string[]> {
		if (ids.length === 0) return [];
		const wanted = new Set(ids);
		const all = await this.repo.allByType('household', isHousehold);
		return all
			.map(migrateHouseholdV3ToV4)
			.filter((h) => wanted.has(h._id) && canCancelHouseholdPreRegistration(h))
			.map((h) => h._id);
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

	/**
	 * When a head evacuee leaves or a household lacks a valid head, assign the
	 * head role to an active remaining member (preferring an adult >= 18).
	 */
	private async repairHouseholdHeadIfNeeded(householdId: string): Promise<void> {
		const householdDoc = await this.repo.get<Household>(householdId);
		if (!householdDoc) return;
		const household = migrateHouseholdV3ToV4(householdDoc);
		if (!isActiveHouseholdStatus(household.status)) return;

		const members = await this.listHouseholdMembers(householdId);
		if (members.length === 0) return;

		const isHeadValid = members.some((m) => m._id === household.head_evacuee_id);
		if (!isHeadValid) {
			const adult = members.find((m) => typeof m.age === 'number' && m.age >= 18);
			const newHead = adult ?? members[0];
			await this.repo.put(
				touch({
					...household,
					head_evacuee_id: newHead._id,
					label: autoHouseholdLabel(formatPersonName(newHead))
				})
			);
		}
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
			vulnerable_groups?: string[];
			special_needs?: string[];
		},
		ctx: AuthorContext,
		stationLog?: StationLogWriteOptions
	): Promise<{ screening: Screening; evacuee?: Evacuee; medical?: Medical }> {
		const screening = await this.createScreening(input.screening, ctx);
		await this.writeStationLogs(
			[{ evacuee_id: input.screening.evacuee_id, station: 2, action: 'complete' }],
			ctx,
			stationLog
		);
		let evacuee: Evacuee | undefined;
		if (input.checkIn && input.zone) {
			const targetEvacuee = await this.getEvacuee(input.screening.evacuee_id);
			if (!targetEvacuee) {
				throw new Error('ไม่พบข้อมูลผู้ประสบภัย');
			}
			evacuee = await this.checkInEvacuee(targetEvacuee, ctx, input.zone, stationLog);
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
		const shouldPatchNeeds =
			input.vulnerable_groups !== undefined || input.special_needs !== undefined;
		if (shouldPatchNeeds) {
			const patch: EvacueePatch = {};
			if (input.vulnerable_groups !== undefined) {
				patch.vulnerable_groups = input.vulnerable_groups;
			}
			if (input.special_needs !== undefined) {
				patch.special_needs = input.special_needs;
			}
			evacuee = await this.patchEvacuee(input.screening.evacuee_id, patch);
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
		// Merge onto the fresh doc rather than overwriting it outright — safe
		// today because the sole caller (recordMedicalScreening) already
		// pre-merges, but a future partial-object caller must not silently
		// wipe fields it didn't intend to touch.
		return this.repo.put(touch({ ...latest, ...medical, _rev: latest._rev }));
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

	async getMedicalByEvacuee(evacueeId: string): Promise<Medical | null> {
		const medicals = await this.repo.find<Medical>({
			selector: { type: 'medical', evacuee_id: evacueeId },
			limit: 1
		});
		return medicals.find(isMedical) ?? null;
	}

	listMovements(): Promise<Movement[]> {
		return this.repo.allByType('movement', isMovement);
	}

	async listMovementsByEvacuee(evacueeId: string): Promise<Movement[]> {
		// CouchDB's Mango default limit is 25 — explicit limit avoids silently
		// truncating a long-lived evacuee's append-only movement history.
		const movements = await this.repo.find<Movement>({
			selector: { type: 'movement', evacuee_id: evacueeId },
			limit: 10_000
		});
		return movements.filter(isMovement);
	}

	listScreenings(): Promise<Screening[]> {
		return this.repo.allByType('screening', isScreening);
	}

	async listScreeningsByEvacuee(evacueeId: string): Promise<Screening[]> {
		const screenings = await this.repo.find<Screening>({
			selector: { type: 'screening', evacuee_id: evacueeId },
			limit: 10_000
		});
		return screenings.filter(isScreening);
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

	/** Re-fetches the evacuee so movement eligibility and the applied patch are
	 *  built from the current document, not a possibly-stale caller-provided
	 *  copy — otherwise a concurrent edit (by anyone, on any field) made
	 *  between page-load and this write is silently clobbered, and CouchDB's
	 *  own conflict detection never gets a chance to fire (see people.remote.test.ts). */
	private async fetchLatestOrThrow(evacueeId: string): Promise<Evacuee> {
		const latest = await this.repo.get<Evacuee>(evacueeId);
		if (!latest) {
			throw new Error('ไม่พบข้อมูลผู้ประสบภัย (อาจถูกลบไปแล้ว)');
		}
		return latest;
	}

	async checkInEvacuee(
		evacuee: Evacuee,
		ctx: AuthorContext,
		zone: string,
		stationLog?: StationLogWriteOptions
	): Promise<Evacuee> {
		const nextZone = zone.trim();
		if (!nextZone) {
			throw new Error('การเช็คอินต้องระบุโซน');
		}
		const latest = await this.fetchLatestOrThrow(evacuee._id);
		assertMovementAllowed(latest, 'check_in');
		const movement = createMovement(
			{ evacuee_id: latest._id, action: 'check_in', zone: nextZone },
			ctx
		);
		await this.repo.put(movement);
		const updated = await this.repo.put(applyMovementToStay(latest, movement));
		// Station 3 `complete` (CR-192) — only for the zoning check-in of an `arriving` person; a
		// return from leave / re-check-in did not pass the zoning desk. Best-effort, before the
		// household refresh so a failing refresh cannot skip it.
		if (latest.current_stay.status === 'arriving') {
			await this.writeStationLogs(
				[{ evacuee_id: latest._id, station: 3, action: 'complete' }],
				ctx,
				stationLog
			);
		}
		await this.refreshDerivedHouseholdStatus(updated.household_id);
		return updated;
	}

	/** Record a check-out movement, then apply it to the evacuee's current_stay.
	 *  Fetches the latest revision first (see fetchLatestOrThrow).
	 *  Check-out requires a nonempty trimmed reason/notes (CR-112). */
	async checkOutEvacuee(
		evacuee: Evacuee,
		ctx: AuthorContext,
		opts: { reason?: string; notes?: string } = {}
	): Promise<Evacuee> {
		const reason = (opts.reason ?? opts.notes ?? '').trim();
		const latest = await this.fetchLatestOrThrow(evacuee._id);
		assertMovementAllowed(latest, 'check_out', { reason });
		const movement = createMovement(
			{ evacuee_id: latest._id, action: 'check_out', zone: null, reason },
			ctx
		);
		await this.repo.put(movement);
		const updated = await this.repo.put(applyMovementToStay(latest, movement));
		await this.refreshDerivedHouseholdStatus(updated.household_id);
		return updated;
	}

	/** Zone Arrival Confirmation: active → room_confirmed (CR-112). */
	async confirmRoom(evacuee: Evacuee, ctx: AuthorContext): Promise<Evacuee> {
		const latest = await this.fetchLatestOrThrow(evacuee._id);
		assertMovementAllowed(latest, 'confirm_room');
		const movement = createMovement(
			{
				evacuee_id: latest._id,
				action: 'confirm_room',
				zone: latest.current_stay.zone
			},
			ctx
		);
		await this.repo.put(movement);
		const updated = await this.repo.put(applyMovementToStay(latest, movement));
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
		const latest = await this.fetchLatestOrThrow(evacuee._id);
		assertMovementAllowed(latest, 'zone_change');
		const movement = createMovement(
			{ evacuee_id: latest._id, action: 'zone_change', zone: nextZone },
			ctx
		);
		await this.repo.put(movement);
		const updated = await this.repo.put(applyMovementToStay(latest, movement));
		await this.refreshDerivedHouseholdStatus(updated.household_id);
		return updated;
	}

	/** Record a non-check-in/out movement, then apply it to the evacuee's current_stay.
	 *  Fetches the latest revision first (see fetchLatestOrThrow). */
	async recordMovement(
		evacuee: Evacuee,
		action: Exclude<MovementAction, 'check_in' | 'check_out' | 'confirm_room'>,
		ctx: AuthorContext,
		opts?: { reason?: string }
	): Promise<Evacuee> {
		const latest = await this.fetchLatestOrThrow(evacuee._id);
		assertMovementAllowed(latest, action, opts);
		const movement = createMovement(
			{
				evacuee_id: latest._id,
				action,
				zone: latest.current_stay.zone,
				...(opts?.reason ? { reason: opts.reason } : {})
			},
			ctx
		);
		await this.repo.put(movement);
		const updated = await this.repo.put(applyMovementToStay(latest, movement));
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
					previous_status: evacuee.current_stay.status,
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
			(m) =>
				m._id !== evacueeId &&
				(m.current_stay.status === 'pre_registered' || m.current_stay.status === 'kiosk_registered')
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
		if (
			latest.current_stay.status !== 'pre_registered' &&
			latest.current_stay.status !== 'kiosk_registered'
		) {
			throw new Error(
				'รายงานตัวได้เฉพาะผู้ที่ลงทะเบียนล่วงหน้าหรือลงทะเบียนที่ตู้ (pre_registered / kiosk_registered)'
			);
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

	async submitFamilyReportIn(
		payload: FamilyReportInPayload,
		stationLog?: StationLogWriteOptions
	): Promise<{ household: Household; members: Evacuee[] }> {
		const {
			householdId,
			createHousehold = false,
			household: householdInput,
			members: memberInputs,
			ctx,
			ids,
			consent
		} = payload;
		ids?.rewind();
		const nextUlid = () => ids?.next() ?? ulid();
		const requestedHouseholdId = householdId?.trim() ?? '';
		if (!requestedHouseholdId && !createHousehold) {
			throw new Error('กรุณาเลือกครัวเรือนเดิมหรือยืนยันสร้างครัวเรือนใหม่');
		}

		// Reserve the create-path household id before any write. A retry after CouchDB
		// accepted the first write but the response was lost will find this same doc.
		const reservedHouseholdUlid = requestedHouseholdId ? null : nextUlid();
		const targetHouseholdId =
			requestedHouseholdId || makeDocId('household', reservedHouseholdUlid as string);
		const existingHousehold = await this.getHousehold(targetHouseholdId);
		if (requestedHouseholdId && !existingHousehold) {
			throw new Error('ไม่พบครัวเรือนปลายทาง');
		}
		let savedHousehold: Household;

		const normalizedPets: import('../domain/people').PetGroup[] = (householdInput.pets ?? []).map(
			(p) => {
				const item: import('../domain/people').PetGroup = {
					species: p.species,
					count: Math.max(1, Number(p.count) || 1)
				};
				if (p.notes) item.notes = p.notes;
				if (typeof p.has_cage === 'boolean') item.has_cage = p.has_cage;
				if (p.image_url) item.image_url = p.image_url;
				return item;
			}
		);

		const normalizedVehicles: import('../domain/people').HouseholdVehicle[] = (
			householdInput.vehicles ?? []
		).map((v) => ({
			type: v.type,
			license_plate: v.license_plate ?? null
		}));

		const docsToWrite: Array<{ _id: string; _rev?: string }> = [];

		const plannedMemberIds = memberInputs.map((member) =>
			member._id ? member._id : makeDocId('evacuee', nextUlid())
		);

		if (!existingHousehold) {
			const headName = formatPersonName(
				(memberInputs[0] as unknown as Evacuee) ?? { first_name: 'ผู้ประสบภัย', last_name: '' }
			);
			const label = autoHouseholdLabel(headName);
			const householdUlid = reservedHouseholdUlid as string;
			const headId = plannedMemberIds[0];
			if (!headId) throw new Error('ต้องมีสมาชิกอย่างน้อย 1 คน');
			savedHousehold = buildHousehold(
				{
					label,
					head_evacuee_id: headId,
					status: 'arriving',
					checkout_destination: null,
					municipality_zone: null,
					community: null,
					housing_type: householdInput.housing_type ?? null,
					residence_landmark: householdInput.residence_landmark ?? null,
					...dormFieldsFor(householdInput),
					village_no: householdInput.village_no ?? null,
					subdistrict: householdInput.subdistrict ?? null,
					district: householdInput.district ?? null,
					province: householdInput.province ?? null,
					postal_code: householdInput.postal_code ?? null,
					pets: normalizedPets,
					vehicles: normalizedVehicles,
					assets: householdInput.assets
						? {
								description: householdInput.assets.description ?? '',
								image_url: householdInput.assets.image_url ?? null
							}
						: null,
					notes: ''
				},
				ctx,
				householdUlid
			);
			docsToWrite.push(savedHousehold);
		} else {
			const updatedHouseholdDoc: Household = touch({
				...existingHousehold,
				housing_type: householdInput.housing_type ?? null,
				residence_landmark: householdInput.residence_landmark ?? null,
				...dormFieldsFor(householdInput),
				village_no: householdInput.village_no ?? null,
				subdistrict: householdInput.subdistrict ?? null,
				district: householdInput.district ?? null,
				province: householdInput.province ?? null,
				postal_code: householdInput.postal_code ?? null,
				pets: normalizedPets,
				vehicles: normalizedVehicles,
				assets: householdInput.assets
					? {
							description: householdInput.assets.description ?? '',
							image_url: householdInput.assets.image_url ?? null
						}
					: null
			});
			savedHousehold = updatedHouseholdDoc;
			docsToWrite.push(updatedHouseholdDoc);
		}

		const effectiveHouseholdId = savedHousehold._id;

		const reportedInMembers: Evacuee[] = [];
		const allSavedMembers: Evacuee[] = [];
		const affectedOldHouseholdIds = new Set<string>();

		const existingEvacuees: (Evacuee | null)[] = [];
		for (const m of memberInputs) {
			if (!m._id) {
				existingEvacuees.push(null);
				continue;
			}
			const existing = await this.repo.get<Evacuee>(m._id);
			if (!existing || !isEvacuee(existing)) {
				throw new Error(`ไม่พบข้อมูลผู้ประสบภัยรหัส ${m._id}`);
			}
			existingEvacuees.push(existing);
		}
		// FR-41: the stored doc, not the form, decides who already has consent.
		const consentPlans = planMemberConsents(
			consent,
			'staff',
			existingEvacuees.map((existing) => Boolean(existing?.consent))
		);

		for (const [memberIndex, m] of memberInputs.entries()) {
			const willReportIn = Boolean(m.reporting_in);
			const write = consentWrite(consentPlans[memberIndex], plannedMemberIds[0]);
			const existingEvacuee = existingEvacuees[memberIndex];
			if (existingEvacuee) {
				if (existingEvacuee.household_id && existingEvacuee.household_id !== effectiveHouseholdId) {
					affectedOldHouseholdIds.add(existingEvacuee.household_id);
				}

				let updatedStay = existingEvacuee.current_stay;
				if (
					willReportIn &&
					(existingEvacuee.current_stay.status === 'pre_registered' ||
						existingEvacuee.current_stay.status === 'kiosk_registered')
				) {
					updatedStay = {
						status: 'arriving' as const,
						zone: null,
						since: now()
					};
				}

				const parsedBirthYear =
					typeof m.birth_year === 'number'
						? m.birth_year
						: typeof m.birth_year === 'string' && m.birth_year
							? Number(m.birth_year)
							: undefined;
				const parsedAge =
					typeof m.age === 'number'
						? m.age
						: typeof m.age === 'string' && m.age
							? Number(m.age)
							: undefined;

				const parsedPersonId = m.person_id?.cardType
					? { cardType: m.person_id.cardType, number: m.person_id.number ?? '' }
					: existingEvacuee.person_id;

				const parsedEmergencyContact: EmergencyContact | undefined = m.emergency_contact
					? {
							name: m.emergency_contact.name ?? '',
							phone: m.emergency_contact.phone ?? '',
							relation: m.emergency_contact.relation ?? ''
						}
					: existingEvacuee.emergency_contact;

				const updatedEvacuee: Evacuee = touch({
					...existingEvacuee,
					household_id: effectiveHouseholdId,
					first_name: m.first_name,
					last_name: m.last_name ?? '',
					gender: m.gender,
					phone: m.phone ?? null,
					nickname: m.nickname ?? existingEvacuee.nickname,
					birth_year: parsedBirthYear,
					age: parsedAge,
					person_id: parsedPersonId,
					emergency_contact: parsedEmergencyContact,
					vulnerable_groups: m.vulnerable_groups ?? [],
					special_needs: m.special_needs ?? [],
					photo: m.photo ?? existingEvacuee.photo,
					country: m.country ?? existingEvacuee.country,
					religion: m.religion ?? existingEvacuee.religion,
					...memberExtrasFor({
						religion: m.religion ?? existingEvacuee.religion,
						religion_other: m.religion_other,
						vulnerable_groups: m.vulnerable_groups ?? [],
						disability_other_detail: m.disability_other_detail
					}),
					// CR-159: a suggestion only — current_stay is untouched by it.
					preferred_zone: m.preferred_zone ?? existingEvacuee.preferred_zone ?? null,
					current_stay: updatedStay,
					...(write
						? {
								consent: write.consent,
								privacy: { ...existingEvacuee.privacy, search_excluded: write.searchExcluded },
								schema_v: EVACUEE_SCHEMA_V
							}
						: {})
				});

				docsToWrite.push(updatedEvacuee);
				allSavedMembers.push(updatedEvacuee);
				if (willReportIn) {
					reportedInMembers.push(updatedEvacuee);
				}
			} else {
				const plannedMemberId = plannedMemberIds[memberIndex];
				if (!plannedMemberId) throw new Error('ไม่สามารถสร้างรหัสสมาชิกได้');
				const newMemberUlid = plannedMemberId.replace(/^evacuee:/, '');
				const newEvacuee = buildEvacuee(
					{
						// booking_ref is worker-owned (CR-169 FR-61): drop it if a caller smuggled one in.
						...withoutBookingRef(m),
						household_id: effectiveHouseholdId,
						// Never zoned at the desk (ADR-0001) — a zone here would turn the new member
						// `active` and skip Station 2/3.
						zone: null,
						status: 'arriving',
						registered_via: 'staff'
					},
					ctx,
					write,
					newMemberUlid
				);
				docsToWrite.push(newEvacuee);
				allSavedMembers.push(newEvacuee);
				reportedInMembers.push(newEvacuee);

				const medicalInput = registrationMedicalInput(m, newEvacuee._id, write, 'normal');
				if (medicalInput) docsToWrite.push(buildMedical(medicalInput, ctx, nextUlid()));
			}
		}

		const savedDocs = await this.repo.bulkDocs(docsToWrite);

		const finalSavedHousehold =
			(savedDocs.find((d) => d._id === effectiveHouseholdId) as Household | undefined) ??
			savedHousehold;
		const finalReportedMembers = reportedInMembers.map(
			(m) => (savedDocs.find((d) => d._id === m._id) as Evacuee | undefined) ?? m
		);
		const finalAllSavedMembers = allSavedMembers.map(
			(m) => (savedDocs.find((d) => d._id === m._id) as Evacuee | undefined) ?? m
		);

		for (const oldHhId of affectedOldHouseholdIds) {
			await this.cancelHouseholdIfEmpty(oldHhId);
			await this.repairHouseholdHeadIfNeeded(oldHhId);
			await this.refreshDerivedHouseholdStatus(oldHhId);
		}

		await this.repairHouseholdHeadIfNeeded(effectiveHouseholdId);
		await this.refreshDerivedHouseholdStatus(effectiveHouseholdId);

		const finalHousehold = await this.getHousehold(effectiveHouseholdId);

		await this.writeStationOneLogs(
			finalReportedMembers.map((m) => m._id),
			ctx,
			stationLog
		);

		return {
			household: finalHousehold ?? finalSavedHousehold,
			members: finalReportedMembers.length > 0 ? finalReportedMembers : finalAllSavedMembers
		};
	}

	async mergeHouseholds(
		sourceHouseholdId: string,
		targetHouseholdId: string,
		ctx: AuthorContext
	): Promise<{
		targetHousehold: Household;
		mergedMembers: Evacuee[];
	}> {
		void ctx;
		if (sourceHouseholdId === targetHouseholdId) {
			throw new Error('ไม่สามารถรวมครัวเรือนเข้ากับตัวเองได้');
		}
		const sourceHh = await this.getHousehold(sourceHouseholdId);
		if (!sourceHh) throw new Error('ไม่พบครัวเรือนต้นทาง');
		const targetHh = await this.getHousehold(targetHouseholdId);
		if (!targetHh) throw new Error('ไม่พบครัวเรือนปลายทาง');
		if (sourceHh.status === 'merged') {
			throw new Error('ครัวเรือนต้นทางถูกรวมเข้ากับครัวเรือนอื่นแล้ว');
		}

		// 1. Get all members of source household
		const sourceMembers = await this.listHouseholdMembers(sourceHouseholdId);

		// 2. Reassign members to targetHouseholdId
		const updatedMembers: Evacuee[] = [];
		for (const m of sourceMembers) {
			const latest = (await this.repo.get<Evacuee>(m._id)) ?? m;
			const updated = await this.repo.put(touch({ ...latest, household_id: targetHouseholdId }));
			updatedMembers.push(updated);
		}

		// 3. Append pets and vehicles to target household
		const appendPets = sourceHh.pets ?? [];
		const appendVehicles = sourceHh.vehicles ?? [];
		const latestTarget = (await this.repo.get<Household>(targetHouseholdId)) ?? targetHh;
		const updatedTarget = await this.repo.put(
			touch({
				...latestTarget,
				pets: [...(latestTarget.pets ?? []), ...appendPets],
				vehicles: [...(latestTarget.vehicles ?? []), ...appendVehicles]
			})
		);

		// 4. Update source household status to 'merged'
		const latestSource = (await this.repo.get<Household>(sourceHouseholdId)) ?? sourceHh;
		await this.repo.put(
			touch({
				...latestSource,
				status: 'merged' as const,
				merged_to_household_id: targetHouseholdId,
				notes: [
					latestSource.notes,
					`รวมเข้ากับครัวเรือน ${targetHouseholdId} (${latestTarget.label})`
				]
					.filter(Boolean)
					.join('\n')
			})
		);

		await this.repairHouseholdHeadIfNeeded(targetHouseholdId);
		await this.refreshDerivedHouseholdStatus(targetHouseholdId);

		return {
			targetHousehold: updatedTarget,
			mergedMembers: updatedMembers
		};
	}
}

const incompleteCompensation = new WeakSet<object>();

/**
 * True when a failed family registration could not be fully undone — some
 * household / evacuee docs may still exist, so staff must search before resubmitting.
 */
export function isRegistrationCompensationIncomplete(err: unknown): boolean {
	return typeof err === 'object' && err !== null && incompleteCompensation.has(err);
}

/** Re-throwable original error, tagged when compensation was incomplete. */
function markCompensationResult(err: unknown, complete: boolean): unknown {
	if (complete) return err;
	const tagged = typeof err === 'object' && err !== null ? err : new Error(String(err));
	incompleteCompensation.add(tagged);
	return tagged;
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
