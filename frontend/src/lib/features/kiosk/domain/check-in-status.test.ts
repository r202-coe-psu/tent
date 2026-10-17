import { describe, expect, it } from 'vitest';
import {
	isAlreadyCheckedInStatus,
	isListedHouseholdMember,
	isReprintableStatus,
	reprintUnavailableReason
} from './check-in-status';

describe('isReprintableStatus', () => {
	it.each(['arriving', 'active', 'room_confirmed'])('allows a QR reprint for %s', (status) => {
		expect(isReprintableStatus(status)).toBe(true);
	});

	it.each(['temporary_leave', 'pre_registered', 'checked_out', 'unknown', null, undefined])(
		'does not allow a QR reprint for %s',
		(status) => {
			expect(isReprintableStatus(status)).toBe(false);
		}
	);

	it('keeps temporary_leave as already checked in for card check-in', () => {
		expect(isAlreadyCheckedInStatus('temporary_leave')).toBe(true);
	});
});

describe('reprintUnavailableReason', () => {
	it('tells a pre-registered member to use the card or ThaiD', () => {
		expect(reprintUnavailableReason('pre_registered')).toBe(
			'ยังไม่ได้ลงทะเบียน — ใช้บัตรประชาชนหรือ ThaiD'
		);
	});

	it('tells a member on temporary leave a QR cannot be printed', () => {
		expect(reprintUnavailableReason('temporary_leave')).toBe(
			'ออกนอกศูนย์ชั่วคราว — พิมพ์ QR ไม่ได้'
		);
	});

	it('has no dedicated reason for printable or other statuses', () => {
		expect(reprintUnavailableReason('active')).toBeNull();
		expect(reprintUnavailableReason('checked_out')).toBeNull();
	});
});

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

	it.each([
		'kiosk_registered',
		'cancelled',
		'checked_out',
		'transferred',
		'deceased',
		'unknown',
		undefined
	])('excludes household members with status %s', (status) => {
		expect(isListedHouseholdMember({ current_stay: { status } })).toBe(false);
	});

	it('excludes members who opted out of search', () => {
		expect(
			isListedHouseholdMember({
				current_stay: { status: 'arriving' },
				privacy: { search_excluded: true }
			})
		).toBe(false);
	});
});
