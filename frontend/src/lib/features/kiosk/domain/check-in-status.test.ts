import { describe, expect, it } from 'vitest';
import { isListedHouseholdMember } from './check-in-status';

describe('isListedHouseholdMember', () => {
	it.each(['pre_registered', 'arriving', 'active', 'room_confirmed', 'temporary_leave'])(
		'lists household members with status %s',
		(status) => {
			expect(
				isListedHouseholdMember({
					current_stay: { status }
				})
			).toBe(true);
		}
	);

	it.each(['cancelled', 'checked_out', 'transferred', 'deceased', 'unknown', undefined])(
		'excludes household members with status %s',
		(status) => {
			expect(isListedHouseholdMember({ current_stay: { status } })).toBe(false);
		}
	);

	it('excludes members who opted out of search', () => {
		expect(
			isListedHouseholdMember({
				current_stay: { status: 'arriving' },
				privacy: { search_excluded: true }
			})
		).toBe(false);
	});
});
