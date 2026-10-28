import { describe, expect, it } from 'vitest';
import { sha256Hex } from '$lib/db/hash';
import { normalizeThaiPhone } from '$lib/db/model';
import {
	VOLUNTEER_PHONE_MESSAGE,
	isVolunteerMobile,
	optionalVolunteerMobileSchema,
	volunteerMobileSchema
} from './volunteer-phone';

describe('volunteer phone rule', () => {
	it.each([
		['0812345678', '0812345678'],
		['081-234-5678', '0812345678'],
		['081.234.5678', '0812345678'],
		['66812345678', '0812345678'],
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

	it('uses the central message', () => {
		const result = volunteerMobileSchema.safeParse('022222222');
		expect(result.success).toBe(false);
		expect(result.error?.issues[0].message).toBe(VOLUNTEER_PHONE_MESSAGE);
		expect(VOLUNTEER_PHONE_MESSAGE).toBe('เบอร์โทรต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0');
	});

	it('every written form yields the same phone_hash input and hash', async () => {
		const forms = ['0812345678', '081.234.5678', '081-234-5678', '+66812345678', '66812345678'];
		const expectedHash = await sha256Hex('0812345678');
		for (const form of forms) {
			expect(normalizeThaiPhone(form)).toBe('0812345678');
			expect(volunteerMobileSchema.parse(form)).toBe(normalizeThaiPhone(form));
			expect(await sha256Hex(normalizeThaiPhone(form))).toBe(expectedHash);
		}
	});
});
