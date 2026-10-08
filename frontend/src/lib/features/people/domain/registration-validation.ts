/**
 * Field-level error model for the unified registration form (public pre-register + staff).
 *
 * Pure domain: turns a flat list of validation issues (Zod paths + a few UI-only rules) into
 * one error entry per field, and keeps only the entries whose field is *still* invalid so a
 * fixed field loses its error immediately — without ever showing an error the user has not
 * been told about by a submit first.
 */

/** A validation issue: Zod-shaped path + message (also used for the UI-only rules). */
export type RegistrationIssue = { path: readonly PropertyKey[]; message: string };

/** One error, addressed by a stable `key` (the field) so two passes of validation can be compared. */
export type RegistrationErrorEntry = RegistrationIssue & { key: string };

/** Errors shaped for the form sections. */
export type RegistrationFieldErrors = {
	/** Unique messages in the order they were found (summary banner / toast). */
	messages: string[];
	/** `members[index][field]`; emergency-contact fields are `emergency_contact.<name|phone|relation>`. */
	members: Record<number, Record<string, string>>;
	/** Household field → message (`address_no`, `residence_landmark`, `dorm_name`, …). */
	household: Record<string, string>;
	/** Pet card index → message (e.g. species missing for「อื่นๆ」). */
	pets: Record<number, string>;
	/** Batch-level member error (more than 20 members). */
	membersLimit: string | null;
};

const EMERGENCY_KEY = 'emergency_contact';

/** Key of the field an issue belongs to; issues for the same field share a key. */
export function registrationIssueKey(issue: RegistrationIssue): string {
	const [root, a, b, c] = issue.path;
	if (root === 'members') {
		if (typeof a !== 'number') return 'members';
		if (typeof b !== 'string') return `form:${issue.message}`;
		if (b === EMERGENCY_KEY && typeof c === 'string') return `members.${a}.${EMERGENCY_KEY}.${c}`;
		return `members.${a}.${b}`;
	}
	if (root === 'household') {
		if (a === 'pets' && typeof b === 'number') return `household.pets.${b}`;
		if (typeof a === 'string') return `household.${a}`;
	}
	return `form:${issue.message}`;
}

/** Every distinct issue as an entry (the summary lists them all; a field shows its first one). */
export function toRegistrationEntries(
	issues: readonly RegistrationIssue[]
): RegistrationErrorEntry[] {
	const seen = new Set<string>();
	const entries: RegistrationErrorEntry[] = [];
	for (const issue of issues) {
		if (!issue.message) continue;
		const key = registrationIssueKey(issue);
		const identity = `${key}|${issue.message}`;
		if (seen.has(identity)) continue;
		seen.add(identity);
		entries.push({ key, path: issue.path, message: issue.message });
	}
	return entries;
}

/**
 * The entries of `shown` whose field is still invalid in `live`, carrying the live message
 * (a field can move from "required" to "out of range" while the user types).
 */
export function stillInvalidEntries(
	shown: readonly RegistrationErrorEntry[],
	live: readonly RegistrationErrorEntry[]
): RegistrationErrorEntry[] {
	const shownKeys = new Set(shown.map((entry) => entry.key));
	return live.filter((entry) => shownKeys.has(entry.key));
}

/** Distribute entries to the form sections. */
export function toRegistrationFieldErrors(
	entries: readonly RegistrationErrorEntry[]
): RegistrationFieldErrors {
	const errors: RegistrationFieldErrors = {
		messages: [],
		members: {},
		household: {},
		pets: {},
		membersLimit: null
	};
	for (const { path, message } of entries) {
		if (!errors.messages.includes(message)) errors.messages.push(message);
		const [root, a, b, c] = path;
		if (root === 'members') {
			if (typeof a !== 'number') {
				errors.membersLimit ??= message;
			} else if (typeof b === 'string') {
				const field = b === EMERGENCY_KEY && typeof c === 'string' ? `${b}.${c}` : b;
				errors.members[a] ??= {};
				errors.members[a][field] ??= message;
			}
		} else if (root === 'household') {
			if (a === 'pets' && typeof b === 'number') errors.pets[b] ??= message;
			else if (typeof a === 'string') errors.household[a] ??= message;
		}
	}
	return errors;
}
