import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import VolunteerAccessPortal from './volunteer-access-portal.svelte';

const idleQuery = { data: undefined, isPending: false, isError: false, error: null };
const idleMutation = { mutateAsync: vi.fn(), isPending: false };

vi.mock('../application/queries', () => ({
	volunteerPortalKeys: { all: ['volunteer-portal'] },
	useRespondToDispatchMutation: () => idleMutation,
	useScheduleActionMutation: () => idleMutation,
	useResolvePortalAccessMutation: () => idleMutation,
	useRoleCardTokenMutation: () => idleMutation,
	useVolunteerAccessStatus: () => idleQuery,
	useVolunteerJobs: () => idleQuery,
	useVolunteerProfile: () => idleQuery,
	useVolunteerSchedule: () => idleQuery,
	useVolunteerTickets: () => idleQuery,
	useUpdateProfileMutation: () => idleMutation,
	useVolunteerSkills: () => ({ ...idleQuery, data: [] })
}));
vi.mock('@tanstack/svelte-query', async (original) => ({
	...(await original<typeof import('@tanstack/svelte-query')>()),
	useQueryClient: () => ({ removeQueries: vi.fn() })
}));

function renderPortal(language: 'th' | 'en') {
	const previous = langState.current;
	langState.current = language;
	try {
		return render(VolunteerAccessPortal, { props: { mode: 'entry' } }).body;
	} finally {
		langState.current = previous;
	}
}

describe('VolunteerAccessPortal sign-in screen', () => {
	it('shows English copy and no Thai text when the language is EN', () => {
		const body = renderPortal('en');
		expect(body).toContain('Sign in to your volunteer schedule');
		expect(body).toContain(
			'Enter your phone number, or scan a QR code / enter a token code, to sign in and manage your schedule'
		);
		expect(body).toContain('Sign in with phone number');
		expect(body).toContain('Scan ticket QR / token code');
		expect(body).toContain('Registered phone number');
		expect(body).toContain('placeholder="e.g. 081-234-5678"');
		expect(body).toContain('Sign in now');
		expect(body).not.toMatch(/[฀-๿]/);
	});

	it('keeps the Thai copy when the language is TH', () => {
		const body = renderPortal('th');
		expect(body).toContain('เข้าสู่ระบบตารางทำงานจิตอาสา');
		expect(body).toContain(
			'กรุณาระบุหมายเลขโทรศัพท์ หรือสแกน QR Code / กรอกรหัส Token เพื่อเข้าสู่ระบบและจัดการตารางงาน'
		);
		expect(body).toContain('เข้าสู่ระบบด้วยเบอร์โทรศัพท์');
		expect(body).toContain('สแกน QR ตั๋ว / รหัส Token');
		expect(body).toContain('หมายเลขโทรศัพท์ที่ลงทะเบียนไว้');
		expect(body).toContain('placeholder="เช่น 081-234-5678"');
		expect(body).toContain('เข้าสู่ระบบทันที');
		expect(body).toContain('กรอกเบอร์โทรศัพท์เดียวกันกับที่ลงทะเบียนไว้ในระบบฐานข้อมูลอาสาสมัคร');
	});
});
