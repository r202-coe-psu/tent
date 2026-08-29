/**
 * Volunteer Access Portal domain — types + validation, no I/O.
 *
 * Field shapes follow CR-092 §1.1 (`job`, `job_application`) and the FastAPI contract
 * in `$lib/api/openapi.d.ts`. Kept hand-written rather than re-exported from the
 * generated types so the rules live somewhere a test can reach without a server.
 */
import { z } from 'zod';

/** CR-092 §4 ticket statuses. `rejected` is deliberately absent — see the module notes. */
export const TICKET_STATUSES = ['confirmed', 'pending_review', 'cancelled'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** CR-092 §4 — the shift lifecycle the portal renders. */
export const SHIFT_STATUSES = [
	'assigned',
	'standby',
	'checked_in',
	'completed',
	'no_show',
	'cancelled'
] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

export const DISPATCH_STATUSES = ['dispatched', 'accepted', 'declined'] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

export type JobShiftTemplate = {
	shift_name: string;
	start_time: string;
	end_time: string;
	days: string[];
};

export type PublicJob = {
	job_id: string;
	shelter_code: string;
	shelter_name: string;
	title: string;
	description: string;
	tier: string;
	skills_required: string[];
	shift_template: JobShiftTemplate;
	quota: number;
	slots_confirmed: number;
	slots_remaining: number;
	status: string;
	requires_review: boolean;
};

export type TicketShift = {
	date: string;
	start_time: string;
	end_time: string;
	station: string | null;
};

export type VolunteerTicket = {
	token: string;
	/**
	 * False when the pass was reached through a phone lookup rather than the applicant's
	 * own ticket link. Reading is fine; cancelling is not, because a phone number is
	 * guessable and a withdrawn shift cannot be taken back. The API enforces this too —
	 * hiding the button is the courtesy, not the control.
	 */
	can_cancel: boolean;
	status: TicketStatus | string;
	job_id: string;
	job_title: string;
	shelter_code: string;
	shelter_name: string;
	applicant_name: string;
	phone_masked: string;
	skills: string[];
	selected_shift: TicketShift;
	applied_at: string;
	qr_payload: string;
};

/**
 * One shift on ตารางทำงานจิตอาสา (CR-092 หน้าจอ 6).
 *
 * Sourced from `shift_assignment`, not from an application: this is what the volunteer
 * is rostered to turn up for, and it carries the duty window the Time-Bound access
 * guard reads and the check-in stamps the tablet station writes.
 */
export type ScheduleShift = {
	assignment_id: string;
	job_id: string;
	job_title: string;
	shelter_code: string;
	shelter_name: string;
	date: string;
	shift: string;
	station: string;
	start_ts: string | null;
	end_ts: string | null;
	check_in_at: string | null;
	check_out_at: string | null;
	status: ShiftStatus | string;
	/** `dispatched` is an offer awaiting the volunteer's answer — CR-092 FR-VOL-06. */
	dispatch_status: DispatchStatus | string | null;
};

export type TicketSummary = {
	/** Read-only and expiring — never the applicant's tracking token. */
	view_token: string;
	/** The name on the application, so the portal can greet the right person. */
	applicant_name: string;
	status: TicketStatus | string;
	job_title: string;
	shelter_code: string;
	shift_date: string;
};

/** Thai mobile numbers, tolerant of the separators people actually type. */
const phoneField = z
	.string()
	.trim()
	.min(1, 'กรุณากรอกเบอร์โทรศัพท์')
	.transform((value) => value.replace(/[\s-()]/g, ''))
	.refine((value) => /^0\d{8,9}$/.test(value), 'เบอร์โทรศัพท์ไม่ถูกต้อง');

/**
 * Optional on purpose. CR-092 lists the 13-digit ID as a main field, but a volunteer
 * holding a passport or a pink card has none, and turning them away at the form is a
 * worse outcome than a profile that dedupes on phone alone. The checksum is the
 * standard Thai mod-11 so a typo is caught here rather than at the shelter gate.
 */
const nationalIdField = z
	.string()
	.trim()
	.transform((value) => value.replace(/[\s-]/g, ''))
	.refine((value) => value === '' || isValidThaiNationalId(value), 'เลขประจำตัวประชาชนไม่ถูกต้อง')
	.optional();

export function isValidThaiNationalId(value: string): boolean {
	const digits = value.replace(/\D/g, '');
	if (digits.length !== 13) return false;
	let sum = 0;
	for (let i = 0; i < 12; i++) {
		sum += Number(digits[i]) * (13 - i);
	}
	return (11 - (sum % 11)) % 10 === Number(digits[12]);
}

export const volunteerApplySchema = z.object({
	first_name: z.string().trim().min(1, 'กรุณากรอกชื่อ').max(100),
	last_name: z.string().trim().min(1, 'กรุณากรอกนามสกุล').max(100),
	phone: phoneField,
	national_id: nationalIdField,
	email: z.union([z.literal(''), z.email('อีเมลไม่ถูกต้อง')]).optional(),
	skills: z.array(z.string().trim().min(1)).default([]),
	shift_date: z.string().trim().optional(),
	station: z.string().trim().optional()
});

export type VolunteerApplyInput = z.infer<typeof volunteerApplySchema>;

export const ticketFindSchema = z.object({ phone: phoneField });
export type TicketFindInput = z.infer<typeof ticketFindSchema>;

export function ticketStatusLabel(status: string): string {
	switch (status) {
		case 'confirmed':
			return 'ยืนยันแล้ว';
		case 'pending_review':
			return 'รอการพิจารณา';
		case 'cancelled':
			return 'ยกเลิกแล้ว';
		default:
			return status;
	}
}

export function shiftStatusLabel(status: string): string {
	switch (status) {
		case 'assigned':
			return 'ได้รับมอบหมาย';
		case 'standby':
			return 'รอสแตนด์บาย';
		case 'checked_in':
			return 'ปฏิบัติหน้าที่อยู่';
		case 'completed':
		case 'done':
			return 'เช็คเอาต์แล้ว';
		case 'no_show':
			return 'ไม่มาปฏิบัติงาน';
		case 'cancelled':
			return 'ยกเลิกแล้ว';
		default:
			return status;
	}
}

/**
 * Whether this shift is still ahead of the volunteer.
 *
 * Falls back to the date when no duty window was set, and treats an entry with neither
 * as upcoming: a shift with no time on it is one the volunteer should still be shown,
 * not one quietly filed under history.
 */
export function isUpcomingShift(shift: ScheduleShift, now: Date = new Date()): boolean {
	const end = shift.end_ts ?? (shift.date ? `${shift.date}T23:59:59Z` : null);
	if (!end) return true;
	const parsed = new Date(end);
	return Number.isNaN(parsed.getTime()) ? true : parsed.getTime() >= now.getTime();
}

/** The offer is live only while it is still awaiting an answer (CR-092 FR-VOL-06). */
export function needsDispatchResponse(shift: ScheduleShift): boolean {
	return shift.dispatch_status === 'dispatched' && shift.status !== 'cancelled';
}

/**
 * The code a shelter manager reads out when offering a shift.
 *
 * Six characters from an alphabet with the look-alikes removed, shown as `4K7-2M9`.
 * Accepted however it was heard and typed: any case, with or without the dash, and
 * with the spaces someone writing it down mid-call tends to add.
 */
export const responseCodeSchema = z
	.string()
	.trim()
	.min(1, 'กรุณากรอกรหัสที่เจ้าหน้าที่แจ้ง')
	.transform((value) => value.replace(/[\s-]/g, '').toUpperCase())
	// Exactly the alphabet the server mints from: no I, L, O, U, 0 or 1. Written out as
	// two ranges around K–N rather than J-N, which would let the L back in.
	.refine((value) => /^[2-9A-HJKMNP-TV-Z]{6}$/.test(value), 'รหัสไม่ถูกต้อง');

export const dispatchRespondSchema = z.object({
	assignment_id: z.string().min(1),
	code: responseCodeSchema,
	action: z.enum(['accepted', 'declined'])
});

export type DispatchRespondInput = z.infer<typeof dispatchRespondSchema>;
