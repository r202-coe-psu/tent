import { describe, expect, it } from 'vitest';
import { coverageResidents, previousThaiDay } from './meal-coverage-view';

const person = (id: string, status: string, since: string) => ({
	_id: id,
	first_name: id,
	last_name: 'X',
	nickname: null,
	current_stay: { status, since }
});

describe('coverageResidents', () => {
	it('marks presentAllDay from each evacuee own movements', () => {
		const rows = coverageResidents({
			day: '2026-11-09',
			evacuees: [
				person('evacuee:A', 'active', '2026-11-01T00:00:00Z'),
				person('evacuee:B', 'active', '2026-11-01T00:00:00Z')
			],
			movements: [
				{ evacuee_id: 'evacuee:A', action: 'check_in', occurred_at: '2026-11-01T00:00:00Z' },
				{ evacuee_id: 'evacuee:B', action: 'check_in', occurred_at: '2026-11-01T00:00:00Z' },
				{ evacuee_id: 'evacuee:B', action: 'check_out', occurred_at: '2026-11-09T05:00:00Z' }
			]
		});
		expect(rows.map((r) => [r.id, r.presentAllDay])).toEqual([
			['evacuee:A', true],
			['evacuee:B', false]
		]);
	});

	it('falls back to current_stay when an evacuee has no movements', () => {
		const [row] = coverageResidents({
			day: '2026-11-09',
			evacuees: [person('evacuee:A', 'active', '2026-11-01T00:00:00Z')],
			movements: []
		});
		expect(row.presentAllDay).toBe(true);
	});

	it('names with nickname like the history list', () => {
		const [row] = coverageResidents({
			day: '2026-11-09',
			evacuees: [
				{
					...person('evacuee:A', 'active', '2026-11-01T00:00:00Z'),
					first_name: 'สมชาย',
					last_name: 'ใจดี',
					nickname: 'ชาย'
				}
			],
			movements: []
		});
		expect(row.name).toBe('สมชาย ใจดี (ชาย)');
	});
});

describe('previousThaiDay', () => {
	it('is the Thai calendar day before now', () => {
		// 2026-11-09T18:00Z is already 10 Nov in Thailand
		expect(previousThaiDay(new Date('2026-11-09T18:00:00Z'))).toBe('2026-11-09');
	});
});
