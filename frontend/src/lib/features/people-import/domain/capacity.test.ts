import { describe, expect, it } from 'vitest';
import type { Evacuee } from '$lib/features/people';
import { capacityWarnings } from './capacity';
import type { ImportStay, ImportZone, RowValidation } from './import-row';

const ZONES: ImportZone[] = [
	{ code: 'A', name: 'โซน A', capacity: 2 },
	{ code: 'B', name: 'โซน B', capacity: 10 }
];

function stay(status: ImportStay['status'], zone: string | null): ImportStay {
	return {
		status,
		arrivedAt: '2026-11-10T07:00:00.000Z',
		departedAt: status === 'checked_out' ? '2026-11-12T02:30:00.000Z' : null,
		zone
	};
}

function row(
	n: number,
	headStay: ImportStay | null,
	members: (ImportStay | null)[] = []
): RowValidation {
	return {
		row: n,
		label: null,
		headName: null,
		memberCount: members.length,
		ok: true,
		payload: {
			headStay,
			members: members.map((m, i) => ({ line: i + 1, stay: m }))
		} as unknown as RowValidation['payload'],
		errors: [],
		warnings: []
	};
}

function present(zone: string): Evacuee {
	return { current_stay: { status: 'active', zone } } as unknown as Evacuee;
}

describe('capacityWarnings (non-blocking)', () => {
	it('is silent while everyone fits', () => {
		const rows = [row(1, stay('active', 'A'), [stay('active', 'A')])];
		expect(capacityWarnings({ rows, zones: ZONES, existing: [], shelterCapacity: 50 })).toEqual([]);
	});

	it('warns for a zone pushed over capacity, counting people already there', () => {
		const rows = [row(1, stay('active', 'A'))];
		const warnings = capacityWarnings({
			rows,
			zones: ZONES,
			existing: [present('A'), present('A')],
			shelterCapacity: 50
		});
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('โซน A');
		expect(warnings[0]).toContain('3');
	});

	it('warns when the shelter as a whole goes over its capacity', () => {
		const rows = [row(1, stay('active', 'B'), [stay('active', 'B')])];
		const warnings = capacityWarnings({
			rows,
			zones: ZONES,
			existing: [present('B')],
			shelterCapacity: 2
		});
		expect(warnings.some((w) => w.startsWith('ศูนย์'))).toBe(true);
	});

	it('ignores people who already left and rows that will not import', () => {
		const rows = [
			row(1, stay('checked_out', 'A'), [stay('checked_out', 'A'), stay('checked_out', 'A')]),
			{ ...row(2, stay('active', 'A'), [stay('active', 'A'), stay('active', 'A')]), ok: false }
		];
		expect(capacityWarnings({ rows, zones: ZONES, existing: [], shelterCapacity: 1 })).toEqual([]);
	});
});

describe('capacityWarnings — blank-status people (#1448)', () => {
	it('does not count a person with no stay towards incoming occupancy', () => {
		const warnings = capacityWarnings({
			rows: [row(1, null, [null, stay('active', 'A')])],
			zones: [{ code: 'A', name: 'โซน A', capacity: 1 }],
			existing: [],
			shelterCapacity: 1
		});
		expect(warnings).toEqual([]);
	});
});
