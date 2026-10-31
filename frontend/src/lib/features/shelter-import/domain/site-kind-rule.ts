import { validateSiteKindChange } from '$lib/features/shelters/server';
import { H } from './columns';
import type { DuplicateMatch } from './duplicates';
import type { RowValidation } from './import-row';

/**
 * CR-198 FR-7 + FR-8 for the importer. A code of an inactive `master_data:site_kind` item may only
 * be written where it does not change: the shelter being updated already stores it. What a row does
 * to the registry decides that, so the rule needs the duplicate matches, not just the cell.
 */
export type SiteKindTarget =
	{ kind: 'create' } | { kind: 'skip' } | { kind: 'update'; storedSiteKind: string };

/** Thai error when the row may not write `code`, else `null`. Codes absent from the master never get here. */
export function siteKindRowVerdict(
	code: string,
	inactiveCodes: ReadonlySet<string>,
	target: SiteKindTarget
): string | null {
	if (!inactiveCodes.has(code) || target.kind === 'skip') return null;
	return validateSiteKindChange(
		code,
		[{ code, status: 'inactive' }],
		target.kind === 'update' ? target.storedSiteKind : undefined
	);
}

function targetOf(
	match: DuplicateMatch | undefined,
	duplicateAction: 'skip' | 'update'
): SiteKindTarget {
	if (!match) return { kind: 'create' };
	return duplicateAction === 'skip'
		? { kind: 'skip' }
		: { kind: 'update', storedSiteKind: match.existingSiteKind };
}

/** Fails the rows whose resolved site_kind breaks {@link siteKindRowVerdict}; other rows pass through. */
export function applySiteKindRule(
	validations: readonly RowValidation[],
	duplicates: ReadonlyMap<number, DuplicateMatch>,
	inactiveCodes: ReadonlySet<string>,
	duplicateAction: 'skip' | 'update'
): RowValidation[] {
	return validations.map((v) => {
		if (!v.ok || !v.shelter) return v;
		const message = siteKindRowVerdict(
			v.shelter.site_kind,
			inactiveCodes,
			targetOf(duplicates.get(v.row), duplicateAction)
		);
		if (!message) return v;
		return {
			row: v.row,
			name: v.name,
			ok: false,
			errors: [...v.errors, { column: H.site_kind, message }],
			foodDistributionPointsProvided: v.foodDistributionPointsProvided,
			...(v.siteKindBlank ? { siteKindBlank: true } : {})
		};
	});
}
