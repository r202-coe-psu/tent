import { isValidStaffTokenHash } from '$lib/features/users/server';

export type StaffCardBackfillDoc = {
	_id: string;
	name?: string;
	volunteer_id?: string | null;
	personnel_type?: string;
	staff_token_hash?: unknown;
};

export type StaffCardBackfillPlan = {
	mint: string[];
	skipped: { design: number; volunteer: number; has_hash: number; service: number };
};

export function planStaffCardBackfill(
	docs: readonly StaffCardBackfillDoc[],
	opts: { serviceNames: readonly string[] }
): StaffCardBackfillPlan {
	const plan: StaffCardBackfillPlan = {
		mint: [],
		skipped: { design: 0, volunteer: 0, has_hash: 0, service: 0 }
	};
	for (const doc of docs) {
		if (doc._id.startsWith('_design/')) plan.skipped.design++;
		else if (doc.name !== undefined && opts.serviceNames.includes(doc.name)) plan.skipped.service++;
		else if (doc.volunteer_id || doc.personnel_type === 'volunteer') plan.skipped.volunteer++;
		else if (isValidStaffTokenHash(doc.staff_token_hash)) plan.skipped.has_hash++;
		else plan.mint.push(doc._id);
	}
	return plan;
}
