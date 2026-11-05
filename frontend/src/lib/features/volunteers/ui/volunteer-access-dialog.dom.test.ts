// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { grantExpiryRange } from '$lib/auth/role-grants';
import { formatThaiShortDate } from '$lib/utils/date';
import type { Volunteer } from '../domain/volunteer.schema';
import { toast } from 'svelte-sonner';
import VolunteerAccessDialog from './volunteer-access-dialog.svelte';

const mocks = vi.hoisted(() => ({
	roles: [] as string[],
	grantLimited: vi.fn(),
	grantFull: vi.fn(),
	revoke: vi.fn(),
	grants: null as Record<string, unknown> | null,
	grantsError: false
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
	grantVolunteerAccess: mocks.grantFull,
	revokeVolunteerGrant: mocks.revoke
}));
vi.mock('../application/queries', () => ({
	volunteerKeys: { all: ['volunteers'] },
	useVolunteerGrants: () => ({
		get data() {
			return mocks.grants;
		},
		get isError() {
			return mocks.grantsError;
		}
	})
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

const expiryButton = () =>
	document.body.querySelector<HTMLButtonElement>('[id^="volunteer-access-expiry-"]');
/** The calendar cell for `iso` in the open expiry picker, if it is in the shown month. */
function dayCell(iso: string): HTMLElement | null {
	const cell = document.body.querySelector<HTMLElement>(
		`[data-calendar-cell][data-value="${iso}"]`
	);
	return cell && !cell.hasAttribute('data-outside-month') ? cell : null;
}

/** Open the expiry picker and show the month holding `iso` (moving forward a month at most). */
async function showMonthOf(iso: string) {
	expiryButton()!.click();
	await settle();
	if (!dayCell(iso)) {
		document.body.querySelector<HTMLButtonElement>('[data-calendar-next-button]')!.click();
		await settle();
	}
}

async function pickExpiry(iso: string) {
	await showMonthOf(iso);
	dayCell(iso)!.querySelector<HTMLElement>('[data-calendar-day]')!.click();
	await settle();
}

const saveButton = () =>
	[...document.body.querySelectorAll('button')].find((b) =>
		b.textContent?.includes('บันทึกและออกสิทธิ์ใหม่')
	)!;

const titleText = () =>
	document.body.querySelector('[data-slot="dialog-title"]')?.textContent?.trim();
const buttonText = (text: string) =>
	[...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(text));

async function fill(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
}

const roleRadios = () =>
	[...document.body.querySelectorAll<HTMLButtonElement>('[role="radio"]')].filter((r) =>
		r.id.startsWith('volunteer-access-role-')
	);

async function pickRole(role: string) {
	document.body
		.querySelector<HTMLButtonElement>(`#volunteer-access-role-volunteer\\:001-${role}`)!
		.click();
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
	mocks.revoke.mockResolvedValue(undefined);
	mocks.grants = null;
	mocks.grantsError = false;
});

afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	// bits-ui restores the body style 24ms after the dialog's scroll lock goes; let that timer run
	// here, or it fires after the file's DOM is torn down ("document is not defined").
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('VolunteerAccessDialog for a volunteer_coordinator (#955)', () => {
	it('has an expiry date picker, empty by default, limited to today through today + 7 days', async () => {
		await render(COORDINATOR);
		const { max } = grantExpiryRange();
		expect(expiryButton()!.textContent).toContain('เลือกวันหมดอายุ');

		await showMonthOf(max);
		expect(dayCell(max)!.hasAttribute('data-disabled')).toBe(false);
		const after = new Date(`${max}T00:00:00Z`);
		after.setUTCDate(after.getUTCDate() + 1);
		const afterIso = after.toISOString().slice(0, 10);
		// The day after the window is disabled when it is on the shown month.
		const outside = dayCell(afterIso);
		if (outside) expect(outside.hasAttribute('data-disabled')).toBe(true);
	});

	it('shows the chosen day in Thai on the picker', async () => {
		await render(COORDINATOR);
		const { max } = grantExpiryRange();
		await pickExpiry(max);
		expect(expiryButton()!.textContent).not.toContain('เลือกวันหมดอายุ');
		expect(expiryButton()!.textContent).not.toContain(max);
	});

	it('refuses to save without an expiry and says why', async () => {
		await render(COORDINATOR);
		await fillCredentials();
		await pickRole('registration_staff');
		saveButton().click();
		await settle();

		expect(mocks.grantLimited).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain('กรุณาเลือกวันหมดอายุ');
		expect(toast.error).toHaveBeenCalledWith('กรุณาเลือกวันหมดอายุ');
	});

	it('grants through the coordinator path once an expiry is chosen', async () => {
		await render(COORDINATOR);
		await fillCredentials();
		await pickRole('registration_staff');
		await pickExpiry(grantExpiryRange().max);
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
		mocks.grantLimited.mockRejectedValue(new Error('ไม่พบข้อมูลอาสาสมัครในศูนย์นี้'));
		await render(COORDINATOR);
		await fillCredentials();
		await pickRole('registration_staff');
		await pickExpiry(grantExpiryRange().min);
		saveButton().click();
		await settle();

		expect(document.body.textContent).toContain('ไม่พบข้อมูลอาสาสมัครในศูนย์นี้');
		expect(toast.error).toHaveBeenCalledWith('ไม่พบข้อมูลอาสาสมัครในศูนย์นี้');
	});

	// #1044: access follows the identity check in this shelter, whoever grants; a phone and
	// national ID matching another shelter no longer stand in for it.
	it.each([
		['a coordinator', COORDINATOR],
		['a shelter manager', MANAGER]
	])('blocks %s from granting an unverified volunteer, with the reason', async (_who, roles) => {
		await render(roles, {
			national_id_hash: 'nid-hash-1',
			identity_verified: false,
			identity_verification: { status: 'pending' }
		} as Partial<Volunteer>);

		expect(document.body.textContent).toContain('กรุณายืนยันตัวตนก่อนจึงจะออกสิทธิ์ได้');
		expect(saveButton().disabled).toBe(true);
	});
});

describe('VolunteerAccessDialog role radios (#1044, #1072)', () => {
	it('offers the ten coordinator roles as radios, none picked', async () => {
		await render(COORDINATOR);
		const radios = roleRadios();
		expect(radios).toHaveLength(10);
		expect(radios.some((r) => r.getAttribute('aria-checked') === 'true')).toBe(false);
		expect(radios.map((r) => r.id)).not.toContain(
			'volunteer-access-role-volunteer:001-kiosk_staff'
		);
	});

	it('starts on the current role when the account already holds a grant here', async () => {
		mocks.grants = {
			email: 'vol@example.com',
			grants: [
				{ role: 'kitchen_staff', expires_at: '2026-11-01T16:59:59.999Z', mine: true },
				{ role: 'warehouse_staff', expires_at: '2026-11-03T16:59:59.999Z', mine: false }
			]
		};
		await render(COORDINATOR, { user_name: 'vol@example.com' });
		const checked = roleRadios().filter((r) => r.getAttribute('aria-checked') === 'true');
		expect(checked.map((r) => r.id)).toEqual([
			'volunteer-access-role-volunteer:001-warehouse_staff'
		]);
	});

	it('has an info button per role, named after it, like the users page', async () => {
		await render(COORDINATOR);
		const infos = [...document.body.querySelectorAll('button')].filter((b) =>
			b.getAttribute('aria-label')?.startsWith('รายละเอียด')
		);
		expect(infos).toHaveLength(10);
		expect(infos.map((b) => b.getAttribute('aria-label'))).toContain('รายละเอียดเจ้าหน้าที่คลัง');
	});

	it('offers a manager every staff role', async () => {
		await render(MANAGER);
		expect(roleRadios()).toHaveLength(12);
	});

	it('refuses to save without a role with a toast and a note under the radios that clears once one is picked', async () => {
		await render(COORDINATOR);
		await fillCredentials();
		await pickExpiry(grantExpiryRange().max);
		saveButton().click();
		await settle();

		expect(mocks.grantLimited).not.toHaveBeenCalled();
		expect(
			document.getElementById('volunteer-access-role-error-volunteer:001')?.textContent
		).toContain('กรุณาเลือกตำแหน่งหน้าที่');
		expect(toast.error).toHaveBeenCalledWith('กรุณาเลือกตำแหน่งหน้าที่');

		await pickRole('warehouse_staff');
		expect(document.getElementById('volunteer-access-role-error-volunteer:001')).toBeNull();
	});
});

describe('VolunteerAccessDialog says where the account stands (#1044)', () => {
	const linked = { user_name: 'vol@example.com' } as Partial<Volunteer>;
	const view = (over: Record<string, unknown>) => ({
		email: 'vol@example.com',
		has_account: true,
		grants: [],
		permanent_roles: [],
		last_ended: null,
		...over
	});

	it('reads as an edit when the account holds a role here', async () => {
		mocks.grants = view({
			grants: [{ role: 'kitchen_staff', expires_at: '2026-11-03T16:59:59.999Z', mine: true }]
		});
		await render(COORDINATOR, linked);
		expect(titleText()).toBe('แก้ไขสิทธิ์');
		expect(document.body.textContent).toContain('มีสิทธิ์ในศูนย์นี้อยู่แล้ว');
		expect(buttonText('บันทึกการแก้ไข')).toBeDefined();
	});

	it('titles a new grant "ออกสิทธิ์ใช้งานระบบ" and keeps its save label', async () => {
		await render(COORDINATOR);
		expect(titleText()).toBe('ออกสิทธิ์ใช้งานระบบ');
		expect(buttonText('บันทึกและออกสิทธิ์ใหม่')).toBeDefined();
	});

	it('lets an unverified profile whose account holds a grant here be edited (FR-3)', async () => {
		mocks.grants = view({
			grants: [{ role: 'kitchen_staff', expires_at: '2026-11-03T16:59:59.999Z', mine: true }]
		});
		await render(COORDINATOR, {
			...linked,
			identity_verified: false,
			identity_verification: { status: 'pending' }
		} as Partial<Volunteer>);
		expect(document.body.textContent).not.toContain('ยังไม่ยืนยันตัวตนในศูนย์นี้');
		expect(buttonText('บันทึกการแก้ไข')!.disabled).toBe(false);
	});

	it('still blocks an unverified profile whose account lapsed here', async () => {
		mocks.grants = view({});
		await render(COORDINATOR, {
			...linked,
			identity_verified: false,
			identity_verification: { status: 'pending' }
		} as Partial<Volunteer>);
		expect(document.body.textContent).toContain('ยังไม่ยืนยันตัวตนในศูนย์นี้');
		expect(buttonText('ออกสิทธิ์อีกครั้ง')!.disabled).toBe(true);
	});

	it('says the last role expired, and offers to grant again', async () => {
		mocks.grants = view({
			last_ended: {
				role: 'kitchen_staff',
				reason: 'expired',
				at: '2026-10-31T17:00:00.000Z',
				by: 'worker'
			}
		});
		await render(COORDINATOR, linked);
		expect(titleText()).toBe('ออกสิทธิ์อีกครั้ง');
		expect(document.body.textContent).toContain('ยังไม่มีสิทธิ์ในศูนย์นี้');
		expect(document.body.textContent).toContain('หมดอายุเมื่อ');
		expect(buttonText('ออกสิทธิ์อีกครั้ง')).toBeDefined();
	});

	it('says who revoked the last role', async () => {
		mocks.grants = view({
			last_ended: {
				role: 'kitchen_staff',
				reason: 'revoked',
				at: '2026-10-31T17:00:00.000Z',
				by: 'coord01'
			}
		});
		await render(COORDINATOR, linked);
		expect(document.body.textContent).toContain('ถูกถอนเมื่อ');
		expect(document.body.textContent).toContain('โดย coord01');
	});

	it('says the system revoked it when the profile was closed, never "worker"', async () => {
		mocks.grants = view({
			last_ended: {
				role: 'warehouse_staff',
				reason: 'revoked',
				at: '2026-11-02T07:06:06.813Z',
				by: 'worker',
				cause: 'profile_inactive'
			}
		});
		await render(COORDINATOR, linked);
		expect(document.body.textContent).toContain('ถูกถอนเพราะปิดโปรไฟล์เมื่อ');
		expect(document.body.textContent).toContain('โดยระบบ');
		expect(document.body.textContent).not.toContain('worker');
	});

	it('shows the roles a manager gave, disabled with a note, and cannot be saved (FR-16)', async () => {
		mocks.grants = view({ permanent_roles: ['registration_staff'] });
		await render(COORDINATOR, linked);
		expect(document.body.textContent).toContain('สิทธิ์ถาวรจากผู้จัดการศูนย์');
		const radio = document.body.querySelector<HTMLButtonElement>(
			'#volunteer-access-role-volunteer\\:001-registration_staff'
		)!;
		expect(radio.hasAttribute('disabled') || radio.getAttribute('aria-disabled') === 'true').toBe(
			true
		);
		expect(document.body.textContent).toContain(
			'ผู้จัดการศูนย์เป็นผู้ให้ แก้ไขได้ที่หน้าผู้ใช้งาน'
		);
		expect(buttonText('บันทึกการแก้ไข')!.disabled).toBe(true);
	});

	it('blocks saving, with the reason, for a closed profile (FR-21)', async () => {
		await render(COORDINATOR, { status: 'inactive' } as Partial<Volunteer>);
		expect(document.body.textContent).toContain('เปิดใช้งานอาสาสมัครก่อนจึงจะออกสิทธิ์ได้');
		expect(saveButton().disabled).toBe(true);
	});
});

describe('VolunteerAccessDialog revoking a grant (#955 FR-8)', () => {
	const EXPIRES = '2026-10-31T16:59:59.999Z';
	const button = (text: string) =>
		[...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

	it('revokes only after the second click, for the linked account', async () => {
		mocks.grants = {
			email: 'vol@example.com',
			grants: [{ role: 'kitchen_staff', expires_at: EXPIRES, mine: true }]
		};
		await render(COORDINATOR);
		button('ถอนสิทธิ์')!.click();
		await settle();
		expect(mocks.revoke).not.toHaveBeenCalled();

		button('ยืนยันถอนสิทธิ์')!.click();
		await settle();
		expect(mocks.revoke).toHaveBeenCalledWith(expect.objectContaining({ _id: volunteer._id }), {
			email: 'vol@example.com',
			role: 'kitchen_staff'
		});
	});

	it("offers a revoke for another coordinator's grant too (FR-17)", async () => {
		mocks.grants = {
			email: 'vol@example.com',
			grants: [{ role: 'kitchen_staff', expires_at: EXPIRES, mine: false }]
		};
		await render(COORDINATOR);
		expect(button('ถอนสิทธิ์')).toBeDefined();

		button('ถอนสิทธิ์')!.click();
		await settle();
		button('ยืนยันถอนสิทธิ์')!.click();
		await settle();
		expect(mocks.revoke).toHaveBeenCalledWith(expect.objectContaining({ _id: volunteer._id }), {
			email: 'vol@example.com',
			role: 'kitchen_staff'
		});
	});

	it('shows the server refusal inline', async () => {
		mocks.grants = {
			email: 'vol@example.com',
			grants: [{ role: 'kitchen_staff', expires_at: EXPIRES, mine: true }]
		};
		mocks.revoke.mockRejectedValue(new Error('ไม่พบสิทธิ์ที่ผู้ประสานงานถอนได้ในศูนย์นี้'));
		await render(COORDINATOR);
		button('ถอนสิทธิ์')!.click();
		await settle();
		button('ยืนยันถอนสิทธิ์')!.click();
		await settle();

		expect(document.body.textContent).toContain('ไม่พบสิทธิ์ที่ผู้ประสานงานถอนได้ในศูนย์นี้');
		expect(toast.error).toHaveBeenCalledWith('ไม่พบสิทธิ์ที่ผู้ประสานงานถอนได้ในศูนย์นี้');
	});
});

describe('VolunteerAccessDialog for a shelter manager', () => {
	it('keeps the full form: no expiry field', async () => {
		await render(MANAGER);

		expect(expiryButton()).toBeNull();
	});
});

describe('VolunteerAccessDialog password for an existing account', () => {
	const passwordInput = () =>
		document.body.querySelector<HTMLInputElement>('input[id^="volunteer-access-password-"]');

	it.each([
		['coordinator', COORDINATOR],
		['shelter manager', MANAGER]
	])(
		'hides the password when the profile is linked (%s): the account keeps its own',
		async (_who, roles) => {
			// A coordinator learns the account exists from the grants view (FR-10); SM / SA from
			// the profile's own link.
			mocks.grants = {
				email: 'vol@example.com',
				has_account: true,
				grants: [],
				permanent_roles: [],
				last_ended: null
			};
			await render(roles, { user_name: 'vol@example.com' });

			expect(passwordInput()).toBeNull();
			expect(document.body.textContent).toContain('การออกสิทธิ์ไม่เปลี่ยนรหัสผ่านเดิม');
		}
	);

	it('asks for a password for a new account', async () => {
		await render(COORDINATOR);

		expect(passwordInput()?.value).toBe('0812345678');
		expect(document.body.textContent).not.toContain('การออกสิทธิ์ไม่เปลี่ยนรหัสผ่านเดิม');
	});

	it('toasts a password that breaks the policy and does not save', async () => {
		await render(COORDINATOR);
		await fillCredentials();
		const input = passwordInput()!;
		input.value = 'abc';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		await pickRole('kitchen_staff');
		await pickExpiry(grantExpiryRange().max);
		saveButton().click();
		await settle();

		expect(mocks.grantLimited).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('รหัสผ่าน'));
	});

	it.each([
		['the mobile', '0812345678'],
		['the mobile with a trailing space', '0812345678 ']
	])('shows no rule checklist for %s, which the policy accepts as a default', async (_l, value) => {
		await render(COORDINATOR);
		const input = passwordInput()!;
		input.value = value;
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		expect(document.body.querySelector('[aria-label="เงื่อนไขรหัสผ่าน"]')).toBeNull();
	});

	it('shows the rule checklist for any other password', async () => {
		await render(COORDINATOR);
		const input = passwordInput()!;
		input.value = 'abc';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		expect(document.body.querySelector('[aria-label="เงื่อนไขรหัสผ่าน"]')).not.toBeNull();
	});

	it('still asks when a linked profile has no mobile to fall back on', async () => {
		await render(COORDINATOR, { user_name: 'vol@example.com', phone: null });

		expect(passwordInput()).not.toBeNull();
	});
});

describe('VolunteerAccessDialog username and old expiry (CR-221 FR-10, FR-13)', () => {
	const linked = { user_name: 'vol@example.com' } as Partial<Volunteer>;
	const GRANT = {
		role: 'kitchen_staff',
		expires_at: '2026-11-03T16:59:59.999Z',
		granted_by: 'coord01',
		mine: false
	};
	const view = (over: Record<string, unknown>) => ({
		email: 'vol@example.com',
		has_account: true,
		grants: [],
		permanent_roles: [],
		last_ended: null,
		...over
	});
	const EXISTS_NOTE = 'บัญชีนี้มีอยู่แล้ว การออกสิทธิ์ไม่เปลี่ยนรหัสผ่านเดิม';
	const emailInput = () => document.body.querySelector('input[type="email"]');
	const passwordInput = () => document.body.querySelector('[id^="volunteer-access-password-"]');
	const existingUsername = () =>
		document.body.querySelector('[data-testid="existing-username"]')?.textContent?.trim();
	const previousExpiry = () =>
		document.body.querySelector('[data-testid="previous-expiry"]')?.textContent;

	it.each([
		['active', view({ grants: [GRANT] })],
		['lapsed', view({})]
	])(
		'shows the username read-only, with the note and no password, when the account is %s',
		async (_standing, grants) => {
			mocks.grants = grants;
			await render(COORDINATOR, linked);
			expect(existingUsername()).toBe('vol@example.com');
			expect(emailInput()).toBeNull();
			expect(passwordInput()).toBeNull();
			expect(document.body.textContent).toContain(EXISTS_NOTE);
		}
	);

	describe.each([
		['is still loading', false],
		['failed', true]
	])('while the coordinator grants view %s', (_state, failed) => {
		beforeEach(() => {
			mocks.grants = null;
			mocks.grantsError = failed;
		});

		it('falls back to the profile link: read-only username, no email or password input', async () => {
			await render(COORDINATOR, linked);
			expect(existingUsername()).toBe('vol@example.com');
			expect(emailInput()).toBeNull();
			expect(passwordInput()).toBeNull();
			expect(document.body.textContent).toContain(EXISTS_NOTE);
		});

		it('labels the read-only username', async () => {
			await render(COORDINATOR, linked);
			const username = document.body.querySelector('[data-testid="existing-username"]')!;
			const label = document.getElementById(username.getAttribute('aria-labelledby')!);
			expect(label?.textContent).toContain('Username เข้าสู่ระบบ');
		});

		it('saves as an existing account: no password sent or asked for', async () => {
			await render(COORDINATOR, linked);
			await pickRole('kitchen_staff');
			await pickExpiry(grantExpiryRange().max);
			saveButton().click();
			await settle();
			expect(mocks.grantLimited).toHaveBeenCalledWith(
				expect.objectContaining({ _id: volunteer._id }),
				expect.objectContaining({ email: 'vol@example.com', password: '', account_exists: true })
			);
		});

		it('still shows the inputs for a profile with no linked account', async () => {
			await render(COORDINATOR);
			expect(emailInput()).not.toBeNull();
			expect(passwordInput()).not.toBeNull();
		});
	});

	it('keeps the email and password inputs when there is no account', async () => {
		await render(COORDINATOR);
		expect(existingUsername()).toBeUndefined();
		expect(emailInput()).not.toBeNull();
		expect(passwordInput()).not.toBeNull();
		expect(document.body.textContent).not.toContain(EXISTS_NOTE);
	});

	it('keeps the inputs when the profile names an account that is gone', async () => {
		mocks.grants = view({ has_account: false });
		await render(COORDINATOR, linked);
		expect(emailInput()).not.toBeNull();
		expect(passwordInput()).not.toBeNull();
	});

	it('edits an existing account without a password and passes its username', async () => {
		mocks.grants = view({ grants: [GRANT] });
		await render(COORDINATOR, linked);
		await pickExpiry(grantExpiryRange().max);
		buttonText('บันทึกการแก้ไข')!.click();
		await settle();

		expect(mocks.grantLimited).toHaveBeenCalledWith(
			expect.objectContaining({ _id: volunteer._id }),
			expect.objectContaining({
				email: 'vol@example.com',
				role: 'kitchen_staff',
				expires_on: grantExpiryRange().max,
				account_exists: true
			})
		);
	});

	it('shows a shelter manager the linked username read-only too, and still grants with it', async () => {
		mocks.grantFull.mockResolvedValue({ created: false });
		await render(MANAGER, linked);
		expect(existingUsername()).toBe('vol@example.com');
		expect(emailInput()).toBeNull();
		expect(passwordInput()).toBeNull();
		await pickRole('warehouse_staff');
		saveButton().click();
		await settle();
		expect(mocks.grantFull).toHaveBeenCalledWith(
			expect.objectContaining({ _id: volunteer._id }),
			expect.objectContaining({ email: 'vol@example.com', role: 'warehouse_staff' })
		);
	});

	it('shows the old expiry and the issuer for an active account, with the picker still empty and required', async () => {
		mocks.grants = view({ grants: [GRANT] });
		await render(COORDINATOR, linked);
		expect(previousExpiry()).toContain('เดิม: หมดอายุสิ้นวันที่');
		expect(previousExpiry()).toContain(formatThaiShortDate(GRANT.expires_at));
		expect(previousExpiry()).toContain('ออกโดย coord01');
		expect(expiryButton()!.textContent).toContain('เลือกวันหมดอายุ');

		buttonText('บันทึกการแก้ไข')!.click();
		await settle();
		expect(mocks.grantLimited).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith('กรุณาเลือกวันหมดอายุ');
	});

	it('shows the latest grant when the account holds several', async () => {
		mocks.grants = view({
			grants: [
				{ ...GRANT, role: 'facility_staff', expires_at: '2026-11-01T16:59:59.999Z' },
				{ ...GRANT, granted_by: 'coord02' }
			]
		});
		await render(COORDINATOR, linked);
		expect(previousExpiry()).toContain(formatThaiShortDate(GRANT.expires_at));
		expect(previousExpiry()).toContain('ออกโดย coord02');
	});

	it('shows no old expiry for a lapsed account or a new grant', async () => {
		mocks.grants = view({});
		await render(COORDINATOR, linked);
		expect(previousExpiry()).toBeUndefined();
	});
});
