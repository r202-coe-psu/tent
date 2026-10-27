import type { ThaiDAutofillAddress, ThaiDAutofillProfile } from './thaid-profile';
import type { UnifiedHouseholdInput, UnifiedMemberInput } from './unified-registration';

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

/** Fill the residence (ที่พัก) from ThaiD; blank address parts keep what was typed. */
export function applyThaidAddressToHousehold<H extends UnifiedHouseholdInput>(
	household: H,
	address: ThaiDAutofillAddress
): H {
	const filled = { ...household };
	for (const key of [
		'address_no',
		'village_no',
		'subdistrict',
		'district',
		'province',
		'postal_code'
	] as const) {
		const value = address[key]?.trim();
		if (value) filled[key] = value;
	}
	return filled;
}
