import { afterEach, describe, expect, it, vi } from 'vitest';
import { localizeVolunteerMessage } from '../domain/volunteer-messages.i18n';
import {
	API_ERROR_CODES,
	apiErrorCopy,
	applyScheduleAction,
	applyToJob,
	cancelTicket,
	fetchAccessStatus,
	fetchJobs,
	fetchProfile,
	fetchRoleCardToken,
	fetchSchedule,
	fetchVolunteerSkills,
	findTickets,
	getTicket,
	preflightApplication,
	resolvePortalAccess,
	respondToDispatch,
	updateProfileSkills
} from './volunteer-api';

const THAI = /[฀-๿]/;
const phone = { phone: '0812345678' };

afterEach(() => {
	vi.unstubAllGlobals();
});

function failWith(status: number, body: unknown = null) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(body === null ? null : JSON.stringify(body), { status }))
	);
}

async function messageOf(call: () => Promise<unknown>): Promise<string> {
	try {
		await call();
	} catch (error) {
		return (error as Error).message;
	}
	throw new Error('expected the call to fail');
}

const applyInput = {
	job_id: 'job:1',
	first_name: 'A',
	last_name: 'B',
	phone: '0812345678',
	skills: []
};

// Every call that can fail with only its own fallback wording (no code, no server message).
const failingCalls: Record<string, () => Promise<unknown>> = {
	getTicket: () => getTicket('TKT-1'),
	findTickets: () => findTickets(phone),
	cancelTicket: () => cancelTicket('TKT-1', 'app:1'),
	fetchSchedule: () => fetchSchedule(phone),
	fetchAccessStatus: () => fetchAccessStatus(phone),
	respondToDispatch: () =>
		respondToDispatch({ assignment_id: 'a', code: 'ABC234', action: 'accepted', ...phone }),
	applyScheduleAction: () =>
		applyScheduleAction({ assignment_id: 'a', action: 'check_in', ...phone }),
	fetchJobs: () => fetchJobs(),
	preflightApplication: () => preflightApplication(applyInput),
	applyToJob: () => applyToJob('job:1', applyInput),
	fetchProfile: () => fetchProfile(phone),
	resolvePortalAccess: () => resolvePortalAccess(phone),
	fetchRoleCardToken: () => fetchRoleCardToken(phone),
	updateProfileSkills: () => updateProfileSkills({ skills: [], ...phone }),
	fetchVolunteerSkills: () => fetchVolunteerSkills()
};

describe('volunteer portal API failure messages follow the selected language', () => {
	it('en: every coded error reads in English', () => {
		expect(API_ERROR_CODES.length).toBeGreaterThan(30);
		for (const code of API_ERROR_CODES) {
			const thai = apiErrorCopy(code);
			expect(thai, code).toMatch(THAI);
			const english = localizeVolunteerMessage(thai!, 'en');
			expect(english, code).not.toMatch(THAI);
			expect(english, code).not.toBe('');
		}
	});

	it('en: every call fallback message reads in English', async () => {
		failWith(500);
		for (const [name, call] of Object.entries(failingCalls)) {
			const message = await messageOf(call);
			expect(message, `${name} (th)`).toMatch(THAI);
			expect(localizeVolunteerMessage(message, 'en'), name).not.toMatch(THAI);
		}
	});

	it('en: the generic "request failed (status)" message keeps its status code', () => {
		expect(localizeVolunteerMessage('คำขอไม่สำเร็จ (502)', 'en')).toBe('Request failed (502)');
	});

	it('en: spot-checks of the wording a volunteer meets most often', () => {
		expect(localizeVolunteerMessage(apiErrorCopy('JOB_NOT_OPEN')!, 'en')).toBe(
			'This volunteer job is closed for applications'
		);
		expect(localizeVolunteerMessage(apiErrorCopy('TIME_CONFLICT')!, 'en')).toBe(
			'You have another shift that overlaps in time'
		);
		expect(localizeVolunteerMessage(apiErrorCopy('RATE_LIMITED')!, 'en')).toBe(
			'Too many requests. Please wait a moment and try again'
		);
	});

	it('en: the validation messages the apply route itself sends read in English', () => {
		expect(localizeVolunteerMessage('กรุณาระบุชื่อ', 'en')).toBe('Please enter a first name');
		expect(localizeVolunteerMessage('กรุณาระบุนามสกุล', 'en')).toBe('Please enter a last name');
		expect(localizeVolunteerMessage('ข้อมูลไม่ถูกต้อง', 'en')).toBe('Invalid data');
	});

	it('en: the quick-apply preflight "ambiguous match" message reads in English', () => {
		expect(
			localizeVolunteerMessage(
				'พบข้อมูลที่อาจตรงกับมากกว่าหนึ่ง profile กรุณาติดต่อเจ้าหน้าที่',
				'en'
			)
		).toBe('More than one volunteer profile may match these details. Please contact the staff');
	});

	it('th: the Thai copy is unchanged and a server message we do not know passes through', async () => {
		expect(apiErrorCopy('JOB_NOT_OPEN')).toBe('งานอาสาสมัครนี้ปิดรับสมัครแล้ว');
		failWith(400, { error: 'BAD_INPUT', message: 'Phone is malformed' });
		const message = await messageOf(() => findTickets(phone));
		expect(message).toBe('Phone is malformed');
		expect(localizeVolunteerMessage(message, 'en')).toBe('Phone is malformed');
	});
});
