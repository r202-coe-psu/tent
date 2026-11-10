import { describe, expect, it } from 'vitest';
import { summarizeMealCoverage, type CoverageLog } from './meal-coverage';

const DAY = '2026-11-09';
const A = { id: 'evacuee:A', name: 'สมชาย', presentAllDay: true };
const B = { id: 'evacuee:B', name: 'สมหญิง', presentAllDay: true };

const log = (over: Partial<CoverageLog> = {}): CoverageLog => ({
	recipient_type: 'evacuee',
	recipient_id: 'evacuee:A',
	meal: 'breakfast',
	status: 'fulfilled',
	is_returnable: false,
	distributed_at: '2026-11-09T01:00:00Z',
	...over
});

// CR-240: a household member collects for others; the log keeps the eater as recipient_id.
const collectedFor = (recipient: string, meal: 'breakfast' | 'lunch') =>
	Object.assign(log({ recipient_id: recipient, meal }), { collected_by_recipient_id: 'evacuee:A' });

const run = (residents = [A], logs: CoverageLog[] = []) =>
	summarizeMealCoverage({ day: DAY, residents, logs });

describe('summarizeMealCoverage', () => {
	it('does not list someone who got breakfast and lunch', () => {
		expect(run([A], [log(), log({ meal: 'lunch' })])).toEqual([]);
	});

	it('lists someone with one meal, with the missing meals', () => {
		expect(run([A], [log()])).toEqual([
			{ id: 'evacuee:A', name: 'สมชาย', received: ['breakfast'], missing: ['lunch', 'dinner'] }
		]);
	});

	it('lists a resident with no logs at all', () => {
		expect(run([A], [])).toEqual([
			{
				id: 'evacuee:A',
				name: 'สมชาย',
				received: [],
				missing: ['breakfast', 'lunch', 'dinner']
			}
		]);
	});

	it('counts the same meal received twice (override) once', () => {
		const rows = run([A], [log(), log({ distributed_at: '2026-11-09T01:30:00Z' })]);
		expect(rows[0].received).toEqual(['breakfast']);
	});

	it('ignores voided logs', () => {
		const rows = run([A], [log(), log({ meal: 'lunch', status: 'voided' })]);
		expect(rows[0].received).toEqual(['breakfast']);
	});

	it('ignores returnable loans', () => {
		const rows = run([A], [log(), log({ meal: 'lunch', is_returnable: true })]);
		expect(rows[0].received).toEqual(['breakfast']);
	});

	it('ignores logs without a meal', () => {
		const rows = run([A], [log(), log({ meal: undefined })]);
		expect(rows[0].received).toEqual(['breakfast']);
	});

	it('does not count a snack as a meal', () => {
		const rows = run([A], [log(), log({ meal: 'snack' })]);
		expect(rows[0].received).toEqual(['breakfast']);
	});

	it('uses the Thai calendar day (17:00Z is midnight in Thailand)', () => {
		// 2026-11-09T17:30Z = 00:30 on 10 Nov in Thailand; 2026-11-08T16:59Z = 23:59 on 8 Nov
		const outside = [
			log({ meal: 'dinner', distributed_at: '2026-11-09T17:30:00Z' }),
			log({ meal: 'lunch', distributed_at: '2026-11-08T16:59:00Z' })
		];
		expect(run([A], [log(), ...outside])[0].received).toEqual(['breakfast']);
		// 2026-11-08T17:00Z = 00:00 on 9 Nov, 2026-11-09T16:59Z = 23:59 on 9 Nov: both inside
		const inside = [
			log({ meal: 'lunch', distributed_at: '2026-11-08T17:00:00Z' }),
			log({ meal: 'dinner', distributed_at: '2026-11-09T16:59:00Z' })
		];
		expect(run([A], inside)).toEqual([]);
	});

	it('counts for recipient_id, not for whoever collected on their behalf', () => {
		const rows = run(
			[A, B],
			[collectedFor('evacuee:B', 'breakfast'), collectedFor('evacuee:B', 'lunch')]
		);
		expect(rows.map((r) => r.id)).toEqual(['evacuee:A']);
	});

	it('does not create rows for volunteer, staff or outside recipients', () => {
		const rows = run(
			[A],
			[
				log({ recipient_type: 'volunteer', recipient_id: 'volunteer:V' }),
				log({ recipient_type: 'staff', recipient_id: 'user:s' }),
				log({ recipient_type: 'outside', recipient_id: null })
			]
		);
		expect(rows.map((r) => r.id)).toEqual(['evacuee:A']);
	});

	it('does not list residents who were not in the shelter all day', () => {
		expect(run([{ ...A, presentAllDay: false }], [])).toEqual([]);
	});
});
