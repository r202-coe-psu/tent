// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { langState } from '$lib/states/i18n.svelte';
import { PORTAL_SESSION_KEY, type ScheduleShift, type TicketSummary } from '../domain/volunteer';
import VolunteerAccessPortal from './volunteer-access-portal.svelte';

const THAI = /[฀-๿]/;
const state = vi.hoisted(() => ({
	shifts: [] as unknown[],
	tickets: [] as unknown[],
	applications: [] as unknown[],
	cancelledArgs: null as unknown
}));

const profile = {
	first_name: 'Anna',
	last_name: 'Smith',
	nickname: null,
	phone_masked: 'xxx-xxx-2222',
	email: null,
	occupation: null,
	volunteer_code: 'V-1001',
	skills: [],
	organization: null,
	identity_verified: false,
	personnel_type: '',
	shelter_codes: ['SH001'],
	portal_id: 'p1'
};

vi.mock('../application/queries', () => {
	const idleMutation = { mutateAsync: vi.fn(), isPending: false };
	const settled = { isPending: false, isError: false, error: null };
	return {
		volunteerPortalKeys: { all: ['volunteer-portal'] },
		useRespondToDispatchMutation: () => idleMutation,
		useScheduleActionMutation: () => idleMutation,
		useResolvePortalAccessMutation: () => idleMutation,
		useRoleCardTokenMutation: () => idleMutation,
		useUpdateProfileMutation: () => idleMutation,
		useVolunteerSkills: () => ({ ...settled, data: [] }),
		useVolunteerAccessStatus: () => ({ ...settled, data: [] }),
		useVolunteerJobs: () => ({ ...settled, data: [] }),
		useVolunteerProfile: () => ({ ...settled, data: profile }),
		useVolunteerSchedule: () => ({
			...settled,
			get data() {
				return state.shifts;
			}
		}),
		useVolunteerTickets: () => ({
			...settled,
			get data() {
				return { tickets: state.tickets, phoneMasked: 'xxx-xxx-2222' };
			}
		}),
		useVolunteerApplications: () => ({
			...settled,
			get data() {
				return state.applications;
			}
		}),
		useCancelTicketMutation: () => ({
			mutateAsync: vi.fn(async (args) => {
				state.cancelledArgs = args;
			}),
			isPending: false
		})
	};
});
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('$lib/utils/qrcode', () => ({
	generateQrDataUrl: vi.fn(async () => 'data:image/png;base64,')
}));
vi.mock('svelte-sonner', () => ({
	toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}));
vi.mock('@tanstack/svelte-query', async (original) => ({
	...(await original<typeof import('@tanstack/svelte-query')>()),
	useQueryClient: () => ({ removeQueries: vi.fn() })
}));

const shift = (over: Partial<ScheduleShift> = {}): ScheduleShift => ({
	assignment_id: 'shift_assignment:1',
	job_id: 'job:1',
	shift_id: 'shift:1',
	job_title: 'Central kitchen',
	shelter_code: 'SH001',
	shelter_name: 'Main shelter',
	date: '2099-09-10',
	shift: 'morning',
	station: 'Gate 2',
	start_ts: '2099-09-10T01:00:00.000Z',
	end_ts: '2099-09-10T05:00:00.000Z',
	check_in_at: null,
	check_out_at: null,
	status: 'assigned',
	dispatch_status: null,
	...over
});

const ticket = (over: Partial<TicketSummary> = {}): TicketSummary => ({
	job_id: 'job:2',
	applicant_name: 'Anna Smith',
	status: 'confirmed',
	job_title: 'Registration desk',
	shelter_code: 'SH001',
	shift_date: '2099-09-11',
	shift_id: null,
	...over
});

let instance: ReturnType<typeof mount> | null = null;

function openDashboard(language: 'th' | 'en') {
	langState.current = language;
	sessionStorage.setItem(
		PORTAL_SESSION_KEY,
		JSON.stringify({ token: 'TKT-VOL-ABCDEF', portal_id: 'p1', expires_at: Date.now() + 60_000 })
	);
	instance = mount(VolunteerAccessPortal, {
		target: document.body,
		props: { mode: 'dashboard', portalId: 'p1' }
	});
	flushSync();
}

const click = (label: string) => {
	const button = [...document.body.querySelectorAll('button')].find((b) =>
		b.textContent?.includes(label)
	);
	expect(button, `button "${label}"`).toBeTruthy();
	button!.click();
	flushSync();
};

beforeEach(() => {
	state.shifts = [
		shift(),
		shift({
			assignment_id: 'shift_assignment:2',
			job_id: 'job:3',
			shift_id: 'shift:3',
			job_title: 'Gate duty',
			station: 'Gate duty',
			status: 'checked_in',
			check_in_at: '2099-09-12T02:00:00.000Z'
		}),
		shift({
			assignment_id: 'shift_assignment:4',
			job_id: 'job:4',
			shift_id: 'shift:4',
			job_title: 'Water point',
			station: 'Water point',
			dispatch_status: 'dispatched'
		})
	];
	state.tickets = [ticket()];
});
afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	// bits-ui body-scroll-lock cleans up on a 24ms timer; let it run before the env tears down
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
	sessionStorage.clear();
	langState.current = 'th';
});

