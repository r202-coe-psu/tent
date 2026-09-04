/**
 * Volunteer Access Portal data access.
 *
 * Browser → same-origin BFF `/api/public/v1/*` only. FastAPI `/public/v1/*` needs
 * EXTERNAL_API_SECRET, which the BFF injects; the SPA must never reach it directly
 * (CR-063).
 */
import type {
	PortalCredential,
	PublicJob,
	PublicJobFilter,
	ScheduleShift,
	TicketSummary,
	VolunteerApplyInput,
	VolunteerProfile,
	VolunteerSkillOption,
	VolunteerTicket
} from '../domain/volunteer';

const ERROR_COPY: Record<string, string> = {
	JOB_NOT_FOUND: 'ไม่พบภารกิจนี้ อาจถูกปิดรับสมัครไปแล้ว',
	JOB_NOT_OPEN: 'ภารกิจนี้ปิดรับสมัครแล้ว',
	JOB_FULL: 'ภารกิจนี้เต็มแล้ว กรุณาเลือกกะหรือภารกิจอื่น',
	ALREADY_APPLIED: 'เบอร์นี้สมัครภารกิจนี้ไว้แล้ว — เปิดดูตั๋วเดิมได้จาก "ค้นหาตั๋วของฉัน"',
	PROFILE_NOT_FOUND: 'ไม่พบโปรไฟล์ของคุณในระบบ — ลองจองภารกิจสักงานก่อน',
	PROFILE_UPDATE_FAILED: 'บันทึกโปรไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
	CAPTCHA_REQUIRED: 'ไม่สามารถยืนยันว่าไม่ใช่บอทได้ กรุณารีเฟรชหน้าแล้วลองใหม่',
	CAPTCHA_FAILED: 'ไม่ผ่านการตรวจสอบ reCAPTCHA กรุณาลองใหม่อีกครั้ง',
	TICKET_NOT_FOUND: 'ไม่พบตั๋วนี้ กรุณาตรวจสอบลิงก์อีกครั้ง',
	NOT_CANCELLABLE: 'ตั๋วนี้ยกเลิกไม่ได้แล้ว',
	RATE_LIMITED: 'ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'
};

function apiError(body: unknown, status: number, fallback: string): Error {
	if (body && typeof body === 'object') {
		const code = (body as { error?: unknown }).error;
		if (typeof code === 'string') return new Error(ERROR_COPY[code] ?? code);
	}
	return new Error(fallback || `คำขอไม่สำเร็จ (${status})`);
}

async function readJson(response: Response): Promise<unknown> {
	return response.json().catch(() => null);
}

export async function getTicket(token: string): Promise<VolunteerTicket> {
	// Called as plain `fetch`, like every other call here. It used to take an injectable
	// `fetchFn` for a SvelteKit `load`, but this app has none (`ssr = false`, no server
	// load), and calling the global through that binding detached it from `window`.
	const response = await fetch(`/api/public/v1/volunteer/ticket/${encodeURIComponent(token)}`);
	const data = await readJson(response);
	if (!response.ok || !data) {
		throw apiError(data, response.status, 'ไม่สามารถเปิดตั๋วนี้ได้');
	}
	return (data as { ticket: VolunteerTicket }).ticket;
}

export type TicketFindResult = {
	tickets: TicketSummary[];
	/**
	 * Already masked by the API. It is the only thing that tells the portal who is signed
	 * in when the credential was a token — the raw number never leaves the server.
	 */
	phoneMasked: string;
};

export async function findTickets(credential: PortalCredential): Promise<TicketFindResult> {
	const response = await fetch('/api/public/v1/volunteer/ticket/find', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(credential)
	});
	const data = await readJson(response);
	if (!response.ok || !data) {
		throw apiError(data, response.status, 'ค้นหาตั๋วไม่สำเร็จ');
	}
	const body = data as { tickets?: TicketSummary[]; phone_masked?: string };
	return { tickets: body.tickets ?? [], phoneMasked: body.phone_masked ?? '' };
}

