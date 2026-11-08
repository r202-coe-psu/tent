import { describe, expect, it } from 'vitest';
import { findBookingConflict } from './booking-overlap';
import { mergePortalActivities } from './schedule-view';
import {
	dispatchRespondSchema,
	portalCredentialSchema,
	shiftStatusLabel,
	ticketFindSchema,
	volunteerApplySchema,
	volunteerProfileUpdateSchema,
	type ScheduleShift,
	type TicketSummary
} from './volunteer';
import { localizeVolunteerMessage } from '$lib/constants/i18n/volunteer-messages';

const THAI = /[฀-๿]/;

const shift = (overrides: Partial<ScheduleShift> = {}): ScheduleShift => ({
	assignment_id: 'shift_assignment:1',
	job_id: 'job:1',
	shift_id: 'shift:1',
	job_title: '',
	shelter_code: 'SH001',
	shelter_name: 'Main shelter',
	date: '2026-09-10',
	shift: 'morning',
	station: 'Kitchen',
	start_ts: '2026-09-10T01:00:00.000Z',
	end_ts: '2026-09-10T05:00:00.000Z',
	check_in_at: null,
	check_out_at: null,
	status: 'assigned',
	dispatch_status: null,
	...overrides
});

const ticket = (overrides: Partial<TicketSummary> = {}): TicketSummary => ({
	job_id: 'job:2',
	applicant_name: 'Ann',
	status: 'confirmed',
	job_title: '',
	shelter_code: 'SH001',
	shift_date: '2026-09-11',
	shift_id: null,
	...overrides
});

describe('shiftStatusLabel', () => {
	it('names each shift status in English on request and stays Thai by default', () => {
		expect(shiftStatusLabel('assigned', 'en')).toBe('Assigned');
		expect(shiftStatusLabel('standby', 'en')).toBe('Standby');
		expect(shiftStatusLabel('checked_in', 'en')).toBe('On duty');
		expect(shiftStatusLabel('done', 'en')).toBe('Checked out');
		expect(shiftStatusLabel('no_show', 'en')).toBe('No-show');
		expect(shiftStatusLabel('cancelled', 'en')).toBe('Cancelled');
		expect(shiftStatusLabel('assigned')).toBe('ได้รับมอบหมาย');
		expect(shiftStatusLabel('cancelled', 'th')).toBe('ยกเลิกแล้ว');
	});
});

describe('mergePortalActivities in English', () => {
	it('words a rostered shift without Thai when the language is en', () => {
		const [activity] = mergePortalActivities(
			[shift({ station: 'Gate 2', shift: 'custom' })],
			[],
			'en'
		);
		expect(activity).toMatchObject({
			title: 'Volunteer job',
			description: 'Duty station: Gate 2',
			shiftPeriod: 'Custom time slot'
		});
	});

	it('words a booking that is waiting to be rostered without Thai when the language is en', () => {
		const [activity] = mergePortalActivities([], [ticket()], 'en');
		expect(activity).toMatchObject({
			title: 'Volunteer job',
			description: 'Your application is waiting for staff to assign a shift',
			shiftPeriod: 'Awaiting shift'
		});
		expect(JSON.stringify(activity)).not.toMatch(THAI);
	});

	it('keeps the Thai wording by default', () => {
		const [activity] = mergePortalActivities([], [ticket()]);
		expect(activity).toMatchObject({
			title: 'งานอาสาสมัคร',
			description: 'การสมัครของคุณอยู่ระหว่างรอเจ้าหน้าที่จัดกะให้',
			shiftPeriod: 'รอจัดกะ'
		});
	});
});

