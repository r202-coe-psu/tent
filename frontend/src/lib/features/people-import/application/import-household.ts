import type { AuthorContext } from '$lib/db/model';
import type { PeopleRepository } from '$lib/features/people';
import { buildBackfilledStay } from '../domain/backfill';
import type { HouseholdImportPayload } from '../domain/import-row';

/**
 * Write one validated household (Backfill Import, #1399): household → head → members, then every
 * person's real stay in a single `applyBackfilledStays`. Split out of the mutation so the whole
 * write sequence is testable against a repository.
 */

export interface ImportedHousehold {
	householdId: string;
	/** People created, head included. */
	createdPeople: number;
	createdMembers: number;
}

/**
 * The household (and maybe some of its people) already exist, but a later write failed. People
 * are left `pre_registered`, and — because `applyBackfilledStays` writes each person's movements
 * before their snapshot — some may already have back-dated movements while their `current_stay`
 * is still `pre_registered`. A re-import would skip the household as a duplicate, so the id
 * travels with the error and ends up in the import log.
 */
export class PartialHouseholdImportError extends Error {
	constructor(
		readonly householdId: string,
		readonly cause: unknown
	) {
		const reason = cause instanceof Error ? cause.message : 'บันทึกข้อมูลไม่สำเร็จ';
		super(
			`${reason} — สร้างครัวเรือน ${householdId} ไปแล้วแต่บันทึกสถานะไม่ครบ (ค้างเป็น "ลงทะเบียนล่วงหน้า") ` +
				'ต้องตรวจสอบหรือยกเลิกครัวเรือนนี้เอง ก่อนนำเข้าแถวนี้ซ้ำ'
		);
		this.name = 'PartialHouseholdImportError';
	}
}

export async function importHousehold(
	repo: PeopleRepository,
	payload: HouseholdImportPayload,
	/** Member sheet lines to leave out because that person already exists. */
	skippedLines: ReadonlySet<number | undefined>,
	ctx: AuthorContext
): Promise<ImportedHousehold> {
	// Created open (`pre_registered`, no destination) whatever the stays say: a `checked_out`
	// household refuses new members. The real status is derived once the stays are written, and the
	// destination preset is applied then.
	const household = await repo.createHousehold(
		{ ...payload.household, status: 'pre_registered', checkout_destination: null },
		ctx
	);
	try {
		const head = await repo.createEvacuee({ ...payload.head, household_id: household._id }, ctx);
		await repo.patchHousehold(household._id, { head_evacuee_id: head._id });

		// A person with no stay (blank `สถานะ`, #1448) is left exactly as created: `pre_registered`,
		// no movement, waiting in the Station 1 Report-in queue.
		const stays: ReturnType<typeof buildBackfilledStay>[] = [];
		if (payload.headStay) stays.push(buildBackfilledStay(head, payload.headStay, ctx));
		let createdMembers = 0;
		for (const member of payload.members) {
			if (skippedLines.has(member.line)) continue;
			const created = await repo.createEvacuee(
				{ ...member.evacuee, household_id: household._id },
				ctx
			);
			createdMembers += 1;
			if (member.stay) stays.push(buildBackfilledStay(created, member.stay, ctx));
		}
		// Stays last, once everyone exists: the household status is derived from them. Nothing to
		// write (everyone pre_registered) leaves the household as created.
		if (stays.length > 0) {
			await repo.applyBackfilledStays(household._id, stays, payload.household.checkout_destination);
		}
		return { householdId: household._id, createdPeople: createdMembers + 1, createdMembers };
	} catch (e) {
		throw new PartialHouseholdImportError(household._id, e);
	}
}
