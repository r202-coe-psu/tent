import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import EntryPage from './+page.svelte';
import DashboardPage from './volunteer/[portalId]/dashboard/+page.svelte';
import OpeningsPage from './volunteer/[portalId]/openings/+page.svelte';

const idleQuery = { data: undefined, isPending: false, isError: false, error: null };
const idleMutation = { mutateAsync: vi.fn(), isPending: false };

vi.mock('$lib/features/volunteer-portal/application/queries', () => ({
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

const params = { portalId: 'p1' };

function headOf(page: typeof EntryPage | typeof DashboardPage, language: 'th' | 'en') {
	const previous = langState.current;
	langState.current = language;
	try {
		return render(page as typeof DashboardPage, {
			props: { params, data: {}, form: undefined } as never
		}).head;
	} finally {
		langState.current = previous;
	}
}

describe('volunteer portal page titles', () => {
	it('titles each portal page in English when the language is EN', () => {
		expect(headOf(EntryPage, 'en')).toContain('<title>Volunteer sign-in — Smart Shelter</title>');
		expect(headOf(DashboardPage, 'en')).toContain(
			'<title>Volunteer schedule — Smart Shelter</title>'
		);
		expect(headOf(OpeningsPage as typeof DashboardPage, 'en')).toContain(
			'<title>Open volunteer jobs — Smart Shelter</title>'
		);
	});

	it('keeps the Thai titles when the language is TH', () => {
		expect(headOf(EntryPage, 'th')).toContain(
			'<title>เข้าสู่ระบบอาสาสมัคร — Smart Shelter</title>'
		);
		expect(headOf(DashboardPage, 'th')).toContain('<title>ตารางงานจิตอาสา — Smart Shelter</title>');
		expect(headOf(OpeningsPage as typeof DashboardPage, 'th')).toContain(
			'<title>งานอาสาที่เปิดรับ — Smart Shelter</title>'
		);
	});
});
