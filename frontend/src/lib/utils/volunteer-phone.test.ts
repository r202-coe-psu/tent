import { describe, expect, it } from 'vitest';
import {
	isVolunteerMobile,
	optionalVolunteerMobileSchema,
	volunteerMobileSchema
} from './volunteer-phone';

describe('volunteer phone rule', () => {
	it.each([
		['0812345678', '0812345678'],
		['081-234-5678', '0812345678'],
		[' 081 234 5678 ', '0812345678'],
		['+66812345678', '0812345678']
	])('accepts %s as %s', (input, expected) => {
		expect(volunteerMobileSchema.parse(input)).toBe(expected);
		expect(isVolunteerMobile(input)).toBe(true);
	});

	it.each(['022222222', '02-222-2222', '081234567', '08123456789', 'ไม่มี', '-', ''])(
		'rejects %j',
		(input) => {
			expect(volunteerMobileSchema.safeParse(input).success).toBe(false);
			expect(isVolunteerMobile(input)).toBe(false);
		}
	);

	it('optional variant turns blank into null but still rejects junk', () => {
		expect(optionalVolunteerMobileSchema.parse('')).toBeNull();
		expect(optionalVolunteerMobileSchema.parse(undefined)).toBeNull();
		expect(optionalVolunteerMobileSchema.parse('081-234-5678')).toBe('0812345678');
		expect(optionalVolunteerMobileSchema.safeParse('ไม่มี').success).toBe(false);
	});
});
