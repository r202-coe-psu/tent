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
	/** Empty only for legacy projections during the compatibility rollout. */
	shifts?: PublicJobShift[];
	quota: number;
	slots_confirmed: number;
	slots_remaining: number;
	status: string;
	requires_review: boolean;
};

export type PublicJobShift = {
	shift_id: string;
	date: string;
	end_date: string | null;
	start_time: string;
	end_time: string;
	station: string | null;
	quota: number;
	slots_confirmed: number;
	slots_remaining: number;
};

export type TicketShift = {
	shift_id?: string | null;
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
	shift_id?: string | null;
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
	shift_id?: string | null;
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
	shift_id?: string | null;
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
	/** Used by the direct CouchDB writer to select the job's shelter database. */
	shelter_code: z.string().trim().min(1).optional(),
	first_name: z.string().trim().min(1, 'กรุณากรอกชื่อ').max(100),
	last_name: z.string().trim().min(1, 'กรุณากรอกนามสกุล').max(100),
	phone: phoneField,
	national_id: nationalIdField,
	email: z.union([z.literal(''), z.email('อีเมลไม่ถูกต้อง')]).optional(),
	skills: z.array(z.string().trim().min(1)).default([]),
	shift_id: z.string().trim().min(1, 'กรุณาเลือกกะ').optional(),
	shift_date: z.string().trim().optional(),
	station: z.string().trim().optional(),
	/**
	 * reCAPTCHA v3 token (FR-VOL-13.4). Optional in the schema because the BFF decides
	 * whether a token is required — a developer with no Google keys must still be able to
	 * run the flow, while production fails closed. Never forwarded upstream.
	 */
	captchaToken: z.string().optional()
});

export type VolunteerApplyInput = z.infer<typeof volunteerApplySchema>;

/**
 * What the public board may narrow by on the server. Kept to what FastAPI's
 * `GET /public/v1/jobs` actually accepts — everything else the board offers (free-text
 * search, "ใกล้เต็ม", controlled-skill) is decided client-side from the projected quota,
 * because there is no server-side index for it.
 */
export type PublicJobFilter = {
	shelter_code?: string;
	skill?: string;
};

/** A card can be applied to only while the projection still shows a free seat. */
export function isJobApplicable(job: PublicJob): boolean {
	return job.slots_remaining > 0 && job.status !== 'closed' && job.status !== 'cancelled';
}

export const ticketFindSchema = z.object({ phone: phoneField });
export type TicketFindInput = z.infer<typeof ticketFindSchema>;

/**
 * How the portal identifies the signed-in volunteer on every request.
 *
 * Exactly one of the two, mirroring the API. Both are sign-in routes for someone with
 * no account (CR-092 หน้าจอ 6): the phone they applied with, or the ticket token behind
 * the QR on their pass — which is why scanning that QR signs in rather than merely
 * re-opening the pass.
 */
export type PortalCredential =
	{ phone: string; token?: undefined } | { token: string; phone?: undefined };

/**
 * Validates whichever credential a portal request carries — the BFF's gate before
 * anything reaches FastAPI, which refuses "neither" and "both" the same way.
 *
 * The phone goes through the same normalisation the apply form uses, so a number typed
 * with dashes here hashes to the one stored at sign-up.
 */
export const portalCredentialSchema = z.union([
	z.object({ phone: phoneField }),
	z.object({ token: z.string().trim().min(6).max(200) })
]);

/**
 * One selectable skill, as Master Data defines it (`volunteer_skills`).
 *
 * The public form reads the same list the back office edits, so a skill added on the
 * settings screen appears here without a deploy — which is the point of FR-VOL-08.5
 * moving this off the hard-coded constant it used to live in.
 */
export type VolunteerSkillOption = {
	code: string;
	label: string;
	category: string;
	description: string;
	is_default: boolean;
};

/**
 * The volunteer's own profile, merged across every shelter they hold one at.
 *
 * `volunteer` is a per-shelter document, so someone who has helped at two centres has
 * two of them; the API merges them into this one shape. Everything except `skills` is
 * read-only here — the rest is either identity the shelter recorded or a decision only
 * staff may make (`identity_verified`, `volunteer_code`, `personnel_type`).
 */
export type VolunteerProfile = {
	first_name: string;
	last_name: string;
	nickname: string | null;
	phone_masked: string;
	email: string | null;
	volunteer_code: string;
	skills: string[];
	organization: string | null;
	identity_verified: boolean;
	personnel_type: string;
	shelter_codes: string[];
};

/**
 * What a volunteer may change about themselves — skills only, for now.
 *
 * Deliberately a separate schema from the profile it edits: a request body that cannot
 * express `identity_verified` or `status` cannot be forged into changing them, whatever
 * the caller sends. Capped at the same 30 the API caps at so an oversized list is
 * refused before it costs a round trip.
 */
export const volunteerProfileUpdateSchema = z.object({
	skills: z.array(z.string().trim().min(1)).max(30, 'เลือกทักษะได้สูงสุด 30 รายการ').default([])
});
export type VolunteerProfileUpdateInput = z.infer<typeof volunteerProfileUpdateSchema>;

/**
 * Where a just-made booking leaves its tracking token for the portal to pick up.
 *
 * `sessionStorage`, not the URL: the token is a bearer credential for that person's
 * PII, and a query string would put it in history, in any referrer, and in whatever the
 * browser syncs. Read once and cleared — it is a one-hop handoff between two screens of
 * the same tab, not a stored session.
 */
export const PORTAL_TOKEN_HANDOFF_KEY = 'volunteer-portal-handoff-token';

const TRACKING_TOKEN_PREFIX = 'TKT-VOL-';
const VIEW_TOKEN_PREFIX = 'VIEW-';

/**
 * Clean up a code that was typed, pasted or scanned, or `null` if it is neither shape.
 *
 * Case matters for only one of the two: a tracking token is uppercase hex and people
 * type it off a printed pass in whatever case they like, while a `VIEW-` reference is
 * base64url and upper-casing it destroys the signature. So the prefix is matched
 * case-insensitively and only the tracking token's body is normalised.
 */
export function normalizeTicketToken(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	if (trimmed.toUpperCase().startsWith(TRACKING_TOKEN_PREFIX)) {
		return trimmed.toUpperCase();
	}
	if (trimmed.toUpperCase().startsWith(VIEW_TOKEN_PREFIX)) {
		return VIEW_TOKEN_PREFIX + trimmed.slice(VIEW_TOKEN_PREFIX.length);
	}
	return null;
}

/** A QR on a pass encodes its URL, so a scan hands us a link, not a bare token. */
export function ticketTokenFromScan(scanned: string): string | null {
	const direct = normalizeTicketToken(scanned);
	if (direct) return direct;
	const fromUrl = scanned.trim().split(/[?#]/)[0]?.split('/').filter(Boolean).pop();
	return fromUrl ? normalizeTicketToken(fromUrl) : null;
}

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
