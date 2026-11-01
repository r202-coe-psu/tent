import type { ThaiDAutofillAddress, ThaiDAutofillProfile } from './thaid-profile';
import type {
	UnifiedHouseholdInput,
	UnifiedMemberInput,
	UnifiedRegistrationChannel
} from './unified-registration';

/**
 * Fill a registration member from a ThaiD profile (#588). ThaiD wins only for the
 * fields it actually returned — anything it left blank keeps what staff already typed.
 */
export function applyThaidProfileToMember<M extends UnifiedMemberInput>(
	member: M,
	profile: ThaiDAutofillProfile
): M {
	const text = (value: string | null | undefined) => value?.trim() || undefined;
	const positive = (value: number) => (value > 0 ? value : undefined);
	const list = (value: string[] | undefined) => (value?.length ? value : undefined);
	const personId = text(profile.person_id);

	return {
		...member,
		first_name: text(profile.first_name) ?? member.first_name,
		last_name: text(profile.last_name) ?? member.last_name,
		nickname: text(profile.nickname) ?? member.nickname,
		gender: profile.gender ?? member.gender,
		birth_year: positive(profile.birth_year) ?? member.birth_year,
		age: positive(profile.age) ?? member.age,
		phone: text(profile.phone) ?? member.phone,
		person_id: personId ? { cardType: 'national_id', number: personId } : member.person_id,
		vulnerable_groups: list(profile.vulnerable_groups) ?? member.vulnerable_groups,
		special_needs: list(profile.special_needs) ?? member.special_needs,
		medical_conditions: list(profile.medical_conditions) ?? member.medical_conditions
	};
}

const ADDRESS_KEYS = [
	'address_no',
	'village_no',
	'subdistrict',
	'district',
	'province',
	'postal_code'
] as const satisfies readonly (keyof ThaiDAutofillAddress)[];

/** Fill the residence (ที่พัก) from ThaiD; blank address parts keep what was typed. */
export function applyThaidAddressToHousehold<H extends UnifiedHouseholdInput>(
	household: H,
	address: ThaiDAutofillAddress
): H {
	const filled = { ...household };
	for (const key of ADDRESS_KEYS) {
		const value = address[key]?.trim();
		if (value) filled[key] = value;
	}
	return filled;
}

/**
 * Fill the head (members[0]) and the household address from a ThaiD scan. When joining an
 * existing household the joined household's address is kept as-is.
 */
export function applyThaidToHead<M extends UnifiedMemberInput, H extends UnifiedHouseholdInput>(
	state: { members: M[]; household: H; hasJoinSelection: boolean },
	profile: ThaiDAutofillProfile
): { members: M[]; household: H } {
	const [head, ...rest] = state.members;
	return {
		members: head ? [applyThaidProfileToMember(head, profile), ...rest] : state.members,
		household: state.hasJoinSelection
			? state.household
			: applyThaidAddressToHousehold(state.household, profile.address)
	};
}

/**
 * Whether the head-of-household ThaiD scan may show. Onsite report-in targets an existing
 * household, so a scan there could overwrite the head already on record.
 */
export function canScanThaidForHead({
	channel,
	mode
}: {
	channel: UnifiedRegistrationChannel;
	mode: 'create' | 'report-in';
}): boolean {
	return channel === 'public' || mode === 'create';
}
