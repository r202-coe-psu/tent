import { describe, expect, it } from 'vitest';
import {
	dispatchRespondSchema,
	isJobApplicable,
	isUpcomingShift,
	normalizeTicketToken,
	ticketTokenFromScan,
	isValidThaiNationalId,
	needsDispatchResponse,
	responseCodeSchema,
	shiftStatusLabel,
	ticketStatusLabel,
	volunteerApplySchema,
	volunteerProfileUpdateSchema,
	type PublicJob,
	type ScheduleShift
} from './volunteer';

describe('isValidThaiNationalId', () => {
	it('accepts a number with a correct mod-11 check digit', () => {
		expect(isValidThaiNationalId('1101700207030')).toBe(true);
	});

	it('rejects a transposed digit that keeps the right length', () => {
		expect(isValidThaiNationalId('1101700207031')).toBe(false);
	});

	it('rejects anything that is not 13 digits', () => {
		expect(isValidThaiNationalId('110170020703')).toBe(false);
		expect(isValidThaiNationalId('')).toBe(false);
	});
});

describe('volunteerApplySchema', () => {
	const base = { first_name: 'สมชาย', last_name: 'ใจดี', phone: '081-234-5678' };

	it('strips separators from the phone so the server hashes a stable form', () => {
		const parsed = volunteerApplySchema.parse(base);
		expect(parsed.phone).toBe('0812345678');
	});

	it('accepts an application with no national id — passport holders have none', () => {
		expect(volunteerApplySchema.safeParse(base).success).toBe(true);
	});

	it('rejects a national id that fails the checksum', () => {
		const result = volunteerApplySchema.safeParse({ ...base, national_id: '1111111111111' });
		expect(result.success).toBe(false);
	});

	it('rejects a phone that is not a Thai mobile number', () => {
		expect(volunteerApplySchema.safeParse({ ...base, phone: '12345' }).success).toBe(false);
	});
});

describe('ticketStatusLabel', () => {
	it('maps the CR-092 statuses to Thai copy', () => {
		expect(ticketStatusLabel('confirmed')).toBe('ยืนยันแล้ว');
		expect(ticketStatusLabel('pending_review')).toBe('รอการพิจารณา');
	});

	it('passes an unknown status through rather than rendering blank', () => {
		expect(ticketStatusLabel('something_new')).toBe('something_new');
	});
});

function shift(overrides: Partial<ScheduleShift> = {}): ScheduleShift {
	return {
		assignment_id: 'shift_assignment:01A',
		job_id: 'job:01J',
		job_title: 'ผู้ช่วยครัว',
		shelter_code: 'SH001',
		shelter_name: 'ศูนย์ทดสอบ',
		date: '2026-09-01',
		shift: 'custom',
		station: 'ครัวกลาง',
		start_ts: '2026-09-01T01:00:00Z',
		end_ts: '2026-09-01T05:00:00Z',
		check_in_at: null,
		check_out_at: null,
		status: 'assigned',
		dispatch_status: null,
		...overrides
	};
}

describe('isUpcomingShift', () => {
	const now = new Date('2026-09-01T03:00:00Z');

	it('counts a shift still running as upcoming, not history', () => {
		expect(isUpcomingShift(shift(), now)).toBe(true);
	});

	it('moves a shift past its end into history', () => {
		expect(isUpcomingShift(shift({ end_ts: '2026-09-01T02:00:00Z' }), now)).toBe(false);
	});

	it('falls back to the date when no duty window was set', () => {
		expect(isUpcomingShift(shift({ start_ts: null, end_ts: null, date: '2026-08-01' }), now)).toBe(
			false
		);
		expect(isUpcomingShift(shift({ start_ts: null, end_ts: null, date: '2026-09-02' }), now)).toBe(
			true
		);
	});

	it('keeps a shift with no time information visible rather than filing it away', () => {
		expect(isUpcomingShift(shift({ start_ts: null, end_ts: null, date: '' }), now)).toBe(true);
	});

	it('treats an unparseable timestamp as upcoming rather than hiding the shift', () => {
		expect(isUpcomingShift(shift({ end_ts: 'not-a-date' }), now)).toBe(true);
	});
});

