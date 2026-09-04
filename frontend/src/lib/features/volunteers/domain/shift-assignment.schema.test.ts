import { describe, it, expect } from 'vitest';
import {
	shiftAssignmentSchema,
	isShiftAssignment,
	makeShiftAssignment,
	shiftAssignmentInputSchema,
	dutyWindowSchema,
	type ShiftAssignmentInput
} from './shift-assignment.schema';

const ctx = { shelterCode: 'SH001', createdBy: 'tester' };

function validWindow() {
	return { start_ts: '2026-08-26T08:00:00.000Z', end_ts: '2026-08-26T16:00:00.000Z' };
}

function validDoc() {
	return {
		_id: 'shift_assignment:01AAAAAAAAAAAAAAAAAAAAAAAA',
		type: 'shift_assignment' as const,
		schema_v: 3 as const,
		shelter_code: 'SH001',
		created_at: '2026-08-26T00:00:00.000Z',
		updated_at: '2026-08-26T00:00:00.000Z',
		created_by: 'tester',
		job_id: 'job:01AAAAAAAAAAAAAAAAAAAAAAAA',
		volunteer_id: 'volunteer:01AAAAAAAAAAAAAAAAAAAAAAAA',
		date: '2026-08-26',
		shift: 'morning' as const,
		station: 'ครัว',
		duty_window: validWindow(),
		check_in_at: null,
		check_out_at: null,
		check_in_by: null,
		status: 'assigned' as const,
		dispatch_status: null,
		check_in_method: 'qr' as const,
		check_in_reason: null
	};
}

const baseInput: ShiftAssignmentInput = {
	job_id: 'job:01AAAAAAAAAAAAAAAAAAAAAAAA',
	shift_id: 'shift:01AAAAAAAAAAAAAAAAAAAAAAA',
	volunteer_id: 'volunteer:01AAAAAAAAAAAAAAAAAAAAAAAA',
	date: '2026-08-26',
	shift: 'morning',
	station: 'ครัว',
	duty_window: validWindow()
};

describe('dutyWindowSchema (F10)', () => {
	it('accepts a valid ISO-8601 UTC window with start before end', () => {
		expect(dutyWindowSchema.safeParse(validWindow()).success).toBe(true);
	});

	it('rejects a non-datetime string', () => {
		expect(
			dutyWindowSchema.safeParse({ start_ts: 'not-a-date', end_ts: '2026-08-26T16:00:00.000Z' })
				.success
		).toBe(false);
	});

	it('rejects start_ts >= end_ts', () => {
		expect(
			dutyWindowSchema.safeParse({
				start_ts: '2026-08-26T16:00:00.000Z',
				end_ts: '2026-08-26T08:00:00.000Z'
			}).success
		).toBe(false);
		expect(
			dutyWindowSchema.safeParse({
				start_ts: '2026-08-26T08:00:00.000Z',
				end_ts: '2026-08-26T08:00:00.000Z'
			}).success
		).toBe(false);
	});
});

describe('shiftAssignmentSchema', () => {
	it('accepts a fully valid document', () => {
		expect(shiftAssignmentSchema.safeParse(validDoc()).success).toBe(true);
	});

	it('requires the shift_assignment: _id prefix', () => {
		expect(shiftAssignmentSchema.safeParse({ ...validDoc(), _id: 'job:oops' }).success).toBe(false);
	});

	it('accepts legacy v3 and rejects unsupported schema versions', () => {
		expect(shiftAssignmentSchema.safeParse({ ...validDoc(), schema_v: 2 }).success).toBe(false);
	});

	describe('F12 — job_id legacy migration sentinel', () => {
		it('accepts job_id: "legacy" (schema.md §2.9 v1 -> v2 migration)', () => {
			expect(shiftAssignmentSchema.safeParse({ ...validDoc(), job_id: 'legacy' }).success).toBe(
				true
			);
		});

		it('accepts a normal job: id', () => {
			expect(shiftAssignmentSchema.safeParse(validDoc()).success).toBe(true);
		});

		it('rejects any other non-job: string', () => {
			expect(shiftAssignmentSchema.safeParse({ ...validDoc(), job_id: 'garbage' }).success).toBe(
				false
			);
		});
	});

	describe('manual_override -> check_in_reason refine', () => {
		it('rejects manual_override with no check_in_reason', () => {
			const result = shiftAssignmentSchema.safeParse({
				...validDoc(),
				check_in_method: 'manual_override',
				check_in_reason: null
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues.some((i) => i.path.includes('check_in_reason'))).toBe(true);
			}
		});

		it('accepts manual_override with a check_in_reason', () => {
			expect(
				shiftAssignmentSchema.safeParse({
					...validDoc(),
					check_in_method: 'manual_override',
					check_in_reason: 'QR สแกนไม่ได้'
				}).success
			).toBe(true);
		});

		it('accepts qr method with no reason', () => {
			expect(
				shiftAssignmentSchema.safeParse({
					...validDoc(),
					check_in_method: 'qr',
					check_in_reason: null
				}).success
			).toBe(true);
		});
	});

	describe('F13 — optional fields', () => {
		it('check_in_at/check_out_at/check_in_by/dispatch_status are optional keys', () => {
			const doc = validDoc() as Record<string, unknown>;
			delete doc.check_in_at;
			delete doc.check_out_at;
			delete doc.check_in_by;
			delete doc.dispatch_status;
			expect(shiftAssignmentSchema.safeParse(doc).success).toBe(true);
		});
	});

	it('rejects an unknown shift enum value', () => {
		expect(shiftAssignmentSchema.safeParse({ ...validDoc(), shift: 'graveyard' }).success).toBe(
			false
		);
	});

	it('rejects an unknown status enum value', () => {
		expect(shiftAssignmentSchema.safeParse({ ...validDoc(), status: 'done' }).success).toBe(false);
	});

	it('rejects a malformed date', () => {
		expect(shiftAssignmentSchema.safeParse({ ...validDoc(), date: '26-08-2026' }).success).toBe(
			false
		);
	});

	it('rejects hostile input shapes', () => {
		expect(shiftAssignmentSchema.safeParse([]).success).toBe(false);
		expect(shiftAssignmentSchema.safeParse(null).success).toBe(false);
	});
});

