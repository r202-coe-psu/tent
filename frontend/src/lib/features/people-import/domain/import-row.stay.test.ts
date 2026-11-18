import { describe, expect, it } from 'vitest';
import { H } from './columns';
import {
	emptyLookups,
	isLegacyTemplate,
	validateRow,
	type Lookups,
	type RawRow
} from './import-row';

/**
 * Backfill Import (#1399): every row reports a real stay — status, arrival, departure, zone.
 * The clock is injected so the "not in the future" rule is deterministic.
 */

const NOW = new Date('2026-11-15T05:00:00.000Z'); // 12:00 Bangkok, 15/11/2569

const lookups = (extra: Partial<Lookups> = {}): Lookups => ({
	...emptyLookups(),
	now: NOW,
	zones: [
		{ code: 'A', name: 'โซน A', status: 'active', capacity: 10 },
		{ code: 'C', name: 'โซน C', status: 'closed', capacity: 10 }
	],
	...extra
});

function person(overrides: RawRow = {}): RawRow {
	return {
		[H.first_name]: 'สมชาย',
		[H.last_name]: 'ใจดี',
		[H.gender]: 'ชาย',
		[H.stay_status]: 'พักอยู่',
		[H.arrived_at]: '10/11/2569 14:00',
		[H.zone]: 'โซน A',
		...overrides
	};
}

const leftCells = (overrides: RawRow = {}): RawRow =>
	person({ [H.stay_status]: 'กลับแล้ว', [H.departed_at]: '12/11/2569 09:30', ...overrides });

function columnsWithErrors(raw: RawRow, l: Lookups = lookups()): string[] {
	return validateRow(raw, 1, l).errors.map((e) => e.column);
}

describe('stay: พักอยู่ (active)', () => {
	it('resolves the stay, converting Thai wall-clock to a UTC instant and the zone name to its code', () => {
		const result = validateRow(person(), 1, lookups());

		expect(result.ok).toBe(true);
		expect(result.payload?.headStay).toEqual({
			status: 'active',
			arrivedAt: '2026-11-10T07:00:00.000Z',
			departedAt: null,
			zone: 'A'
		});
	});

	it('accepts the zone by code as well as by name', () => {
		expect(validateRow(person({ [H.zone]: 'A' }), 1, lookups()).payload?.headStay.zone).toBe('A');
	});

	it('requires a zone (CR-112: a check_in needs one)', () => {
		expect(columnsWithErrors(person({ [H.zone]: '' }))).toContain(H.zone);
	});

	it('refuses a closed zone', () => {
		const result = validateRow(person({ [H.zone]: 'โซน C' }), 1, lookups());
		expect(result.ok).toBe(false);
		expect(result.errors.find((e) => e.column === H.zone)?.message).toContain('ปิด');
	});

	it('refuses a zone the shelter does not have', () => {
		expect(columnsWithErrors(person({ [H.zone]: 'โซน Z' }))).toContain(H.zone);
	});

	it('forbids a departure time', () => {
		expect(columnsWithErrors(person({ [H.departed_at]: '12/11/2569 09:30' }))).toContain(
			H.departed_at
		);
	});
});

describe('stay: กลับแล้ว (checked_out)', () => {
	it('keeps both times and lets the zone stay empty', () => {
		const result = validateRow(leftCells({ [H.zone]: '' }), 1, lookups());

		expect(result.ok).toBe(true);
		expect(result.payload?.headStay).toEqual({
			status: 'checked_out',
			arrivedAt: '2026-11-10T07:00:00.000Z',
			departedAt: '2026-11-12T02:30:00.000Z',
			zone: null
		});
	});

	it('requires a departure time', () => {
		expect(columnsWithErrors(leftCells({ [H.departed_at]: '' }))).toContain(H.departed_at);
	});

	it('allows a closed zone — it is history, not a placement', () => {
		const result = validateRow(leftCells({ [H.zone]: 'โซน C' }), 1, lookups());
		expect(result.ok).toBe(true);
		expect(result.payload?.headStay.zone).toBe('C');
	});

	it('rejects a departure before the arrival', () => {
		const result = validateRow(leftCells({ [H.departed_at]: '09/11/2569 09:30' }), 1, lookups());
		expect(result.ok).toBe(false);
		expect(result.errors.find((e) => e.column === H.departed_at)?.message).toContain('ก่อนเวลามา');
	});

	it('accepts a departure equal to the arrival', () => {
		expect(validateRow(leftCells({ [H.departed_at]: '10/11/2569 14:00' }), 1, lookups()).ok).toBe(
			true
		);
	});
});

