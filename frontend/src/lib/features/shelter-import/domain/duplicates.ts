import { DEFAULT_SITE_KIND } from '$lib/features/shelters/server';
import { H, HEADER_TO_SHEET } from './columns';
import type { RowValidation } from './import-row';

/**
 * Duplicate-by-name detection for the shelter Excel importer (CR-039 extension).
 * Pure, isomorphic, no I/O, no Svelte: comparison is by normalized shelter name
 * only — the workbook has no notion of a shelter code before import.
 */

/** Trim, collapse internal whitespace, lowercase — the comparison key for shelter names. */
export function normalizeShelterName(name: string): string {
	return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface ExistingShelter {
	code: string;
	name: string;
	/** Stored kind; a shelter without one reads as {@link DEFAULT_SITE_KIND}. */
	site_kind?: string;
	/** CR-252: stored `is_external`; a shelter without the flag reads as `false`. */
	is_external?: boolean;
}

export interface DuplicateMatch {
	row: number;
	name: string;
	existingCode: string;
	existingName: string;
	existingSiteKind: string;
	existingIsExternal: boolean;
}

/**
 * Rows whose name already exists in the system, keyed by RowValidation.row.
 * Only considers rows where `ok` is true. If several existing shelters share a
 * normalized name, the first one wins (deterministic: input order).
 */
export function findExistingDuplicates(
	validations: readonly RowValidation[],
	existing: readonly ExistingShelter[]
): Map<number, DuplicateMatch> {
	const byNormalized = new Map<string, ExistingShelter>();
	for (const e of existing) {
		const key = normalizeShelterName(e.name);
		if (!byNormalized.has(key)) byNormalized.set(key, e);
	}

	const matches = new Map<number, DuplicateMatch>();
	for (const v of validations) {
		if (!v.ok || v.name === null) continue;
		const match = byNormalized.get(normalizeShelterName(v.name));
		if (!match) continue;
		matches.set(v.row, {
			row: v.row,
			name: v.name,
			existingCode: match.code,
			existingName: match.name,
			existingSiteKind: match.site_kind ?? DEFAULT_SITE_KIND,
			existingIsExternal: match.is_external === true
		});
	}
	return matches;
}

/**
 * Rows in the SAME file that repeat a name already used by an earlier row.
 * Returns the offending row numbers mapped to the earlier row they clash with.
 */
export function findInFileDuplicates(validations: readonly RowValidation[]): Map<number, number> {
	const firstRowByName = new Map<string, number>();
	const duplicates = new Map<number, number>();

	for (const v of validations) {
		if (!v.ok || v.name === null) continue;
		const key = normalizeShelterName(v.name);
		const firstRow = firstRowByName.get(key);
		if (firstRow === undefined) {
			firstRowByName.set(key, v.row);
		} else {
			duplicates.set(v.row, firstRow);
		}
	}
	return duplicates;
}

/** CR-252 FR-9 / FR-31: thai verdict when an update would flip a shelter's external <-> normal type, else `null`. */
export function externalTypeChangeVerdict(
	rowIsExternal: boolean,
	existingIsExternal: boolean
): string | null {
	if (rowIsExternal === existingIsExternal) return null;
	return `เปลี่ยนชนิดไม่ได้ — ศูนย์เดิมเป็นศูนย์${existingIsExternal ? 'จากระบบภายนอก' : 'ปกติ'} แต่แถวนี้ระบุเป็นศูนย์${rowIsExternal ? 'จากระบบภายนอก' : 'ปกติ'}`;
}

/**
 * CR-252 FR-31 in the preview: under `duplicateAction = 'update'`, a row whose type differs from
 * the stored shelter becomes a `validation_error`. Skipped duplicates and new rows pass through.
 * The worker re-checks against the stored doc (the preview list may be stale).
 */
export function applyExternalTypeRule(
	validations: readonly RowValidation[],
	duplicates: ReadonlyMap<number, DuplicateMatch>,
	duplicateAction: 'skip' | 'update'
): RowValidation[] {
	if (duplicateAction !== 'update') return [...validations];
	return validations.map((v) => {
		if (!v.ok) return v;
		const match = duplicates.get(v.row);
		if (!match) return v;
		const message = externalTypeChangeVerdict(v.isExternal === true, match.existingIsExternal);
		if (!message) return v;
		const sheet = HEADER_TO_SHEET[H.is_external];
		return {
			...v,
			ok: false,
			shelter: undefined,
			errors: [...v.errors, { column: H.is_external, message, ...(sheet ? { sheet } : {}) }]
		};
	});
}
