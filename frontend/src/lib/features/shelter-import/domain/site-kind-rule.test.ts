import { describe, expect, it } from 'vitest';
import { H } from './columns';
import type { DuplicateMatch } from './duplicates';
import type { RowValidation, ShelterInput } from './import-row';
import { applySiteKindRule, siteKindRowVerdict, type SiteKindTarget } from './site-kind-rule';

const inactive = new Set(['field_hospital']);

describe('siteKindRowVerdict', () => {
	const cases: [string, string, SiteKindTarget, boolean][] = [
		['active, create', 'evacuation_center', { kind: 'create' }, true],
		[
			'active, update same',
			'evacuation_center',
			{ kind: 'update', storedSiteKind: 'evacuation_center' },
			true
		],
		[
			'active, update different',
			'evacuation_center',
			{ kind: 'update', storedSiteKind: 'host_house' },
			true
		],
		['active, skip', 'evacuation_center', { kind: 'skip' }, true],
		['inactive, create', 'field_hospital', { kind: 'create' }, false],
		[
			'inactive, update same',
			'field_hospital',
			{ kind: 'update', storedSiteKind: 'field_hospital' },
			true
		],
		[
			'inactive, update different',
			'field_hospital',
			{ kind: 'update', storedSiteKind: 'evacuation_center' },
			false
		],
		['inactive, skip', 'field_hospital', { kind: 'skip' }, true]
	];

	it.each(cases)('%s', (_label, code, target, accepted) => {
		const verdict = siteKindRowVerdict(code, inactive, target);
		if (accepted) expect(verdict).toBeNull();
		else expect(verdict).toContain(code);
	});
});

function row(rowNo: number, siteKind: string): RowValidation {
	return {
		row: rowNo,
		name: `ศูนย์ ${rowNo}`,
		ok: true,
		shelter: { site_kind: siteKind } as ShelterInput,
		errors: []
	};
}

function match(rowNo: number, existingSiteKind: string): DuplicateMatch {
	return {
		row: rowNo,
		name: `ศูนย์ ${rowNo}`,
		existingCode: 'SH001',
		existingName: `ศูนย์ ${rowNo}`,
		existingSiteKind
	};
}

describe('applySiteKindRule', () => {
	it('fails an inactive-kind row that would create a shelter, on the site kind column', () => {
		const [out] = applySiteKindRule([row(1, 'field_hospital')], new Map(), inactive, 'skip');
		expect(out.ok).toBe(false);
		expect(out.shelter).toBeUndefined();
		expect(out.errors).toEqual([
			expect.objectContaining({
				column: H.site_kind,
				message: expect.stringContaining('field_hospital')
			})
		]);
	});

	it('accepts an inactive kind when the update keeps the stored kind', () => {
		const dups = new Map([[1, match(1, 'field_hospital')]]);
		const [out] = applySiteKindRule([row(1, 'field_hospital')], dups, inactive, 'update');
		expect(out.ok).toBe(true);
	});

	it('fails an inactive kind when the update would change the stored kind', () => {
		const dups = new Map([[1, match(1, 'evacuation_center')]]);
		const [out] = applySiteKindRule([row(1, 'field_hospital')], dups, inactive, 'update');
		expect(out.ok).toBe(false);
	});

	it('accepts an inactive kind on a duplicate that is skipped', () => {
		const dups = new Map([[1, match(1, 'evacuation_center')]]);
		const [out] = applySiteKindRule([row(1, 'field_hospital')], dups, inactive, 'skip');
		expect(out.ok).toBe(true);
	});

	it('leaves failed rows and active kinds untouched', () => {
		const failed: RowValidation = {
			row: 2,
			name: 'x',
			ok: false,
			errors: [{ column: H.name, message: 'bad' }]
		};
		const rows = [row(1, 'evacuation_center'), failed];
		const out = applySiteKindRule(rows, new Map(), inactive, 'skip');
		expect(out[0]).toBe(rows[0]);
		expect(out[1]).toBe(failed);
	});
});