describe('needsDispatchResponse', () => {
	it('is true only while an offer is still awaiting an answer', () => {
		expect(needsDispatchResponse(shift({ dispatch_status: 'dispatched' }))).toBe(true);
		expect(needsDispatchResponse(shift({ dispatch_status: 'accepted' }))).toBe(false);
		expect(needsDispatchResponse(shift({ dispatch_status: null }))).toBe(false);
	});

	it('does not ask for an answer on a cancelled shift', () => {
		expect(
			needsDispatchResponse(shift({ dispatch_status: 'dispatched', status: 'cancelled' }))
		).toBe(false);
	});
});

describe('shiftStatusLabel', () => {
	it('maps the CR-092 shift lifecycle to Thai copy', () => {
		expect(shiftStatusLabel('checked_in')).toBe('ปฏิบัติหน้าที่อยู่');
		expect(shiftStatusLabel('standby')).toBe('รอสแตนด์บาย');
	});

	it('treats the schema.md spelling `done` as `completed`', () => {
		expect(shiftStatusLabel('done')).toBe(shiftStatusLabel('completed'));
	});
});

describe('responseCodeSchema', () => {
	it('accepts the code however it was heard down the phone', () => {
		for (const typed of ['4K7-2M9', '4k72m9', ' 4K7 2M9 ', '4k7-2m9']) {
			const parsed = responseCodeSchema.safeParse(typed);
			expect(parsed.success, typed).toBe(true);
			if (parsed.success) expect(parsed.data).toBe('4K72M9');
		}
	});

	it('rejects the characters the alphabet leaves out, so a mishearing is caught here', () => {
		// I, L, O, U, 0 and 1 are excluded precisely because they are misheard.
		for (const bad of ['4I7-2M9', '4O7-2M9', '4L7-2M9', '407-2M9', '417-2M9']) {
			expect(responseCodeSchema.safeParse(bad).success, bad).toBe(false);
		}
	});

	it('rejects a code of the wrong length', () => {
		expect(responseCodeSchema.safeParse('4K7-2M').success).toBe(false);
		expect(responseCodeSchema.safeParse('4K7-2M99').success).toBe(false);
	});

	it('rejects an empty code with a message the volunteer can act on', () => {
		const parsed = responseCodeSchema.safeParse('  ');
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues[0]?.message).toContain('รหัส');
		}
	});
});

describe('dispatchRespondSchema', () => {
	it('carries the normalised code through, not what was typed', () => {
		const parsed = dispatchRespondSchema.safeParse({
			assignment_id: 'shift_assignment:01A',
			code: '4k7 2m9',
			action: 'accepted'
		});
		expect(parsed.success).toBe(true);
		if (parsed.success) expect(parsed.data.code).toBe('4K72M9');
	});

	it('only allows the two answers the spec defines', () => {
		const base = { assignment_id: 'shift_assignment:01A', code: '4K7-2M9' };
		expect(dispatchRespondSchema.safeParse({ ...base, action: 'declined' }).success).toBe(true);
		expect(dispatchRespondSchema.safeParse({ ...base, action: 'maybe' }).success).toBe(false);
	});
});

describe('isJobApplicable', () => {
	const job = (overrides: Partial<PublicJob> = {}): PublicJob => ({
		job_id: 'job:01A',
		shelter_code: 'SH001',
		shelter_name: 'ศูนย์ทดสอบ',
		title: 'ครัวกลาง',
		description: '',
		tier: 'operational',
		skills_required: [],
		shift_template: { shift_name: 'กะเช้า', start_time: '08:00', end_time: '16:00', days: [] },
		quota: 10,
		slots_confirmed: 4,
		slots_remaining: 6,
		status: 'open',
		requires_review: false,
		...overrides
	});

	it('accepts a job that still has a seat', () => {
		expect(isJobApplicable(job())).toBe(true);
		expect(isJobApplicable(job({ status: 'open', slots_remaining: 1 }))).toBe(true);
	});

	it('refuses a job with no seat left, whatever its status still says', () => {
		// The projection can lag behind the counter — the seat count is what decides, so a
		// job still flagged `open` cannot be applied to once it is actually full.
		expect(isJobApplicable(job({ slots_remaining: 0 }))).toBe(false);
	});

	it('refuses a closed or cancelled job even while seats remain', () => {
		expect(isJobApplicable(job({ status: 'closed' }))).toBe(false);
		expect(isJobApplicable(job({ status: 'cancelled' }))).toBe(false);
	});
});

