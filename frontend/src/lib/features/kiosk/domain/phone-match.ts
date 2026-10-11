import { isListedHouseholdMember } from './check-in-status';

export const KIOSK_PHONE_MAX_CANDIDATES = 5;

export type PhoneMatchDoc = {
	_id: string;
	shelter_code?: string;
	registered_via?: string;
	first_name?: string;
	last_name?: string;
	household_id?: string | null;
	created_at?: string;
	current_stay?: { status?: string };
	privacy?: { search_excluded?: boolean };
};

export type PhoneMatchGroup = {
	groupKey: string;
	householdId: string | null;
	matched: PhoneMatchDoc[];
	primary: PhoneMatchDoc;
};

export function isPhoneMatchEligible(doc: PhoneMatchDoc, shelterCode: string): boolean {
	return (
		doc.shelter_code === shelterCode && doc.registered_via === 'web' && isListedHouseholdMember(doc)
	);
}

function compareDocsByCreatedAtThenId(left: PhoneMatchDoc, right: PhoneMatchDoc): number {
	const leftCreatedAt = left.created_at ?? '';
	const rightCreatedAt = right.created_at ?? '';
	if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt < rightCreatedAt ? -1 : 1;
	if (left._id === right._id) return 0;
	return left._id < right._id ? -1 : 1;
}

/** Group phone hits by household and choose one stable primary per eligible group. */
export function groupPhoneMatches(
	docs: PhoneMatchDoc[],
	shelterCode: string,
	headByHousehold: ReadonlyMap<string, string | null>
): PhoneMatchGroup[] {
	const grouped = new Map<string, { householdId: string | null; matched: PhoneMatchDoc[] }>();
	for (const doc of docs) {
		if (!isPhoneMatchEligible(doc, shelterCode)) continue;
		const householdId = doc.household_id || null;
		const groupKey = householdId ?? doc._id;
		const group = grouped.get(groupKey) ?? { householdId, matched: [] };
		group.matched.push(doc);
		grouped.set(groupKey, group);
	}

	return [...grouped.entries()]
		.map(([groupKey, group]) => {
			const headId = group.householdId ? headByHousehold.get(group.householdId) : null;
			const primary =
				group.matched.find((doc) => doc._id === headId) ??
				[...group.matched].sort(compareDocsByCreatedAtThenId)[0];
			return { groupKey, householdId: group.householdId, matched: group.matched, primary };
		})
		.sort((left, right) => compareDocsByCreatedAtThenId(left.primary, right.primary));
}