describe('isShiftAssignment', () => {
	it('is true for a valid document', () => {
		expect(isShiftAssignment(validDoc())).toBe(true);
	});

	it('is false for a manual_override document with no reason (would previously silently disable the collision guard for garbage windows, F11)', () => {
		expect(
			isShiftAssignment({
				...validDoc(),
				check_in_method: 'manual_override',
				check_in_reason: null
			})
		).toBe(false);
	});
});

describe('shiftAssignmentInputSchema', () => {
	it('accepts a valid input', () => {
		expect(shiftAssignmentInputSchema.safeParse(baseInput).success).toBe(true);
	});

	it('requires job_id to start with job: (legacy sentinel not accepted for NEW writes)', () => {
		expect(shiftAssignmentInputSchema.safeParse({ ...baseInput, job_id: 'legacy' }).success).toBe(
			false
		);
	});

	it('rejects a duty_window with start >= end', () => {
		expect(
			shiftAssignmentInputSchema.safeParse({
				...baseInput,
				duty_window: { start_ts: '2026-08-26T16:00:00.000Z', end_ts: '2026-08-26T08:00:00.000Z' }
			}).success
		).toBe(false);
	});
});

describe('makeShiftAssignment', () => {
	it('defaults to status assigned, check_in_method qr, all check-in fields null', () => {
		const a = makeShiftAssignment(baseInput, ctx);
		expect(a._id).toMatch(/^shift_assignment:/);
		expect(a.schema_v).toBe(4);
		expect(a.status).toBe('assigned');
		expect(a.check_in_method).toBe('qr');
		expect(a.check_in_at).toBeNull();
		expect(a.check_in_by).toBeNull();
		expect(a.check_in_reason).toBeNull();
		expect(a.dispatch_status).toBeNull();
	});

	it('F9 — can set check_in_at/check_in_by at creation (walk-in instant check-in, FR-VOL-10.5)', () => {
		const a = makeShiftAssignment(baseInput, ctx, {
			status: 'checked_in',
			check_in_at: '2026-08-26T08:05:00.000Z',
			check_in_by: 'staff-1'
		});
		expect(a.status).toBe('checked_in');
		expect(a.check_in_at).toBe('2026-08-26T08:05:00.000Z');
		expect(a.check_in_by).toBe('staff-1');
	});

	it('F9 — can set a manual override with a reason at creation (FR-VOL-11.1/11.2)', () => {
		const a = makeShiftAssignment(baseInput, ctx, {
			status: 'checked_in',
			check_in_at: '2026-08-26T08:05:00.000Z',
			check_in_by: 'staff-1',
			check_in_method: 'manual_override',
			check_in_reason: 'QR สแกนไม่ได้'
		});
		expect(a.check_in_method).toBe('manual_override');
		expect(a.check_in_reason).toBe('QR สแกนไม่ได้');
	});

	it('F9 — still enforces the manual_override-requires-reason refine at creation time', () => {
		expect(() =>
			makeShiftAssignment(baseInput, ctx, {
				check_in_method: 'manual_override'
				// no check_in_reason
			})
		).toThrow();
	});

	it('produces a document that itself satisfies shiftAssignmentSchema', () => {
		const a = makeShiftAssignment(baseInput, ctx);
		expect(shiftAssignmentSchema.safeParse(a).success).toBe(true);
	});

	it('rejects an invalid duty_window at the input boundary', () => {
		expect(() =>
			makeShiftAssignment(
				{
					...baseInput,
					duty_window: { start_ts: 'garbage', end_ts: 'also-garbage' }
				},
				ctx
			)
		).toThrow();
	});
});
