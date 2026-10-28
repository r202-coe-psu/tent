// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { grantExpiryRange } from '$lib/auth/role-grants';
import type { Volunteer } from '../domain/volunteer.schema';
import VolunteerAccessDialog from './volunteer-access-dialog.svelte';

const mocks = vi.hoisted(() => ({
	roles: [] as string[],
	grantLimited: vi.fn(),
	grantFull: vi.fn()
}));

vi.mock('@tanstack/svelte-query', () => ({
	useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() })
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return { name: 'u', roles: mocks.roles };
		}
	}
}));
vi.mock('../application/volunteer-access', async (importOriginal) => ({
	...(await importOriginal<typeof import('../application/volunteer-access')>()),
	grantVolunteerAccessAsCoordinator: mocks.grantLimited,
	grantVolunteerAccess: mocks.grantFull
}));

const volunteer = {
	_id: 'volunteer:001',
	shelter_code: 'SH001',
	volunteer_code: 'V-001',
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	phone: '0812345678',
	email: null,
	user_name: null,
	identity_verified: true,
	identity_verification: { status: 'verified' }
} as unknown as Volunteer;

const COORDINATOR = ['shelter:SH001', 'SH001:volunteer_coordinator'];
const MANAGER = ['shelter:SH001', 'SH001:shelter_manager'];

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	await vi.waitFor(() => flushSync());
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}

async function render(roles: string[], profile: Partial<Volunteer> = {}) {
	mocks.roles = roles;
	instance = mount(VolunteerAccessDialog, {
		target: document.body,
		props: { open: true, volunteer: { ...volunteer, ...profile }, shelterLine: 'SH001' }
	});
	await settle();
}

const expiryInput = () => document.body.querySelector<HTMLInputElement>('input[type="date"]');
const saveButton = () =>
	[...document.body.querySelectorAll('button')].find((b) =>
		b.textContent?.includes('บันทึกและออกสิทธิ์ใหม่')
	)!;

async function fill(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
}

async function fillCredentials() {
	await fill(
		document.body.querySelector<HTMLInputElement>('input[type="email"]')!,
		'a@example.com'
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.grantLimited.mockResolvedValue({ created: true, unchanged: false });
});

afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('VolunteerAccessDialog for a volunteer_coordinator (#955)', () => {
	it('has a required expiry field limited to today through today + 7 days, empty by default', async () => {
		await render(COORDINATOR);
		const input = expiryInput()!;
		const { min, max } = grantExpiryRange();

		expect(input.required).toBe(true);
		expect(input.value).toBe('');
		expect(input.min).toBe(min);
		expect(input.max).toBe(max);
	});

	it('refuses to save without an expiry and says why', async () => {
		await render(COORDINATOR);
		await fillCredentials();
		saveButton().click();
		await settle();

		expect(mocks.grantLimited).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain('กรุณาเลือกวันหมดอายุ');
	});

	it('grants through the coordinator path once an expiry is chosen', async () => {
		await render(COORDINATOR);
		await fillCredentials();
		await fill(expiryInput()!, grantExpiryRange().max);
		saveButton().click();
		await settle();

		expect(mocks.grantLimited).toHaveBeenCalledWith(
			expect.objectContaining({ _id: volunteer._id }),
			expect.objectContaining({
				email: 'a@example.com',
				role: 'registration_staff',
				expires_on: grantExpiryRange().max
			})
		);
		expect(mocks.grantFull).not.toHaveBeenCalled();
	});

	it('shows the server refusal inline', async () => {
		mocks.grantLimited.mockRejectedValue(
			new Error('อาสาสมัครต้องยืนยันตัวตนก่อนจึงจะออกสิทธิ์ได้')
		);
		await render(COORDINATOR, {
			national_id_hash: 'nid-hash-1',
			identity_verified: false,
			identity_verification: { status: 'pending' }
		} as Partial<Volunteer>);
		await fillCredentials();
		await fill(expiryInput()!, grantExpiryRange().min);
		saveButton().click();
		await settle();

		expect(document.body.textContent).toContain('อาสาสมัครต้องยืนยันตัวตนก่อนจึงจะออกสิทธิ์ได้');
	});

	it('blocks an unverified volunteer with no phone, with the reason', async () => {
		await render(COORDINATOR, {
			phone: null,
			identity_verified: false,
			identity_verification: { status: 'pending' }
		} as Partial<Volunteer>);

		expect(document.body.textContent).toContain('ออกสิทธิ์ไม่ได้');
		expect(saveButton().disabled).toBe(true);
	});

	it('blocks an unverified volunteer who has a phone but no national ID (the other shelter match needs both)', async () => {
		await render(COORDINATOR, {
			identity_verified: false,
			identity_verification: { status: 'pending' }
		} as Partial<Volunteer>);

		expect(document.body.textContent).toContain('ออกสิทธิ์ไม่ได้');
		expect(saveButton().disabled).toBe(true);
	});

	it('warns, but does not block, an unverified volunteer with a phone and national ID (other shelters are checked server-side)', async () => {
		await render(COORDINATOR, {
			national_id_hash: 'nid-hash-1',
			identity_verified: false,
			identity_verification: { status: 'pending' }
		} as Partial<Volunteer>);

		expect(document.body.textContent).toContain('ตรวจผลยืนยันจากศูนย์อื่น');
		expect(saveButton().disabled).toBe(false);
	});
});

describe('VolunteerAccessDialog for a shelter manager', () => {
	it('keeps the full form: no expiry field', async () => {
		await render(MANAGER);

		expect(expiryInput()).toBeNull();
	});
});