describe('stay: shared rules', () => {
	it('requires status and arrival on every row', () => {
		const cols = columnsWithErrors({
			[H.first_name]: 'สมชาย',
			[H.last_name]: 'ใจดี',
			[H.gender]: 'ชาย'
		});
		expect(cols).toContain(H.stay_status);
		expect(cols).toContain(H.arrived_at);
	});

	it('rejects pre_registered as a status — a booking is not a stay that happened', () => {
		expect(columnsWithErrors(person({ [H.stay_status]: 'จองล่วงหน้า' }))).toContain(H.stay_status);
		expect(columnsWithErrors(person({ [H.stay_status]: 'pre_registered' }))).toContain(
			H.stay_status
		);
	});

	it('rejects a time later than now, for arrival and departure', () => {
		expect(columnsWithErrors(person({ [H.arrived_at]: '16/11/2569 08:00' }))).toContain(
			H.arrived_at
		);
		expect(columnsWithErrors(leftCells({ [H.departed_at]: '16/11/2569 08:00' }))).toContain(
			H.departed_at
		);
	});

	it('accepts a time exactly at now', () => {
		expect(validateRow(person({ [H.arrived_at]: '15/11/2569 12:00' }), 1, lookups()).ok).toBe(true);
	});

	it('points at a malformed time with the expected format', () => {
		const result = validateRow(person({ [H.arrived_at]: 'เมื่อวานตอนบ่าย' }), 1, lookups());
		expect(result.errors.find((e) => e.column === H.arrived_at)?.message).toContain('วว/ดด/ปปปป');
	});

	it('takes the zone as typed when the shelter zones are not known', () => {
		const result = validateRow(person({ [H.zone]: 'โซน ไม่รู้จัก' }), 1, {
			...emptyLookups(),
			now: NOW
		});
		expect(result.ok).toBe(true);
	});
});

describe('stay: members', () => {
	it('validates a member row with its own stay and reports on the member sheet', () => {
		const result = validateRow(person(), 1, lookups(), [
			{
				ref: '1',
				line: 4,
				cells: person({ [H.first_name]: 'สมหญิง', [H.arrived_at]: '16/11/2569 08:00' })
			}
		]);

		expect(result.ok).toBe(false);
		const err = result.errors.find((e) => e.column === H.arrived_at);
		expect(err?.sheet).toBe('สมาชิก');
		expect(err?.line).toBe(4);
	});

	it('carries a stay on every importable member', () => {
		const result = validateRow(person(), 1, lookups(), [
			{ ref: '1', line: 1, cells: leftCells({ [H.first_name]: 'สมหญิง' }) }
		]);

		expect(result.ok).toBe(true);
		expect(result.payload?.members[0].stay.status).toBe('checked_out');
		// Head still housed → household stays checked in.
		expect(result.payload?.household.status).toBe('checked_in');
	});
});

describe('isLegacyTemplate', () => {
	const legacy = { [H.first_name]: 'สมชาย', [H.last_name]: 'ใจดี', [H.gender]: 'ชาย' };

	it('flags a file whose rows have no สถานะ column at all', () => {
		expect(
			isLegacyTemplate({ households: [{ ref: '1', line: 1, cells: legacy }], members: [] })
		).toBe(true);
	});

	it('does not flag a new template, even when the status cell was left blank', () => {
		const cells = { ...legacy, [H.stay_status]: '' };
		expect(isLegacyTemplate({ households: [{ ref: '1', line: 1, cells }], members: [] })).toBe(
			false
		);
	});

	it('does not flag an empty file', () => {
		expect(isLegacyTemplate({ households: [], members: [] })).toBe(false);
	});
});