export async function cancelTicket(token: string): Promise<void> {
	const response = await fetch(
		`/api/public/v1/volunteer/ticket/${encodeURIComponent(token)}/cancel`,
		{ method: 'POST' }
	);
	if (!response.ok) {
		throw apiError(await readJson(response), response.status, 'ยกเลิกการสมัครไม่สำเร็จ');
	}
}

export async function fetchSchedule(credential: PortalCredential): Promise<ScheduleShift[]> {
	const response = await fetch('/api/public/v1/volunteer/schedule', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(credential)
	});
	const data = await readJson(response);
	if (!response.ok || !data) {
		throw apiError(data, response.status, 'ไม่สามารถโหลดตารางงานได้');
	}
	return (data as { shifts?: ScheduleShift[] }).shifts ?? [];
}

export async function fetchJobs(filter: PublicJobFilter = {}): Promise<PublicJob[]> {
	const query = new URLSearchParams();
	if (filter.shelter_code) query.set('shelter_code', filter.shelter_code);
	if (filter.skill) query.set('skill', filter.skill);
	const suffix = query.size > 0 ? `?${query}` : '';

	const response = await fetch(`/api/public/v1/volunteer/jobs${suffix}`);
	const data = await readJson(response);
	if (!response.ok || !data) {
		throw apiError(data, response.status, 'ไม่สามารถโหลดกระดานงานอาสาได้');
	}
	return (data as { jobs?: PublicJob[] }).jobs ?? [];
}

export type ApplyResult = {
	tracking_token: string;
	status: string;
	job_id: string;
};

/**
 * Apply to one job (FR-VOL-02 / AC-VOL-02) — no account, no SMS OTP.
 *
 * The ticket comes back in the response rather than by SMS, so the caller must route
 * the applicant to it immediately: this token is the only way back to the pass, and a
 * lookup by phone hands out a read-only view token instead.
 */
export async function applyToJob(jobId: string, input: VolunteerApplyInput): Promise<ApplyResult> {
	const response = await fetch(`/api/public/v1/volunteer/jobs/${encodeURIComponent(jobId)}/apply`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input)
	});
	const data = await readJson(response);
	if (!response.ok || !data) {
		throw apiError(data, response.status, 'ส่งใบสมัครไม่สำเร็จ');
	}
	return data as ApplyResult;
}

export async function fetchProfile(credential: PortalCredential): Promise<VolunteerProfile | null> {
	const response = await fetch('/api/public/v1/volunteer/profile', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(credential)
	});
	const data = await readJson(response);
	if (!response.ok || !data) {
		throw apiError(data, response.status, 'ไม่สามารถโหลดโปรไฟล์ได้');
	}
	return (data as { profile?: VolunteerProfile | null }).profile ?? null;
}

export async function updateProfileSkills(
	vars: { skills: string[] } & PortalCredential
): Promise<VolunteerProfile | null> {
	const response = await fetch('/api/public/v1/volunteer/profile/update', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(vars)
	});
	const data = await readJson(response);
	if (!response.ok || !data) {
		throw apiError(data, response.status, 'บันทึกโปรไฟล์ไม่สำเร็จ');
	}
	return (data as { profile?: VolunteerProfile | null }).profile ?? null;
}

/**
 * The selectable skills, from Master Data.
 *
 * Answers an empty list rather than throwing when the lookup fails upstream — a form
 * that cannot offer the master list must still let someone keep the skills they already
 * have, and the caller decides what to show.
 */
export async function fetchVolunteerSkills(shelterCode?: string): Promise<VolunteerSkillOption[]> {
	const suffix = shelterCode ? `?shelter=${encodeURIComponent(shelterCode)}` : '';
	const response = await fetch(`/api/public/v1/config/volunteer-skills${suffix}`);
	const data = await readJson(response);
	if (!response.ok || !data) {
		throw apiError(data, response.status, 'ไม่สามารถโหลดรายการทักษะได้');
	}
	return (data as { volunteerSkills?: VolunteerSkillOption[] }).volunteerSkills ?? [];
}
