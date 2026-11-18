/**
 * One-off normalization of the evacuee fields the server search (CR-229, #554) matches on, so
 * legacy values land in the form the Mango indexes are queried with. Pure — the script
 * `scripts/normalize-evacuee-search-fields.ts` owns I/O.
 *
 * | field                                       | normalized to                                    |
 * | ------------------------------------------- | ------------------------------------------------ |
 * | `phone`, `emergency_contact.phone`          | `0XXXXXXXXX` (only when that yields 10 digits)   |
 * | `person_id.number` (`national_id`)          | digits only (only when that yields 13 digits)    |
 * | `person_id.number` (other, not `anonymous`) | upper case, no whitespace                        |
 *
 * A value that cannot reach its canonical form is left untouched and reported, never guessed.
 */
import { normalizeThaiPhone } from '$lib/db/model';

const MOBILE_RE = /^0\d{9}$/;
const NATIONAL_ID_RE = /^\d{13}$/;

/** The evacuee fields this migration reads; everything else on the doc is carried through. */
export interface SearchNormalizeCandidate {
	_id: string;
	phone?: string | null;
	emergency_contact?: { phone?: string | null } | null;
	person_id?: { cardType?: string; number?: string | null } | null;
	updated_at?: string;
}

/** Field paths, as reported for values that could not be normalized. */
export type SearchNormalizeField = 'phone' | 'emergency_contact.phone' | 'person_id.number';

export type FieldNormalizeResult =
	{ kind: 'unchanged' } | { kind: 'normalized'; value: string } | { kind: 'invalid' };

const UNCHANGED: FieldNormalizeResult = { kind: 'unchanged' };
const INVALID: FieldNormalizeResult = { kind: 'invalid' };

const changedTo = (raw: string, next: string): FieldNormalizeResult =>
	next === raw ? UNCHANGED : { kind: 'normalized', value: next };

/** Blank / missing is `unchanged`: there is nothing to search on, so nothing to fix. */
export function normalizeSearchPhone(raw: string | null | undefined): FieldNormalizeResult {
	if (!raw || !raw.trim()) return UNCHANGED;
	const next = normalizeThaiPhone(raw);
	return MOBILE_RE.test(next) ? changedTo(raw, next) : INVALID;
}

export function normalizeSearchCardNumber(
	cardType: string | undefined,
	raw: string | null | undefined
): FieldNormalizeResult {
	if (!raw || !raw.trim() || cardType === 'anonymous') return UNCHANGED;
	if ((cardType ?? 'national_id') === 'national_id') {
		const digits = raw.replace(/[\s-]/g, '');
		return NATIONAL_ID_RE.test(digits) ? changedTo(raw, digits) : INVALID;
	}
	return changedTo(raw, raw.replace(/\s/g, '').toUpperCase());
}

export interface NormalizeEvacueeOutcome<E extends SearchNormalizeCandidate> {
	/** The doc to write back, or `null` when no field changed. */
	doc: E | null;
	invalid: SearchNormalizeField[];
}

export function normalizeEvacueeSearchFields<E extends SearchNormalizeCandidate>(
	evacuee: E,
	now: Date
): NormalizeEvacueeOutcome<E> {
	const invalid: SearchNormalizeField[] = [];
	let next: E = evacuee;
	let changed = false;

	const apply = (
		field: SearchNormalizeField,
		result: FieldNormalizeResult,
		write: (v: string) => E
	) => {
		if (result.kind === 'invalid') invalid.push(field);
		if (result.kind !== 'normalized') return;
		next = write(result.value);
		changed = true;
	};

	apply('phone', normalizeSearchPhone(evacuee.phone), (v) => ({ ...next, phone: v }));
	apply('emergency_contact.phone', normalizeSearchPhone(evacuee.emergency_contact?.phone), (v) => ({
		...next,
		emergency_contact: { ...next.emergency_contact, phone: v }
	}));
	apply(
		'person_id.number',
		normalizeSearchCardNumber(evacuee.person_id?.cardType, evacuee.person_id?.number),
		(v) => ({ ...next, person_id: { ...next.person_id, number: v } })
	);

	return {
		doc: changed ? { ...next, updated_at: now.toISOString() } : null,
		invalid
	};
}

export interface SearchNormalizeCounts {
	scanned: number;
	normalized: number;
	unchanged: number;
	/** Evacuees with at least one value left untouched because it has no canonical form. */
	withInvalid: number;
	/** Per-field count of those untouched values. */
	invalidByField: Record<SearchNormalizeField, number>;
}

export function emptySearchNormalizeCounts(): SearchNormalizeCounts {
	return {
		scanned: 0,
		normalized: 0,
		unchanged: 0,
		withInvalid: 0,
		invalidByField: { phone: 0, 'emergency_contact.phone': 0, 'person_id.number': 0 }
	};
}

/** Re-runnable: a second pass over already-written docs plans 0 updates. */
export function planEvacueeSearchNormalize<E extends SearchNormalizeCandidate>(
	evacuees: readonly E[],
	now: Date
): { updates: E[]; counts: SearchNormalizeCounts } {
	const counts = emptySearchNormalizeCounts();
	const updates: E[] = [];
	for (const evacuee of evacuees) {
		counts.scanned++;
		const { doc, invalid } = normalizeEvacueeSearchFields(evacuee, now);
		if (doc) {
			counts.normalized++;
			updates.push(doc);
		} else {
			counts.unchanged++;
		}
		if (invalid.length > 0) counts.withInvalid++;
		for (const field of invalid) counts.invalidByField[field]++;
	}
	return { updates, counts };
}
