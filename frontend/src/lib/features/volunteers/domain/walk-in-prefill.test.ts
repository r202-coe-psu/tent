import { describe, expect, it } from 'vitest';
import { walkInVolunteerFormSchema } from './volunteer.schema';
import { evacueeToWalkInPrefill } from './walk-in-prefill';

const full = {
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	nickname: 'ชาย',
	phone: '0812345678',
	person_id: { cardType: 'national_id', number: '1234567890123' }
};

describe('evacueeToWalkInPrefill', () => {
	it('maps every available field', () => {
		expect(evacueeToWalkInPrefill(full)).toEqual({
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			nickname: 'ชาย',
			phone: '0812345678',
			national_id: '1234567890123'
		});
	});

	it('omits nickname, phone and national_id the evacuee does not have', () => {
		const fill = evacueeToWalkInPrefill({
			first_name: 'สมหญิง',
			last_name: 'รักดี',
			phone: null
		});
		expect(fill).toEqual({ first_name: 'สมหญิง', last_name: 'รักดี' });
		expect('phone' in fill).toBe(false);
		expect('national_id' in fill).toBe(false);
		expect('nickname' in fill).toBe(false);
	});

	it('treats blank strings as missing', () => {
		const fill = evacueeToWalkInPrefill({
			...full,
			nickname: '  ',
			phone: ' ',
			person_id: { cardType: 'national_id', number: '' }
		});
		expect(fill).toEqual({ first_name: 'สมชาย', last_name: 'ใจดี' });
	});

	it('normalises a formatted / +66 phone to a 10-digit mobile', () => {
		expect(evacueeToWalkInPrefill({ ...full, phone: '081-234-5678' }).phone).toBe('0812345678');
		expect(evacueeToWalkInPrefill({ ...full, phone: '+66 81 234 5678' }).phone).toBe('0812345678');
	});

	it('skips a phone that is not a valid mobile (e.g. landline)', () => {
		expect(evacueeToWalkInPrefill({ ...full, phone: '074-123456' }).phone).toBeUndefined();
	});

	it('only fills national_id for a 13-digit national_id card', () => {
		for (const person_id of [
			{ cardType: 'passport', number: 'AA1234567' },
			{ cardType: 'anonymous', number: 'ANON-01ARZ3NDEKTSV4RRFFQ69G5FAV' },
			{ cardType: 'national_id', number: '12345' }
		]) {
			expect(evacueeToWalkInPrefill({ ...full, person_id }).national_id).toBeUndefined();
		}
	});

	it('omits last_name when the evacuee has none, without inventing a value', () => {
		expect(evacueeToWalkInPrefill({ ...full, last_name: '' }).last_name).toBeUndefined();
	});

	it('produces values the walk-in form schema accepts', () => {
		const result = walkInVolunteerFormSchema.safeParse({
			first_name: '',
			last_name: '',
			nickname: '',
			phone: '',
			email: '',
			national_id: '',
			...evacueeToWalkInPrefill({ ...full, phone: '+66 81 234 5678' })
		});
		expect(result.success).toBe(true);
	});
});