describe('VolunteerAccessPortal dashboard', () => {
	it('shows English copy for the role card, filters, shifts and rules when the language is EN', () => {
		openDashboard('en');
		const text = document.body.textContent ?? '';
		expect(text).toContain('My volunteer schedule');
		expect(text).toContain('Smart volunteer card (QR Role Card)');
		expect(text).toContain('Volunteer code: V-1001');
		expect(text).toContain('Not verified');
		expect(text).toContain('Affiliation:');
		expect(text).toContain('Edit profile');
		expect(text).toContain('My schedule');
		expect(text).toContain('My volunteer jobs');
		expect(text).toContain('Sorted by nearest date first');
		expect(text).toContain('4 items');
		expect(text).toContain('Filter volunteer jobs');
		expect(text).toContain('Duty station: Gate 2');
		expect(text).toContain('Awaiting shift');
		expect(text).toContain('Waiting for check-in');
		expect(text).toContain('On duty');
		expect(text).toContain('Check-in:');
		expect(text).toContain('Report in (check-in)');
		expect(text).toContain('Check out of the job');
		expect(text).toContain('Request leave / withdraw from shift');
		expect(text).toContain('Accept volunteer job');
		expect(text).toContain('Decline volunteer job');
		expect(text).toContain('Shift rules');
		expect(text).toContain('Please report in (check-in) as soon as you arrive at the shelter');
		expect(text).not.toMatch(THAI);
	});

	it('words the pass window and the leave confirmation in English', () => {
		openDashboard('en');
		click('Expand card');
		expect(document.body.textContent).toContain(
			'Show this QR code to staff at the shelter check-in scan point'
		);
		click('Close window');
		click('Request leave / withdraw from shift');
		const text = document.body.textContent ?? '';
		expect(text).toContain('Confirm leave and withdraw from shift');
		expect(text).not.toMatch(THAI);
	});

	it('keeps the Thai copy when the language is TH', () => {
		openDashboard('th');
		const text = document.body.textContent ?? '';
		expect(text).toContain('ตารางงานจิตอาสา');
		expect(text).toContain('บัตรอาสาสมัครอัจฉริยะ (QR Role Card)');
		expect(text).toContain('รหัสอาสาสมัคร: V-1001');
		expect(text).toContain('ยังไม่ยืนยันตัวตน');
		expect(text).toContain('สังกัด:');
		expect(text).toContain('แก้ไขโปรไฟล์');
		expect(text).toContain('ตารางของฉัน');
		expect(text).toContain('รายการงานอาสาสมัครของฉัน');
		expect(text).toContain('4 รายการ');
		expect(text).toContain('จุดปฏิบัติงาน: Gate 2');
		expect(text).toContain('รอจัดกะ');
		expect(text).toContain('รายงานตัว Check-in');
		expect(text).toContain('ขอลา / ถอนกะ');
		expect(text).toContain('กติกาการเข้ากะ');
	});

	it('renders open ticket and cancel buttons when application matches, opens confirmation dialog (#973)', async () => {
		state.applications = [
			{
				application_id: 'app:1',
				status: 'confirmed',
				job_id: 'job:1',
				shift_id: 'shift:1',
				date: '2099-09-10',
				can_cancel: true
			}
		];
		openDashboard('th');

		const openLink = document.body.querySelector('[data-testid="open-ticket"]');
		expect(openLink).toBeTruthy();
		expect(openLink?.getAttribute('href')).toContain('application=app%3A1');
		expect(openLink?.textContent).toContain('เปิดตั๋ว');

		const cancelButton = document.body.querySelector(
			'[data-testid="cancel-application"]'
		) as HTMLButtonElement | null;
		expect(cancelButton).toBeTruthy();
		expect(cancelButton?.textContent).toContain('ยกเลิก');

		// When cancel button is present and canCancel is true, withdraw button is hidden
		const withdrawButtons = [...document.body.querySelectorAll('button')].filter((b) =>
			b.textContent?.includes('ขอลา / ถอนกะ')
		);
		expect(withdrawButtons).toHaveLength(0);
		cancelButton!.click();
		flushSync();

		// Confirmation dialog opens
		expect(document.body.textContent).toContain('ยืนยันการยกเลิกกะ');
		expect(document.body.textContent).toContain('Central kitchen');

		const confirmBtn = document.body.querySelector(
			'[data-testid="confirm-cancel-application"]'
		) as HTMLButtonElement | null;
		expect(confirmBtn).toBeTruthy();
		confirmBtn!.click();
		flushSync();

		expect(state.cancelledArgs).toEqual({
			token: 'TKT-VOL-ABCDEF',
			applicationId: 'app:1'
		});
	});

	it('restores withdraw button when application cannot be cancelled (W1)', () => {
		// Application exists but cannot be cancelled (e.g., server says can_cancel: false)
		state.applications = [
			{
				application_id: 'app:1',
				status: 'confirmed',
				job_id: 'job:1',
				shift_id: 'shift:1',
				date: '2099-09-10',
				can_cancel: false
			}
		];
		openDashboard('th');

		// Open ticket link is still visible
		expect(document.body.querySelector('[data-testid="open-ticket"]')).toBeTruthy();
		// Cancel button is hidden
		expect(document.body.querySelector('[data-testid="cancel-application"]')).toBeNull();

		// Withdraw button is preserved because canCancel is false (W1 fix)
		const withdrawButtons = [...document.body.querySelectorAll('button')].filter((b) =>
			b.textContent?.includes('ขอลา / ถอนกะ')
		);
		expect(withdrawButtons.length).toBeGreaterThan(0);
	});
});
