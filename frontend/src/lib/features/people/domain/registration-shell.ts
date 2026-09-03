/**
 * Pure helpers for Station 1 shared registration shell (Report-in + walk-in).
 * No I/O — unit-tested.
 */

/**
 * Station 1 household modes (FR-03b-H).
 * - create: new Household via Residence form (default when unlinked; also leave+create)
 * - join: join another Household (via 「เข้าร่วม」 or address suggest)
 * - keep: stay on linked Household (default when linked)
 * - change_residence: edit Residence of the linked Household (still keep membership)
 */
export type HouseholdChoice = 'keep' | 'create' | 'join' | 'change_residence';

export type ResidenceFields = {
	address_no?: string | null;
	village_no?: string | null;
	subdistrict?: string | null;
	district?: string | null;
	province?: string | null;
	postal_code?: string | null;
};

export type ResidenceMatchCandidate = ResidenceFields & {
	_id: string;
	label?: string | null;
};

export type JoinCandidateEvacuee = {
	_id: string;
	first_name: string;
	last_name?: string | null;
	nickname?: string | null;
	phone?: string | null;
	household_id: string | null;
	current_stay: { status: string };
};

export type SectionEFlags = {
	allow_pets: boolean;
	allow_assets: boolean;
	allow_vehicles: boolean;
};

export type SectionEExistingData = {
	pets?: readonly unknown[] | null;
	assets?: unknown | null;
	vehicles?: readonly unknown[] | null;
};

export type SectionEVisibility = {
	mode: 'hidden' | 'editable' | 'readonly';
	showNavChip: boolean;
	allow: { pets: boolean; assets: boolean; vehicles: boolean };
};

export function sectionEVisibility(
	flags: SectionEFlags,
	existingData: SectionEExistingData
): SectionEVisibility {
	const anyAllowed = flags.allow_pets || flags.allow_assets || flags.allow_vehicles;
	const allow = {
		pets: flags.allow_pets,
		assets: flags.allow_assets,
		vehicles: flags.allow_vehicles
	};
	if (anyAllowed) {
		return { mode: 'editable', showNavChip: true, allow };
	}
	const hasExisting =
		(existingData.pets?.length ?? 0) > 0 ||
		existingData.assets != null ||
		(existingData.vehicles?.length ?? 0) > 0;
	if (hasExisting) {
		return { mode: 'readonly', showNavChip: true, allow };
	}
	return { mode: 'hidden', showNavChip: false, allow };
}

export type HouseholdLeaveInput = {
	subjectId: string;
	headId: string | null;
	memberIds: readonly string[];
	newHeadId?: string | null;
};

export type HouseholdLeaveResult =
	| { ok: true; transferHead: true; newHeadId: string; dissolvePrior: false }
	| { ok: true; transferHead: false; newHeadId: null; dissolvePrior: boolean }
	| { ok: false; reason: 'new_head_required' | 'invalid_new_head' };

export function resolveHouseholdLeave(input: HouseholdLeaveInput): HouseholdLeaveResult {
	const isHead = input.headId === input.subjectId;
	const otherMembers = input.memberIds.filter((id) => id !== input.subjectId);

	if (input.newHeadId) {
		const eligible =
			input.newHeadId !== input.subjectId && input.memberIds.includes(input.newHeadId);
		if (!eligible) {
			return { ok: false, reason: 'invalid_new_head' };
		}
		return {
			ok: true,
			transferHead: true,
			newHeadId: input.newHeadId,
			dissolvePrior: false
		};
	}

	if (isHead && otherMembers.length > 0) {
		return { ok: false, reason: 'new_head_required' };
	}

	return {
		ok: true,
		transferHead: false,
		newHeadId: null,
		dissolvePrior: otherMembers.length === 0
	};
}

/** Auto Household label — UI never shows a label field (FR-03b-H). */
export function autoHouseholdLabel(personName: string): string {
	return `ครอบครัว${personName.trim()}`;
}

function trimField(value: string | null | undefined): string {
	return (value ?? '').trim();
}

/** Minimum Residence for Station 1 create: house no + province + district + subdistrict. */
export function hasMinimumResidence(residence: ResidenceFields): boolean {
	return Boolean(
		trimField(residence.address_no) &&
		trimField(residence.province) &&
		trimField(residence.district) &&
		trimField(residence.subdistrict)
	);
}

/** Unlinked → create; linked → keep. */
export function defaultHouseholdChoice(hasLinkedHousehold: boolean): HouseholdChoice {
	return hasLinkedHousehold ? 'keep' : 'create';
}

/**
 * Leaving the prior Household when linked and choosing create/join
 * (not keep / change_residence).
 */
export function isLeavingLinkedHousehold(
	hasLinkedHousehold: boolean,
	choice: HouseholdChoice | null
): boolean {
	if (!hasLinkedHousehold || !choice) return false;
	return choice === 'create' || choice === 'join';
}

function normAddr(value: string | null | undefined): string {
	return trimField(value).toLowerCase();
}

/**
 * Residence address match: house no + village_no when present on the query +
 * subdistrict + district + province. Same address ≠ same Household — suggestions only.
 */
export function matchesResidenceAddress(
	query: ResidenceFields,
	candidate: ResidenceFields
): boolean {
	if (normAddr(query.address_no) !== normAddr(candidate.address_no)) return false;
	if (normAddr(query.subdistrict) !== normAddr(candidate.subdistrict)) return false;
	if (normAddr(query.district) !== normAddr(candidate.district)) return false;
	if (normAddr(query.province) !== normAddr(candidate.province)) return false;

	const queryVillage = trimField(query.village_no);
	if (queryVillage && normAddr(query.village_no) !== normAddr(candidate.village_no)) {
		return false;
	}
	return true;
}

/**
 * Suggest existing Households whose Residence matches the query.
 * Returns [] when minimum Residence is incomplete — never blocks create.
 */
export function suggestHouseholdsByResidence<T extends ResidenceMatchCandidate>(
	query: ResidenceFields,
	households: readonly T[]
): T[] {
	if (!hasMinimumResidence(query)) return [];
	return households.filter((h) => matchesResidenceAddress(query, h));
}

function matchesNameOrPhone(
	query: string,
	evacuee: Pick<JoinCandidateEvacuee, 'first_name' | 'last_name' | 'nickname' | 'phone'>
): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return false;
	const fullName = [evacuee.first_name, evacuee.last_name ?? '']
		.map((p) => p.trim())
		.filter(Boolean)
		.join(' ')
		.toLowerCase();
	if (fullName.includes(q)) return true;
	if (evacuee.nickname?.toLowerCase().includes(q)) return true;
	const digits = q.replace(/\D/g, '');
	if (digits && evacuee.phone?.replace(/\D/g, '').includes(digits)) return true;
	return false;
}

/**
 * 「เข้าร่วม」 search: shelter Evacuees that already have `household_id`,
 * matched by name or phone (any stay status).
 */
export function filterJoinCandidatesByEvacueeQuery<T extends JoinCandidateEvacuee>(
	query: string,
	evacuees: readonly T[]
): T[] {
	if (!query.trim()) return [];
	return evacuees.filter((e) => Boolean(e.household_id) && matchesNameOrPhone(query, e));
}
