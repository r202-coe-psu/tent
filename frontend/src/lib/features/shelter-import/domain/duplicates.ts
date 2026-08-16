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
}

export interface DuplicateMatch {
	row: number;
	name: string;
	existingCode: string;
	existingName: string;
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
			existingName: match.name
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
