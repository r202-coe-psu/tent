import { describe, it, expect } from 'vitest';
import {
	volunteerSchema,
	isVolunteer,
	makeVolunteer,
	nationalIdSchema,
	type VolunteerInput
} from './volunteer.schema';

const ctx = { shelterCode: 'SH001', createdBy: 'tester' };

function validVolunteerDoc() {
	return {
		_id: 'volunteer:01AAAAAAAAAAAAAAAAAAAAAAAA',
		type: 'volunteer' as const,
		schema_v: 2 as const,
		shelter_code: 'SH001',
		created_at: '2026-08-26T00:00:00.000Z',
		updated_at: '2026-08-26T00:00:00.000Z',
		created_by: 'tester',
		first_name: 'สมชาย',
		last_name: 'ใจดี',
		phone: '0812345678',
		skills: ['ขับรถ'],
		status: 'active' as const,
		national_id: null,
		checked_in: false,
		current_shelter_code: null,
		volunteer_code: 'V-001',
		identity_verified: false,
		source: 'walk_in' as const
	};
}

const baseInput: VolunteerInput = {
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	phone: '0812345678',
	skills: ['ขับรถ'],
	source: 'walk_in',
	national_id: null
};

describe('nationalIdSchema', () => {
	it('accepts exactly 13 digits', () => {
		expect(nationalIdSchema.safeParse('1234567890123').success).toBe(true);
	});

	it('rejects fewer than 13 digits', () => {
		expect(nationalIdSchema.safeParse('123456789012').success).toBe(false);
	});

	it('rejects more than 13 digits', () => {
		expect(nationalIdSchema.safeParse('12345678901234').success).toBe(false);
	});

	it('rejects non-digit characters', () => {
		expect(nationalIdSchema.safeParse('123456789012a').success).toBe(false);
	});

	it('trims surrounding whitespace before checking length', () => {
		expect(nationalIdSchema.safeParse('  1234567890123  ').success).toBe(true);
	});

	it('rejects an empty string', () => {
		expect(nationalIdSchema.safeParse('').success).toBe(false);
	});
});

describe('volunteerSchema', () => {
	it('accepts a fully valid document', () => {
		expect(volunteerSchema.safeParse(validVolunteerDoc()).success).toBe(true);
	});

	it('requires the volunteer: _id prefix', () => {
		expect(volunteerSchema.safeParse({ ...validVolunteerDoc(), _id: 'other:123' }).success).toBe(
			false
		);
	});

	it('requires schema_v to be the literal 2', () => {
		expect(volunteerSchema.safeParse({ ...validVolunteerDoc(), schema_v: 1 }).success).toBe(false);
		expect(volunteerSchema.safeParse({ ...validVolunteerDoc(), schema_v: 3 }).success).toBe(false);
	});

	it('national_id is optional (F13) — a document without the key at all is still valid', () => {
		const doc = validVolunteerDoc() as Record<string, unknown>;
		delete doc.national_id;
		expect(volunteerSchema.safeParse(doc).success).toBe(true);
	});

	it('current_shelter_code is optional (F13) — a document without the key at all is still valid', () => {
		const doc = validVolunteerDoc() as Record<string, unknown>;
		delete doc.current_shelter_code;
		expect(volunteerSchema.safeParse(doc).success).toBe(true);
	});

	it('rejects a malformed national_id even when present', () => {
		expect(
			volunteerSchema.safeParse({ ...validVolunteerDoc(), national_id: 'not-13-digits' }).success
		).toBe(false);
	});

	it('rejects an unknown status enum value', () => {
		expect(volunteerSchema.safeParse({ ...validVolunteerDoc(), status: 'banned' }).success).toBe(
			false
		);
	});

	it('rejects an unknown source enum value', () => {
		expect(
			volunteerSchema.safeParse({ ...validVolunteerDoc(), source: 'carrier_pigeon' }).success
		).toBe(false);
	});

	it('rejects a missing required field (first_name)', () => {
		const doc = validVolunteerDoc() as Record<string, unknown>;
		delete doc.first_name;
		expect(volunteerSchema.safeParse(doc).success).toBe(false);
	});

	it('rejects hostile input shapes (array, null, string)', () => {
		expect(volunteerSchema.safeParse([]).success).toBe(false);
		expect(volunteerSchema.safeParse(null).success).toBe(false);
		expect(volunteerSchema.safeParse('volunteer:1').success).toBe(false);
	});
});

describe('isVolunteer', () => {
	it('is true for a valid document', () => {
		expect(isVolunteer(validVolunteerDoc())).toBe(true);
	});

	it('is false for garbage input without throwing', () => {
		expect(isVolunteer({ nope: true })).toBe(false);
		expect(isVolunteer(undefined)).toBe(false);
	});
});

describe('makeVolunteer', () => {
	it('stamps volunteer: id prefix, schema_v 2, and CR-094 §6 migration defaults', () => {
		const v = makeVolunteer(baseInput, ctx, { volunteer_code: 'V-001' });
		expect(v._id).toMatch(/^volunteer:/);
		expect(v.type).toBe('volunteer');
		expect(v.schema_v).toBe(2);
		expect(v.checked_in).toBe(false);
		expect(v.identity_verified).toBe(false);
		expect(v.current_shelter_code).toBeNull();
		expect(v.volunteer_code).toBe('V-001');
		expect(v.status).toBe('active');
	});

	it('defaults status to active, overridable via fields', () => {
		const inactive = makeVolunteer(baseInput, ctx, { volunteer_code: 'V-002', status: 'inactive' });
		expect(inactive.status).toBe('inactive');
	});

	it('produces a document that itself satisfies volunteerSchema', () => {
		const v = makeVolunteer(baseInput, ctx, { volunteer_code: 'V-003' });
		expect(volunteerSchema.safeParse(v).success).toBe(true);
	});

	it('rejects a missing first_name at the input boundary', () => {
		expect(() =>
			makeVolunteer({ ...baseInput, first_name: '' }, ctx, { volunteer_code: 'V-004' })
		).toThrow();
	});

	it('rejects a malformed national_id at the input boundary', () => {
		expect(() =>
			makeVolunteer({ ...baseInput, national_id: 'garbage' }, ctx, { volunteer_code: 'V-005' })
		).toThrow();
	});
});
