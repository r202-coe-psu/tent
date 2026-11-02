// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { Volunteer } from '../domain/volunteer.schema';
import type { VolunteerAccount } from '../domain/volunteer-access-status';
import VolunteerAccountsPage from './volunteer-accounts-page.svelte';

const mocks = vi.hoisted(() => ({
	roles: [] as string[],
	reactivate: vi.fn(),
	accounts: { data: undefined, isPending: false, error: null } as {
		data: unknown;
		isPending: boolean;
		error: unknown;
	},
	volunteers: { data: undefined, isPending: false, error: null } as {
		data: unknown;
		isPending: boolean;
		error: unknown;
	}
}));

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return { name: 'u', roles: mocks.roles };
		}
	}
}));
vi.mock('$lib/stores/shelter.svelte', () => ({ shelterStore: { selectedShelterCode: 'SH001' } }));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
vi.mock('$lib/features/shelters', () => ({
	useShelter: () => ({ data: { name: 'ศูนย์ทดสอบ', shelter_type: 'โรงเรียน' } })
}));
vi.mock('../application/queries', () => ({
	useShelterVolunteerAccounts: () => mocks.accounts,
	useVolunteers: () => mocks.volunteers,
	useReactivateVolunteer: () => ({ mutate: mocks.reactivate })
}));
vi.mock('@tanstack/svelte-query', () => ({ useQueryClient: () => ({}) }));
// The dialogs have their own tests; here only which button each row offers matters.
vi.mock('./volunteer-access-dialog.svelte', () => ({ default: function Stub() {} }));
vi.mock('./volunteer-qualification-dialog.svelte', () => ({ default: function Stub() {} }));

const COORDINATOR = ['shelter:SH001', 'SH001:volunteer_coordinator'];

const profile = (id: string, first: string, last: string, over: Partial<Volunteer> = {}) =>
	({
		_id: id,
		shelter_code: 'SH001',
		first_name: first,
		last_name: last,
		status: 'active',
		identity_verified: true,
		identity_verification: { status: 'verified' },
		...over
	}) as unknown as Volunteer;

const inHours = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();

const account = (over: Partial<VolunteerAccount>): VolunteerAccount => ({
	volunteer_id: 'volunteer:V1',
	name: 'somchai@example.com',
	active: true,
	grants: [],
	permanent_roles: [],
	...over
});

const volunteers = [
	profile('volunteer:V1', 'สมชาย', 'ใจดี'),
	profile('volunteer:V2', 'กนกวรรณ', 'แสนสุข'),
	profile('volunteer:V3', 'ปิยะ', 'มั่นคง'),
	profile('volunteer:V4', 'วิชัย', 'เก่งกล้า', { status: 'inactive' }),
	profile('volunteer:V5', 'อารีย์', 'ใจงาม')
];

const accounts: VolunteerAccount[] = [
	account({
		grants: [{ role: 'kitchen_staff', expires_at: inHours(72), granted_by: 'coord@example.com' }]
	}),
	account({
		volunteer_id: 'volunteer:V2',
		name: 'kanok@example.com',
		grants: [{ role: 'facility_staff', expires_at: inHours(5), granted_by: 'coord2@example.com' }]
	}),
	account({
		volunteer_id: 'volunteer:V3',
		name: 'piya@example.com',
		permanent_roles: ['registration_staff']
	}),
	account({ volunteer_id: 'volunteer:V4', name: 'wichai@example.com' }),
	account({ volunteer_id: 'volunteer:V5', name: 'aree@example.com', active: false })
];

let instance: ReturnType<typeof mount> | null = null;

async function render() {
	mocks.roles = COORDINATOR;
	instance = mount(VolunteerAccountsPage, { target: document.body });
	await tick();
	flushSync();
}

const rowOf = (name: string) =>
	[...document.body.querySelectorAll('[data-testid="account-row"]')].find((r) =>
		r.textContent?.includes(name)
	) as HTMLElement;
const rowNames = () =>
	[...document.body.querySelectorAll('[data-testid="account-row"]')].map(
		(r) => r.querySelector('td')?.querySelector('p')?.textContent?.trim() ?? ''
	);
const chip = (label: string) =>
	[...document.body.querySelectorAll('button[aria-pressed]')].find((b) =>
		b.textContent?.includes(label)
	) as HTMLButtonElement;

async function type(value: string) {
	const input = document.body.querySelector('input[type="search"]') as HTMLInputElement;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
	flushSync();
}
async function pick(label: string) {
	chip(label).click();
	await tick();
	flushSync();
}

