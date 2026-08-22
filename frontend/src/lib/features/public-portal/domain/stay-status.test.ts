import { describe, expect, it } from 'vitest';
import {
	isInShelterStatus,
	PUBLIC_STAY_STATUSES,
	publicStayStatusLabel,
	publicStayStatusTone
} from './stay-status';

describe('publicStayStatusLabel', () => {
	it('labels every staff status the projection can emit', () => {
		for (const status of PUBLIC_STAY_STATUSES) {
			expect(publicStayStatusLabel(status)).not.toBe(status);
			expect(publicStayStatusLabel(status).length).toBeGreaterThan(0);
		}
	});

	it('uses the backoffice wording', () => {
		expect(publicStayStatusLabel('pre_registered')).toBe('ลงทะเบียนล่วงหน้า');
		expect(publicStayStatusLabel('active')).toBe('เข้าพักแล้ว');
		expect(publicStayStatusLabel('temporary_leave')).toBe('ออกชั่วคราว');
	});

	it('echoes an unmapped status instead of hiding it', () => {
		expect(publicStayStatusLabel('unknown')).toBe('unknown');
		expect(publicStayStatusLabel('')).toBe('ไม่ทราบสถานะ');
		expect(publicStayStatusLabel(null)).toBe('ไม่ทราบสถานะ');
	});
});

describe('publicStayStatusTone', () => {
	// The whole point of CR-080: a booking that nobody has arrived for must not
	// look the same as a person standing in the shelter.
	it('separates a reservation from an actual arrival', () => {
		expect(publicStayStatusTone('active')).toBe('safe');
		expect(publicStayStatusTone('pre_registered')).toBe('pending');
	});

	it('gives moved, ended and deceased their own tones', () => {
		expect(publicStayStatusTone('transferred')).toBe('moved');
		expect(publicStayStatusTone('checked_out')).toBe('ended');
		expect(publicStayStatusTone('cancelled')).toBe('ended');
		expect(publicStayStatusTone('deceased')).toBe('grave');
	});
});

describe('isInShelterStatus', () => {
	it('is true only for someone actually checked in', () => {
		expect(isInShelterStatus('active')).toBe(true);
		// Checked in but off site — a searcher asking "are they there?" gets no.
		expect(isInShelterStatus('temporary_leave')).toBe(false);
		expect(isInShelterStatus('pre_registered')).toBe(false);
		expect(isInShelterStatus(null)).toBe(false);
		expect(isInShelterStatus(undefined)).toBe(false);
	});
});