describe('normalizeTicketToken', () => {
	it('uppercases a tracking token, which is hex and case-insensitive in practice', () => {
		expect(normalizeTicketToken('  tkt-vol-abc123  ')).toBe('TKT-VOL-ABC123');
	});

	it('leaves a view reference exactly as it was — it is base64url and case matters', () => {
		// Upper-casing one destroys the HMAC signature, which is how the old sign-in
		// silently rejected every reference minted by a phone lookup.
		const view = 'VIEW-am9iOjE.aBcD_eF-';
		expect(normalizeTicketToken(` ${view} `)).toBe(view);
		expect(normalizeTicketToken('view-am9iOjE.aBcD_eF-')).toBe('VIEW-am9iOjE.aBcD_eF-');
	});

	it('refuses anything that is not one of the two shapes', () => {
		// The placeholder on the login form used to advertise this one; it never worked.
		expect(normalizeTicketToken('V-1001')).toBeNull();
		expect(normalizeTicketToken('0812345678')).toBeNull();
		expect(normalizeTicketToken('   ')).toBeNull();
	});
});

describe('ticketTokenFromScan', () => {
	it('pulls the token out of the pass URL a QR actually encodes', () => {
		expect(ticketTokenFromScan('https://shelter.example/volunteer/ticket/TKT-VOL-AB12')).toBe(
			'TKT-VOL-AB12'
		);
	});

	it('ignores a query string or fragment the link picked up', () => {
		expect(ticketTokenFromScan('/volunteer/ticket/TKT-VOL-AB12?from=qr#top')).toBe('TKT-VOL-AB12');
	});

	it('accepts a bare token, since some codes carry only that', () => {
		expect(ticketTokenFromScan('TKT-VOL-AB12')).toBe('TKT-VOL-AB12');
	});

	it('returns null for a QR that is not a pass at all', () => {
		expect(ticketTokenFromScan('https://example.com/menu')).toBeNull();
	});
});

describe('volunteerProfileUpdateSchema', () => {
	it('accepts the skills a volunteer picked', () => {
		const parsed = volunteerProfileUpdateSchema.safeParse({ skills: ['ครัว', 'ขับรถ'] });
		expect(parsed.success && parsed.data.skills).toEqual(['ครัว', 'ขับรถ']);
	});

	it('defaults to clearing every skill rather than failing on an absent list', () => {
		// "I have no skills to declare" is a real edit, and the form sends nothing for it.
		const parsed = volunteerProfileUpdateSchema.safeParse({});
		expect(parsed.success && parsed.data.skills).toEqual([]);
	});

	it('refuses a list longer than the API stores', () => {
		const tooMany = Array.from({ length: 31 }, (_, i) => `skill-${i}`);
		expect(volunteerProfileUpdateSchema.safeParse({ skills: tooMany }).success).toBe(false);
	});

	it('cannot express a staff-only change, whatever the caller sends', () => {
		// The extra keys are stripped, not stored — this is what makes the write path safe
		// even though the credential reaching it (a phone number) is guessable.
		const parsed = volunteerProfileUpdateSchema.safeParse({
			skills: ['ครัว'],
			identity_verified: true,
			volunteer_code: 'V-999',
			status: 'inactive'
		});
		expect(parsed.success && parsed.data).toEqual({ skills: ['ครัว'] });
	});
});
