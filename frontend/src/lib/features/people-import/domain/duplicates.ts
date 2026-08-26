import type { EvacueeInput } from '$lib/features/people';
import { MAIN_SHEET_NAME, MEMBER_SHEET_NAME } from './columns';
import type { RowValidation } from './import-row';

/**
 * Duplicate-person detection for the people importer (CR-071 slice A / T-72).
 * Pure, isomorphic, no I/O, no Svelte.
 *
 * A person is matched on identity, not on name alone: the document number when
 * the row has one, otherwise the full name **plus** birth year. A row with
 * neither gets no key and is never treated as a duplicate — silently skipping
 * someone because a common name collided is worse than importing them twice,
 * and the preview lists every name before anything is written.
 *
 * Detection only ever leads to a skip. An imported row cannot overwrite a
 * person who already exists in the shelter: their stay status, household
 * membership and movement history are invariants owned by the check-in flow
 * (schema.md §7), and a spreadsheet has no way to express them safely.
 */

/** Digits/letters only, uppercased — the comparison form of a document number. */
export function normalizeIdNumber(value: string): string {
	return value.replace(/[\s\-.]/g, '').toUpperCase();
}

/** Trim, collapse internal whitespace, lowercase — the comparison form of a name. */
export function normalizeName(value: string): string {
	return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function keyOf(
	idNumber: string | undefined,
	firstName: string | undefined,
	lastName: string | undefined,
	birthYear: number | undefined
): string | null {
	const id = normalizeIdNumber(idNumber ?? '');
	if (id !== '') return `id:${id}`;
	const name = normalizeName(`${firstName ?? ''} ${lastName ?? ''}`);
	if (name !== '' && birthYear !== undefined) return `name:${name}:${birthYear}`;
	return null;
}

/** Identity key for a person read out of the workbook. */
export function personDuplicateKey(person: EvacueeInput): string | null {
	const birthYear = typeof person.birth_year === 'number' ? person.birth_year : undefined;
	return keyOf(person.person_id?.number, person.first_name, person.last_name, birthYear);
}

/** The stored evacuee, as far as duplicate detection needs to read it. */
export interface ExistingPerson {
	_id: string;
	first_name: string;
	last_name: string;
	birth_year?: number;
	person_id?: { number?: string };
}

/** Identity key for a person already stored in the shelter. */
export function existingPersonKey(person: ExistingPerson): string | null {
	return keyOf(person.person_id?.number, person.first_name, person.last_name, person.birth_year);
}

export interface DuplicatePerson {
	name: string;
	existingId: string;
	/** Member rows only — the row on the member sheet. */
	line?: number;
}

export interface DuplicateMatch {
	row: number;
	/** Set when the head already exists — the whole household is then skipped. */
	head: DuplicatePerson | null;
	/** Members that already exist — skipped individually. */
	members: DuplicatePerson[];
}

function displayName(person: EvacueeInput): string {
	return `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim();
}

/**
 * Rows containing people who already exist in the shelter, keyed by
 * `RowValidation.row`. Only considers rows where `ok` is true. If several
 * stored people share a key, the first one wins (deterministic: input order).
 */
export function findExistingDuplicates(
	validations: readonly RowValidation[],
	existing: readonly ExistingPerson[]
): Map<number, DuplicateMatch> {
	const byKey = new Map<string, ExistingPerson>();
	for (const e of existing) {
		const key = existingPersonKey(e);
		if (key && !byKey.has(key)) byKey.set(key, e);
	}
	if (byKey.size === 0) return new Map();

	const matches = new Map<number, DuplicateMatch>();
	for (const v of validations) {
		if (!v.ok || !v.payload) continue;
		const headMatch = v.payload.headDuplicateKey
			? byKey.get(v.payload.headDuplicateKey)
			: undefined;
		const memberMatches: DuplicatePerson[] = [];
		for (const m of v.payload.members) {
			const hit = m.duplicateKey ? byKey.get(m.duplicateKey) : undefined;
			if (hit) {
				memberMatches.push({ name: displayName(m.evacuee), existingId: hit._id, line: m.line });
			}
		}
		if (!headMatch && memberMatches.length === 0) continue;
		matches.set(v.row, {
			row: v.row,
			head: headMatch ? { name: displayName(v.payload.head), existingId: headMatch._id } : null,
			members: memberMatches
		});
	}
	return matches;
}

/** Where an in-file clash should be reported. */
export interface InFileClash {
	message: string;
	sheet: string;
	/** Member rows only. */
	line?: number;
}

/**
 * People repeated within the SAME file. The first occurrence is kept; every
 * later one turns its household row into a validation error, because importing
 * the same person twice would create two evacuee documents for one human.
 */
export function findInFileDuplicates(
	validations: readonly RowValidation[]
): Map<number, InFileClash> {
	const firstSeen = new Map<string, { row: number; name: string }>();
	const clashes = new Map<number, InFileClash>();

	for (const v of validations) {
		if (!v.ok || !v.payload) continue;

		const people: { key: string | null; name: string; sheet: string; line?: number }[] = [
			{
				key: v.payload.headDuplicateKey,
				name: displayName(v.payload.head),
				sheet: MAIN_SHEET_NAME
			},
			...v.payload.members.map((m) => ({
				key: m.duplicateKey,
				name: displayName(m.evacuee),
				sheet: MEMBER_SHEET_NAME,
				line: m.line
			}))
		];

		for (const person of people) {
			if (!person.key || clashes.has(v.row)) continue;
			const earlier = firstSeen.get(person.key);
			if (!earlier) {
				firstSeen.set(person.key, { row: v.row, name: person.name });
				continue;
			}
			clashes.set(v.row, {
				message:
					earlier.row === v.row
						? `"${person.name}" ซ้ำกับอีกแถวในครัวเรือนเดียวกัน — คนเดียวกันอยู่ได้แถวเดียว`
						: `"${person.name}" ซ้ำกับคนในครัวเรือนแถวที่ ${earlier.row} ในไฟล์เดียวกัน`,
				sheet: person.sheet,
				...(person.line === undefined ? {} : { line: person.line })
			});
		}
	}
	return clashes;
}
