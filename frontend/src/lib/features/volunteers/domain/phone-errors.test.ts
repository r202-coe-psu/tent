import { describe, expect, it } from 'vitest';
import {
	VolunteerPhoneTakenError,
	formatVolunteerPhoneTakenMessage,
	isVolunteerPhoneTakenError,
	phoneTakenReactivateHint
} from './phone-errors';

describe('VolunteerPhoneTakenError (CR-239 FR-9)', () => {
	it('formats message for a single active volunteer', () => {
		const existing = [
			{
				_id: 'volunteer:01',
				volunteer_code: 'V-012',
				first_name: 'สมชาย',
				last_name: 'ใจดี',
				status: 'active' as const
			}
		];
		const error = new VolunteerPhoneTakenError(existing);
		expect(error.message).toBe('เบอร์นี้มีอยู่แล้วในศูนย์: V-012 สมชาย ใจดี');
		expect(formatVolunteerPhoneTakenMessage(existing)).toBe(
			'เบอร์นี้มีอยู่แล้วในศูนย์: V-012 สมชาย ใจดี'
		);
		expect(error.code).toBe('VOLUNTEER_PHONE_TAKEN');
		expect(isVolunteerPhoneTakenError(error)).toBe(true);
	});

	it('formats message for inactive volunteer with suffix (ปิดใช้งานอยู่)', () => {
		const existing = [
			{
				_id: 'volunteer:02',
				volunteer_code: 'V-005',
				first_name: 'สมหญิง',
				last_name: 'รักสงบ',
				status: 'inactive' as const
			}
		];
		const error = new VolunteerPhoneTakenError(existing);
		expect(error.message).toBe('เบอร์นี้มีอยู่แล้วในศูนย์: V-005 สมหญิง รักสงบ (ปิดใช้งานอยู่)');
	});

	it('sorts multiple existing profiles by volunteer_code and joins with comma', () => {
		const existing = [
			{
				_id: 'volunteer:03',
				volunteer_code: 'V-020',
				first_name: 'มานะ',
				last_name: 'อดทน',
				status: 'active' as const
			},
			{
				_id: 'volunteer:04',
				volunteer_code: 'V-003',
				first_name: 'ชูใจ',
				last_name: 'มีสุข',
				status: 'inactive' as const
			}
		];
		const error = new VolunteerPhoneTakenError(existing);
		expect(error.message).toBe(
			'เบอร์นี้มีอยู่แล้วในศูนย์: V-003 ชูใจ มีสุข (ปิดใช้งานอยู่), V-020 มานะ อดทน'
		);
		expect(error.existing).toHaveLength(2);
		expect(error.existing[0].volunteer_code).toBe('V-003');
		expect(error.existing[1].volunteer_code).toBe('V-020');
	});

	it('identifies VolunteerPhoneTakenError correctly', () => {
		expect(isVolunteerPhoneTakenError(new Error('normal'))).toBe(false);
		expect(isVolunteerPhoneTakenError(null)).toBe(false);
		expect(isVolunteerPhoneTakenError({ code: 'VOLUNTEER_PHONE_TAKEN' })).toBe(false);
		const duckTyped = new Error('custom');
		(duckTyped as unknown as { code: string }).code = 'VOLUNTEER_PHONE_TAKEN';
		expect(isVolunteerPhoneTakenError(duckTyped)).toBe(true);
	});
});

describe('phoneTakenReactivateHint (CR-239 FR-12 / AC-3)', () => {
	const active = {
		_id: 'volunteer:a',
		volunteer_code: 'V-001',
		first_name: 'ก',
		last_name: 'ข',
		status: 'active' as const
	};
	const inactive = {
		...active,
		_id: 'volunteer:b',
		volunteer_code: 'V-002',
		status: 'inactive' as const
	};

	it('tells staff to reopen the closed profile instead of creating a new one', () => {
		const hint = phoneTakenReactivateHint([inactive]);
		expect(hint).toContain('เปิดใช้งานอีกครั้ง');
		expect(hint).toContain('แทนการสร้างใหม่');
	});

	it('is null when every profile holding the phone is active', () => {
		expect(phoneTakenReactivateHint([active])).toBeNull();
		expect(phoneTakenReactivateHint([])).toBeNull();
	});

	it('still shows the hint when active and inactive profiles both hold the phone', () => {
		expect(phoneTakenReactivateHint([active, inactive])).not.toBeNull();
	});
});
