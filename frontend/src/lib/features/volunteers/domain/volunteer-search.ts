/**
 * volunteer-search.ts — the one search rule behind every volunteer search box (#1122): the
 * assign roster, the applicants tab, the people tab, the shift roster and the check-in fallback.
 *
 * A query finds a person by full name, nickname, phone (dashes and spaces ignored on both
 * sides) or volunteer code ("v013" finds V-013). Pure TypeScript, no I/O.
 */

import { matchesVolunteerCode } from './volunteer-code';
import type { Volunteer } from './volunteer.schema';

/** What a search box can match on; a missing field never matches. */
export interface VolunteerSearchFields {
	/** Full name, `first last`. */
	name?: string | null;
	nickname?: string | null;
	phone?: string | null;
	code?: string | null;
	occupation?: string | null;
}

export function volunteerSearchFields(
	volunteer: Pick<
		Volunteer,
		'first_name' | 'last_name' | 'nickname' | 'phone' | 'volunteer_code'
	> & { occupation?: string | null }
): VolunteerSearchFields {
	return {
		name: `${volunteer.first_name} ${volunteer.last_name}`.trim(),
		nickname: volunteer.nickname,
		phone: volunteer.phone,
		code: volunteer.volunteer_code,
		occupation: volunteer.occupation
	};
}

const digits = (value: string) => value.replace(/\D/g, '');

/** "081-234-5678", "081 234 5678" and "0812345678" all find 0812345678, stored either way. */
function matchesPhone(phone: string, query: string): boolean {
	if (phone.toLowerCase().includes(query)) return true;
	const queryDigits = digits(query);
	return queryDigits !== '' && /^[\d\s\-+()]+$/.test(query) && digits(phone).includes(queryDigits);
}

/** Case-insensitive; a blank query matches everyone. */
export function matchesVolunteerSearch(person: VolunteerSearchFields, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	if (person.name?.toLowerCase().includes(needle)) return true;
	if (person.nickname?.toLowerCase().includes(needle)) return true;
	if (person.code && matchesVolunteerCode(person.code, needle)) return true;
	if (person.occupation?.toLowerCase().includes(needle)) return true;
	return !!person.phone && matchesPhone(person.phone, needle);
}
