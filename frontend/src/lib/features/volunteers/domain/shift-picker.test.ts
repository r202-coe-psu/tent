import { describe, expect, it } from 'vitest';
import { formatShiftDate, groupShiftsByDate, seatsLeft, visibleDateCount } from './shift-picker';

const shift = (id: string, date: string, start_time: string, confirmed = 0, quota = 5) => ({
	id,
	date,
	start_time,
	quota,
	confirmed
});

describe('seatsLeft', () => {
	it('never goes below zero', () => {
		expect(seatsLeft(shift('a', '2026-10-20', '08:00', 2))).toBe(3);
		expect(seatsLeft(shift('a', '2026-10-20', '08:00', 7))).toBe(0);
	});
});

describe('groupShiftsByDate', () => {
	it('groups by date, dates and times in order, whatever order they came in', () => {
		const groups = groupShiftsByDate([
			shift('d2-pm', '2026-10-21', '13:00'),
			shift('d1-pm', '2026-10-20', '13:00'),
			shift('d2-am', '2026-10-21', '08:00'),
			shift('d1-am', '2026-10-20', '08:00')
		]);
		expect(groups.map((g) => [g.date, g.shifts.map((s) => s.id)])).toEqual([
			['2026-10-20', ['d1-am', 'd1-pm']],
			['2026-10-21', ['d2-am', 'd2-pm']]
		]);
	});

	it('marks a date with no seat left on any shift', () => {
		const [full, open] = groupShiftsByDate([
			shift('a', '2026-10-20', '08:00', 5),
			shift('b', '2026-10-20', '13:00', 5),
			shift('c', '2026-10-21', '08:00', 4)
		]);
		expect(full.hasSeat).toBe(false);
		expect(open.hasSeat).toBe(true);
	});

	it('is empty for no shifts', () => {
		expect(groupShiftsByDate([])).toEqual([]);
	});
});

describe('visibleDateCount', () => {
	const groups = groupShiftsByDate(
		Array.from({ length: 10 }, (_, i) =>
			shift(`s${i}`, `2026-10-${String(20 + i).padStart(2, '0')}`, '08:00')
		)
	);

	it('shows the first week of a long job', () => {
		expect(visibleDateCount(groups, '2026-10-20')).toBe(7);
	});

	it('shows every date of a short job', () => {
		expect(visibleDateCount(groups.slice(0, 3), undefined)).toBe(3);
	});

	it('reaches the selected date when it falls after the first week', () => {
		expect(visibleDateCount(groups, '2026-10-28')).toBe(9);
	});
});

describe('formatShiftDate', () => {
	it('formats a calendar date on its own day, whatever the time zone', () => {
		expect(formatShiftDate('2026-10-19', 'en-GB', { day: 'numeric', month: 'short' })).toBe(
			'19 Oct'
		);
	});

	it('shows a date it cannot read as it came, instead of throwing', () => {
		expect(formatShiftDate('19/10/2569', 'th-TH', { day: 'numeric' })).toBe('19/10/2569');
		expect(formatShiftDate('2026-13-45', 'th-TH', { day: 'numeric' })).toBe('2026-13-45');
		expect(formatShiftDate('', 'th-TH', { day: 'numeric' })).toBe('');
	});
});
