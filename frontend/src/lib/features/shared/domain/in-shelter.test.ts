import { describe, expect, it } from 'vitest';
import {
	IN_SHELTER_STATUSES,
	countInShelter,
	inShelterFromStatusCounts,
	isInShelterStayStatus
} from './in-shelter';

describe('in-shelter headcount (draft-in-shelter-headcount)', () => {
	it('counts checked-in and zone-confirmed evacuees, nobody else', () => {
		expect([...IN_SHELTER_STATUSES]).toEqual(['active', 'room_confirmed']);
		for (const status of ['active', 'room_confirmed']) {
			expect(isInShelterStayStatus(status)).toBe(true);
		}
		for (const status of [
			'pre_registered',
			'kiosk_registered',
			'arriving',
			'temporary_leave',
			'transferred',
			'checked_out',
			'deceased',
			'cancelled',
			'',
			null,
			undefined
		]) {
			expect(isInShelterStayStatus(status)).toBe(false);
		}
	});

	it('counts evacuees by their current stay, tolerating a missing one', () => {
		expect(
			countInShelter([
				{ current_stay: { status: 'active' } },
				{ current_stay: { status: 'room_confirmed' } },
				{ current_stay: { status: 'arriving' } },
				{ current_stay: { status: 'temporary_leave' } },
				{ current_stay: null },
				{}
			])
		).toBe(2);
	});

	it('sums the in-shelter statuses from per-status counts', () => {
		expect(
			inShelterFromStatusCounts({
				active: 236,
				room_confirmed: 51,
				arriving: 32,
				temporary_leave: 35
			})
		).toBe(287);
		expect(inShelterFromStatusCounts({})).toBe(0);
	});
});
