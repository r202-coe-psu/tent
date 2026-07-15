import { describe, it, expect } from 'vitest';
import { H } from './columns';
import {
	buildMasterLookup,
	emptyLookups,
	validateRow,
	validateRows,
	type Lookups,
	type RawRow
} from './import-row';

function lookups(): Lookups {
	return {
		municipality_zone: buildMasterLookup([{ code: 'zone_1', label: 'โซน 1 (เทศบาลนครหาดใหญ่)' }]),
		community: buildMasterLookup([{ code: 'com_a', label: 'ชุมชนบ้านสวน' }])
	};
}

function baseRow(over: Partial<RawRow> = {}): RawRow {
	return { [H.name]: 'ศูนย์ทดสอบ', [H.capacity]: '150', ...over };
}

describe('validateRow — happy path', () => {
	it('maps a minimal valid row to a shelter payload', () => {
		const r = validateRow(baseRow(), 1, emptyLookups());
		expect(r.ok).toBe(true);
		expect(r.name).toBe('ศูนย์ทดสอบ');
		expect(r.shelter?.capacity).toBe(150);
		// operation_status defaults to standby when the cell is blank
		expect(r.shelter?.operation_status).toBe('standby');
		// sub-objects the template omits are filled
		expect(r.shelter?.zones).toEqual([]);
	});

	it('resolves enum labels and codes to the code', () => {
		const byLabel = validateRow(
			baseRow({
				[H.operation_status]: 'เปิดรับผู้อพยพ (Active)',
				[H.area_type]: 'อาคารปิด (Indoor)'
			}),
			1,
			emptyLookups()
		);
		expect(byLabel.ok).toBe(true);
		expect(byLabel.shelter?.operation_status).toBe('active');
		expect(byLabel.shelter?.area_type).toBe('indoor');

		const byCode = validateRow(baseRow({ [H.operation_status]: 'closed' }), 1, emptyLookups());
		expect(byCode.shelter?.operation_status).toBe('closed');

		const byBase = validateRow(baseRow({ [H.project_level]: 'ระดับชุมชน' }), 1, emptyLookups());
		expect(byBase.shelter?.project_level).toBe('community');
	});

	it('resolves master-data label → code', () => {
		const r = validateRow(
			baseRow({ [H.municipality_zone]: 'โซน 1 (เทศบาลนครหาดใหญ่)', [H.community]: 'com_a' }),
			1,
			lookups()
		);
		expect(r.ok).toBe(true);
		expect(r.shelter?.municipality_zone).toBe('zone_1');
		expect(r.shelter?.community).toBe('com_a');
	});
});

describe('validateRow — errors', () => {
	it('flags missing required name and capacity with Thai messages on the right columns', () => {
		const r = validateRow({ [H.name]: '', [H.capacity]: '' }, 3, emptyLookups());
		expect(r.ok).toBe(false);
		expect(r.name).toBeNull();
		const cols = r.errors.map((e) => e.column);
		expect(cols).toContain(H.name);
		expect(cols).toContain(H.capacity);
		expect(r.errors.find((e) => e.column === H.capacity)?.message).toBe(
			'ต้องระบุความจุสูงสุด (คน)'
		);
	});

	it('rejects an unknown enum value', () => {
		const r = validateRow(baseRow({ [H.operation_status]: 'ไม่รู้จัก' }), 1, emptyLookups());
		expect(r.ok).toBe(false);
		expect(r.errors[0].column).toBe(H.operation_status);
	});

	it('rejects an unknown master-data label', () => {
		const r = validateRow(baseRow({ [H.municipality_zone]: 'โซนไม่มีจริง' }), 1, lookups());
		expect(r.ok).toBe(false);
		expect(r.errors.find((e) => e.column === H.municipality_zone)?.message).toContain('ไม่พบ');
	});

	it('rejects capacity that is not positive', () => {
		const r = validateRow(baseRow({ [H.capacity]: '0' }), 1, emptyLookups());
		expect(r.ok).toBe(false);
		expect(r.errors.find((e) => e.column === H.capacity)).toBeTruthy();
	});

	it('rejects latitude out of range', () => {
		const r = validateRow(baseRow({ [H.lat]: '999' }), 1, emptyLookups());
		expect(r.ok).toBe(false);
		expect(r.errors.find((e) => e.column === H.lat)).toBeTruthy();
	});

	it('treats blank optional numbers as unset (not zero)', () => {
		const r = validateRow(baseRow({ [H.area_m2]: '' }), 1, emptyLookups());
		expect(r.ok).toBe(true);
		expect(r.shelter?.area_m2 ?? null).toBeNull();
	});
});

describe('validateRows', () => {
	it('numbers rows 1-based and preserves order', () => {
		const rows = validateRows([baseRow(), { [H.name]: '', [H.capacity]: '' }], emptyLookups());
		expect(rows[0].row).toBe(1);
		expect(rows[0].ok).toBe(true);
		expect(rows[1].row).toBe(2);
		expect(rows[1].ok).toBe(false);
	});
});