describe('findBookingConflict in English', () => {
	const existing = {
		id: 'booking:1',
		jobId: 'job:existing',
		shiftId: null,
		assignmentId: null,
		title: '',
		description: '',
		location: 'x',
		shelterCode: 'SH001',
		date: '2026-09-09',
		shiftPeriod: '',
		startTs: '2026-09-09T01:00:00.000Z',
		endTs: '2026-09-09T09:00:00.000Z',
		checkinAt: null,
		checkoutAt: null,
		status: 'booking',
		dispatchStatus: null
	};
	const candidate = { start_ts: '2026-09-09T08:00:00.000Z', end_ts: '2026-09-09T16:00:00.000Z' };

	it('titles an untitled conflicting activity in English when asked', () => {
		expect(findBookingConflict(candidate, [existing], 'en')?.title).toBe('Volunteer job');
	});

	it('keeps the Thai fallback title by default', () => {
		expect(findBookingConflict(candidate, [existing])?.title).toBe('งานอาสาสมัคร');
	});
});

describe('localizeVolunteerMessage for form validation messages', () => {
	const messagesOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
		result.error?.issues.map((issue) => issue.message) ?? [];

	const failures: Record<string, string[]> = {
		'apply form: blank names, phone and shift': messagesOf(
			volunteerApplySchema.safeParse({
				first_name: '',
				last_name: '',
				phone: '',
				shift_id: '',
				email: 'nope',
				national_id: '1234567890123',
				shifts: []
			})
		),
		'apply form: too many shifts': messagesOf(
			volunteerApplySchema.safeParse({
				first_name: 'A',
				last_name: 'B',
				phone: '0812345678',
				shifts: Array.from({ length: 32 }, () => ({ shift_id: 's' }))
			})
		),
		'apply form: bad shift date': messagesOf(
			volunteerApplySchema.safeParse({
				first_name: 'A',
				last_name: 'B',
				phone: '0812345678',
				shifts: [{ shift_date: '10/09/2026' }]
			})
		),
		'apply form: malformed phone': messagesOf(
			volunteerApplySchema.safeParse({ first_name: 'A', last_name: 'B', phone: '123' })
		),
		'find ticket: blank phone': messagesOf(ticketFindSchema.safeParse({ phone: '' })),
		'credential: blank phone': messagesOf(portalCredentialSchema.safeParse({ phone: '' })),
		'profile: too many skills': messagesOf(
			volunteerProfileUpdateSchema.safeParse({
				skills: Array.from({ length: 31 }, (_, i) => `skill-${i}`)
			})
		),
		'response code: blank': messagesOf(
			dispatchRespondSchema.safeParse({ assignment_id: 'a', code: '', action: 'accepted' })
		),
		'response code: wrong alphabet': messagesOf(
			dispatchRespondSchema.safeParse({ assignment_id: 'a', code: 'IIIIII', action: 'accepted' })
		)
	};

	it('every case really produces a Thai message (cases stay meaningful)', () => {
		for (const [name, messages] of Object.entries(failures)) {
			expect(messages.length, name).toBeGreaterThan(0);
		}
	});

	it('en: no validation message keeps Thai text', () => {
		for (const [name, messages] of Object.entries(failures)) {
			for (const message of messages) {
				expect(localizeVolunteerMessage(message, 'en'), `${name}: ${message}`).not.toMatch(THAI);
			}
		}
	});

	it('en: reads naturally for the common cases', () => {
		expect(localizeVolunteerMessage('กรุณากรอกชื่อ', 'en')).toBe('Please enter a first name');
		expect(localizeVolunteerMessage('เลือกได้ไม่เกิน 31 กะต่อครั้ง', 'en')).toBe(
			'You can pick at most 31 shifts per application'
		);
		expect(localizeVolunteerMessage('เลือกทักษะได้สูงสุด 30 รายการ', 'en')).toBe(
			'You can pick at most 30 skills'
		);
	});

	it('th: returns the message untouched, and unknown messages pass through in both languages', () => {
		expect(localizeVolunteerMessage('กรุณากรอกชื่อ', 'th')).toBe('กรุณากรอกชื่อ');
		expect(localizeVolunteerMessage('Something else', 'en')).toBe('Something else');
	});
});
