import { describe, expect, it } from 'vitest';
import { compactTimeRange, sortShifts, summariseHiddenShifts } from './shift-summary';

const shift = (id: string, date: string, time: string, confirmed = 0, quota = 5) => ({
	id,
	date,
	time,
	quota,
	confirmed
});

describe('sortShifts', () => {
	it('orders by date, then time', () => {
		const sorted = sortShifts([
			shift('b', '2026-10-21', '08:00 - 12:00 น.'),
			shift('c', '2026-10-20', '13:00 - 17:00 น.'),
			shift('a', '2026-10-20', '08:00 - 12:00 น.')
		]);
		expect(sorted.map((s) => s.id)).toEqual(['a', 'c', 'b']);
	});
});

describe('compactTimeRange', () => {
	it('shortens the display time to a range', () => {
		expect(compactTimeRange('08:00 - 12:00 น.')).toBe('08:00–12:00');
	});

	it('leaves anything else as it is', () => {
		expect(compactTimeRange(' ทั้งวัน ')).toBe('ทั้งวัน');
	});
});

describe('summariseHiddenShifts', () => {
	const sorted = sortShifts([
		shift('d1am', '2026-10-20', '08:00 - 12:00 น.'),
		shift('d1pm', '2026-10-20', '13:00 - 17:00 น.'),
		shift('d2am', '2026-10-21', '08:00 - 12:00 น.', 5),
		shift('d2pm', '2026-10-21', '13:00 - 17:00 น.', 5),
		shift('d3ev', '2026-10-22', '18:00 - 22:00 น.')
	]);

	it('lists each hidden date once and which still have a seat', () => {
		const summary = summariseHiddenShifts(sorted, 2);
		expect(summary.count).toBe(3);
		expect(summary.dates).toEqual([
			{ date: '2026-10-21', open: false },
			{ date: '2026-10-22', open: true }
		]);
	});

	it('lists each hidden time range once', () => {
		expect(summariseHiddenShifts(sorted, 2).times).toEqual([
			'08:00–12:00',
			'13:00–17:00',
			'18:00–22:00'
		]);
	});

	it('is empty when every shift is shown', () => {
		expect(summariseHiddenShifts(sorted, 10)).toEqual({ count: 0, dates: [], times: [] });
	});
});
