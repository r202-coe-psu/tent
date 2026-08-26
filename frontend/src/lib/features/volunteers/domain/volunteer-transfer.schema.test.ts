import { describe, it, expect } from 'vitest';
import {
	volunteerTransferSchema,
	isVolunteerTransfer,
	makeVolunteerTransfer,
	volunteerTransferInputSchema,
	type VolunteerTransferInput
} from './volunteer-transfer.schema';

const ctx = { shelterCode: 'SH001', createdBy: 'tester' };

function validDoc() {
	return {
		_id: 'volunteer_transfer:01AAAAAAAAAAAAAAAAAAAAAAAA',
		type: 'volunteer_transfer' as const,
		schema_v: 1 as const,
		shelter_code: 'SH001',
		created_at: '2026-08-26T00:00:00.000Z',
		updated_at: '2026-08-26T00:00:00.000Z',
		created_by: 'tester',
		volunteer_id: 'volunteer:01AAAAAAAAAAAAAAAAAAAAAAAA',
		from_shelter_code: 'SH001',
		to_shelter_code: 'SH002',
		reason: 'ย้ายที่พักอาศัย',
		status: 'pending' as const,
		requested_by: 'tester',
		decided_by: null,
		decided_at: null
	};
}

const baseInput: VolunteerTransferInput = {
	volunteer_id: 'volunteer:01AAAAAAAAAAAAAAAAAAAAAAAA',
	from_shelter_code: 'SH001',
	to_shelter_code: 'SH002',
	reason: 'ย้ายที่พักอาศัย'
};

describe('volunteerTransferSchema', () => {
	it('accepts a fully valid document', () => {
		expect(volunteerTransferSchema.safeParse(validDoc()).success).toBe(true);
	});

	it('requires the volunteer_transfer: _id prefix', () => {
		expect(volunteerTransferSchema.safeParse({ ...validDoc(), _id: 'other:1' }).success).toBe(
			false
		);
	});

	it('requires schema_v to be the literal 1', () => {
		expect(volunteerTransferSchema.safeParse({ ...validDoc(), schema_v: 2 }).success).toBe(false);
	});

	describe('F17 — from !== to refine (a slice addition, not spec — see code comment)', () => {
		it('rejects from_shelter_code === to_shelter_code', () => {
			const result = volunteerTransferSchema.safeParse({
				...validDoc(),
				from_shelter_code: 'SH001',
				to_shelter_code: 'SH001'
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues.some((i) => i.path.includes('to_shelter_code'))).toBe(true);
			}
		});

		it('accepts distinct from/to shelter codes', () => {
			expect(
				volunteerTransferSchema.safeParse({
					...validDoc(),
					from_shelter_code: 'SH001',
					to_shelter_code: 'SH002'
				}).success
			).toBe(true);
		});
	});

	describe('F13 — optional fields', () => {
		it('reason/decided_by/decided_at are optional keys', () => {
			const doc = validDoc() as Record<string, unknown>;
			delete doc.reason;
			delete doc.decided_by;
			delete doc.decided_at;
			expect(volunteerTransferSchema.safeParse(doc).success).toBe(true);
		});
	});

	it('rejects an unknown status enum value', () => {
		expect(volunteerTransferSchema.safeParse({ ...validDoc(), status: 'in_review' }).success).toBe(
			false
		);
	});

	it('requires the volunteer_id to start with volunteer:', () => {
		expect(
			volunteerTransferSchema.safeParse({ ...validDoc(), volunteer_id: 'other:1' }).success
		).toBe(false);
	});

	it('rejects hostile input shapes', () => {
		expect(volunteerTransferSchema.safeParse([]).success).toBe(false);
		expect(volunteerTransferSchema.safeParse(null).success).toBe(false);
	});
});

describe('isVolunteerTransfer', () => {
	it('is true for a valid document', () => {
		expect(isVolunteerTransfer(validDoc())).toBe(true);
	});

	it('is false for a same-shelter transfer', () => {
		expect(
			isVolunteerTransfer({ ...validDoc(), from_shelter_code: 'SH001', to_shelter_code: 'SH001' })
		).toBe(false);
	});

	it('is false for garbage input without throwing', () => {
		expect(isVolunteerTransfer('nope')).toBe(false);
	});
});

describe('volunteerTransferInputSchema', () => {
	it('accepts a valid input', () => {
		expect(volunteerTransferInputSchema.safeParse(baseInput).success).toBe(true);
	});

	it('rejects from === to at the input boundary too', () => {
		expect(
			volunteerTransferInputSchema.safeParse({
				...baseInput,
				from_shelter_code: 'SH001',
				to_shelter_code: 'SH001'
			}).success
		).toBe(false);
	});

	it('defaults reason to null when omitted', () => {
		const withoutReason: Omit<VolunteerTransferInput, 'reason'> = {
			volunteer_id: baseInput.volunteer_id,
			from_shelter_code: baseInput.from_shelter_code,
			to_shelter_code: baseInput.to_shelter_code
		};
		const parsed = volunteerTransferInputSchema.parse(withoutReason);
		expect(parsed.reason).toBeNull();
	});
});

describe('makeVolunteerTransfer', () => {
	it('mints a pending transfer stamped from ctx.createdBy', () => {
		const t = makeVolunteerTransfer(baseInput, ctx);
		expect(t._id).toMatch(/^volunteer_transfer:/);
		expect(t.schema_v).toBe(1);
		expect(t.status).toBe('pending');
		expect(t.requested_by).toBe('tester');
		expect(t.decided_by).toBeNull();
		expect(t.decided_at).toBeNull();
	});

	it('produces a document that itself satisfies volunteerTransferSchema', () => {
		const t = makeVolunteerTransfer(baseInput, ctx);
		expect(volunteerTransferSchema.safeParse(t).success).toBe(true);
	});

	it('rejects from === to at the input boundary', () => {
		expect(() =>
			makeVolunteerTransfer(
				{ ...baseInput, from_shelter_code: 'SH001', to_shelter_code: 'SH001' },
				ctx
			)
		).toThrow();
	});
});
