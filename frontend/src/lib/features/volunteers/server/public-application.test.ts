import { describe, expect, it } from 'vitest';
import { PublicApplicationError, selectedShift } from './public-application';

const shifts = [
	{
		shift_id: 'shift-morning',
		date: '2026-09-10',
		start_time: '08:00',
		end_time: '12:00'
	},
	{
		shift_id: 'shift-afternoon',
		date: '2026-09-10',
		start_time: '13:00',
		end_time: '17:00'
	}
];

const job = { shifts } as Parameters<typeof selectedShift>[0];
const baseInput = {
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	phone: '0812345678',
	skills: []
} satisfies Omit<
	Parameters<typeof selectedShift>[1],
	'shift_id' | 'shift_date' | 'start_time' | 'end_time'
>;

describe('selectedShift', () => {
	it('rejects a shift id that is not advertised by the job', () => {
		expect(() => selectedShift(job, { ...baseInput, shift_id: 'shift-forged' })).toThrowError(
			new PublicApplicationError('SHIFT_NOT_FOUND', 422)
		);
	});

	it('rejects an ambiguous date instead of silently taking the first shift', () => {
		expect(() => selectedShift(job, { ...baseInput, shift_date: '2026-09-10' })).toThrowError(
			new PublicApplicationError('SHIFT_DATE_AMBIGUOUS', 422)
		);
	});

	it('resolves a date and time to the exact advertised shift', () => {
		expect(
			selectedShift(job, {
				...baseInput,
				shift_date: '2026-09-10',
				start_time: '13:00',
				end_time: '17:00'
			})!.shift_id
		).toBe('shift-afternoon');
	});

	it('requires an explicit shift identity when a job has multiple shifts', () => {
		expect(() => selectedShift(job, baseInput)).toThrowError(
			new PublicApplicationError('SHIFT_ID_REQUIRED', 422)
		);
	});

	it('rejects a date that is not present on the job', () => {
		expect(() => selectedShift(job, { ...baseInput, shift_date: '2026-09-11' })).toThrowError(
			new PublicApplicationError('SHIFT_NOT_FOUND', 422)
		);
	});
});
