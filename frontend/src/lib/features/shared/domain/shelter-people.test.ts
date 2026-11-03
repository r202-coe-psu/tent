import { describe, expect, it } from 'vitest';
import {
	countShelterPeople,
	totalShelterPeople,
	type ShelterOccupantView,
	type VolunteerPresenceView
} from './shelter-people';

const occ = (over: { status: string }): ShelterOccupantView => ({ current_stay: over });

const vol = (v: Partial<VolunteerPresenceView> = {}): VolunteerPresenceView => ({
	checked_in: true,
	current_shelter_code: 'SH001',
	user_name: null,
	...v
});

describe('countShelterPeople', () => {
	it('counts evacuees in the shelter only', () => {
		const people = countShelterPeople(
			'SH001',
			[
				occ({ status: 'active' }),
				occ({ status: 'room_confirmed' }),
				occ({ status: 'checked_out' })
			],
			[],
			[]
		);
		expect(people.evacuees).toBe(2);
	});

	it('counts volunteers only while checked in at this shelter', () => {
		const people = countShelterPeople(
			'SH001',
			[],
			[
				vol(),
				vol(),
				vol({ current_shelter_code: 'SH002' }),
				vol({ current_shelter_code: null }),
				vol({ checked_in: false })
			],
			[]
		);
		expect(people.volunteers).toBe(2);
	});

	it('counts each staff user once', () => {
		const people = countShelterPeople(
			'SH001',
			[],
			[],
			[{ name: 'a' }, { name: 'b' }, { name: 'a' }]
		);
		expect(people.staff).toBe(2);
	});

	it('does not count a staff user linked to a volunteer as staff, checked in or not', () => {
		const people = countShelterPeople(
			'SH001',
			[],
			[vol({ user_name: 'linked_in' }), vol({ user_name: 'linked_out', checked_in: false })],
			[{ name: 'linked_in' }, { name: 'linked_out' }, { name: 'plain' }]
		);
		expect(people).toEqual({ evacuees: 0, staff: 1, volunteers: 1 });
	});
});

describe('totalShelterPeople', () => {
	it('adds the three groups into the base every daily requirement is sized from', () => {
		expect(totalShelterPeople({ evacuees: 300, staff: 20, volunteers: 15 })).toBe(335);
	});

	it('is zero for an empty shelter', () => {
		expect(totalShelterPeople({ evacuees: 0, staff: 0, volunteers: 0 })).toBe(0);
	});
});