beforeEach(() => {
	mocks.accounts = { data: accounts, isPending: false, error: null };
	mocks.volunteers = { data: volunteers, isPending: false, error: null };
});
afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('VolunteerAccountsPage (CR-221 FR-8)', () => {
	it('lists every account by the profile name, lapsed and disabled ones included', async () => {
		await render();
		expect(rowNames()).toEqual(
			['กนกวรรณ แสนสุข', 'ปิยะ มั่นคง', 'วิชัย เก่งกล้า', 'สมชาย ใจดี', 'อารีย์ ใจงาม'].sort(
				(a, b) => a.localeCompare(b, 'th')
			)
		);
		expect(rowOf('สมชาย ใจดี').textContent).toContain('somchai@example.com');
		expect(rowOf('วิชัย เก่งกล้า').textContent).toContain('สิทธิ์ในศูนย์นี้สิ้นสุดแล้ว');
		expect(rowOf('วิชัย เก่งกล้า').textContent).toContain('โปรไฟล์ถูกปิด');
		expect(rowOf('อารีย์ ใจงาม').textContent).toContain('บัญชีถูกปิดใช้งาน');
	});

	it('reopens a closed profile from its row', async () => {
		await render();
		const buttons = [...rowOf('วิชัย เก่งกล้า').querySelectorAll('button')].filter((b) =>
			b.textContent?.includes('เปิดใช้งานอีกครั้ง')
		);
		expect(buttons).toHaveLength(1);
		buttons[0].click();
		expect(mocks.reactivate).toHaveBeenCalledTimes(1);
		const [id] = mocks.reactivate.mock.calls[0];
		expect(id).toBe(
			(mocks.volunteers.data as { _id: string; first_name: string }[]).find(
				(v) => v.first_name === 'วิชัย'
			)?._id
		);
		expect(rowOf('สมชาย ใจดี').textContent).not.toContain('เปิดใช้งานอีกครั้ง');
	});

	it('shows a coordinator grant with its end date and issuer', async () => {
		await render();
		const text = rowOf('สมชาย ใจดี').textContent ?? '';
		expect(text).toContain('เจ้าหน้าที่ครัว');
		expect(text).toContain('coord@example.com');
		expect(text).not.toContain('ถาวร');
		expect(text).not.toContain('ผู้จัดการศูนย์');
	});

	it('shows a manager role as permanent, issued by the shelter manager', async () => {
		await render();
		const text = rowOf('ปิยะ มั่นคง').textContent ?? '';
		expect(text).toContain('เจ้าหน้าที่ลงทะเบียน');
		expect(text).toContain('ถาวร');
		expect(text).toContain('ผู้จัดการศูนย์');
	});

	it('marks a grant ending within a day, and only that one', async () => {
		await render();
		expect(rowOf('กนกวรรณ แสนสุข').textContent).toContain('ใกล้หมดอายุ');
		expect(rowOf('สมชาย ใจดี').textContent).not.toContain('ใกล้หมดอายุ');
		expect(rowOf('ปิยะ มั่นคง').textContent).not.toContain('ใกล้หมดอายุ');
	});

	it('gives each row the access button of its status, as the people tab does (FR-9)', async () => {
		await render();
		expect(rowOf('สมชาย ใจดี').textContent).toContain('แก้ไขสิทธิ์ใช้งาน');
		// A closed profile gets no grant button, only the note where to reopen it.
		expect(rowOf('วิชัย เก่งกล้า').textContent).not.toContain('ออกสิทธิ์อีกครั้ง');
		expect(rowOf('วิชัย เก่งกล้า').textContent).toContain('เปิดใช้งานอีกครั้ง');
		expect(rowOf('อารีย์ ใจงาม').textContent).toContain('บัญชีถูกระงับโดยผู้ดูแลระบบ');
	});

	it('offers to give access again on a lapsed account with an open profile', async () => {
		mocks.accounts = {
			data: [account({ volunteer_id: 'volunteer:V2', name: 'kanok@example.com' })],
			isPending: false,
			error: null
		};
		await render();
		expect(rowOf('กนกวรรณ แสนสุข').textContent).toContain('ออกสิทธิ์อีกครั้ง');
	});

	it('searches the name and the email', async () => {
		await render();
		await type('kanok');
		expect(rowNames()).toEqual(['กนกวรรณ แสนสุข']);
		await type('ใจดี');
		expect(rowNames()).toEqual(['สมชาย ใจดี']);
		await type('nobody');
		expect(rowNames()).toEqual([]);
		expect(document.body.textContent).toContain('ไม่มีบัญชีที่ตรงกับคำค้นหาหรือตัวกรองที่เลือก');
	});

	it.each([
		['มีสิทธิ์อยู่', ['กนกวรรณ แสนสุข', 'ปิยะ มั่นคง', 'สมชาย ใจดี']],
		['สิ้นสุดแล้ว', ['วิชัย เก่งกล้า']],
		['โปรไฟล์ถูกปิด', ['วิชัย เก่งกล้า']],
		['ใกล้หมดอายุ', ['กนกวรรณ แสนสุข']]
	])('filters by %s', async (label, expected) => {
		await render();
		await pick(label);
		expect(chip(label).getAttribute('aria-pressed')).toBe('true');
		expect(rowNames()).toEqual(expected.sort((a, b) => a.localeCompare(b, 'th')));
	});

	it('shows how many accounts each filter holds', async () => {
		await render();
		const count = (key: string) =>
			document.body.querySelector(`[data-testid="filter-count-${key}"]`)?.textContent?.trim();
		expect(['all', 'active', 'lapsed', 'profile_closed', 'expiring'].map(count)).toEqual([
			'5',
			'3',
			'1',
			'1',
			'1'
		]);
	});

	it('shows a skeleton while loading, and an error when it fails', async () => {
		mocks.accounts = { data: undefined, isPending: true, error: null };
		await render();
		expect(document.body.querySelector('[data-testid="accounts-loading"]')).not.toBeNull();
		await unmount(instance!);
		instance = null;
		document.body.innerHTML = '';

		mocks.accounts = { data: undefined, isPending: false, error: new Error('403') };
		await render();
		expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('403');
	});

	it('says so when the shelter has no volunteer account yet', async () => {
		mocks.accounts = { data: [], isPending: false, error: null };
		await render();
		expect(document.body.textContent).toContain('ยังไม่มีบัญชีจิตอาสาในศูนย์นี้');
	});
});
