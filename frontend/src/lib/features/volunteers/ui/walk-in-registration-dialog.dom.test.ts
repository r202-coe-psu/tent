// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { Evacuee } from '$lib/features/people';
import { toast } from 'svelte-sonner';
import WalkInRegistrationDialog from './walk-in-registration-dialog.svelte';
import Harness from './walk-in-registration-dialog-harness.test-fixture.svelte';
import { VolunteerPhoneTakenError } from '../domain/phone-errors';

const MANAGER = ['shelter:SH001', 'SH001:shelter_manager'];
const REGISTRATION = ['shelter:SH001', 'SH001:registration_staff'];
const COORDINATOR = ['shelter:SH001', 'SH001:volunteer_coordinator'];

const mocks = vi.hoisted(() => ({
	roles: [] as string[],
	evacuees: [] as unknown[],
	searchTerms: [] as string[],
	/** Every read of the search query's `enabled()` — a hook that never runs records nothing. */
	enabledReads: [] as boolean[],
	/** The live `query()` / `enabled()` closures the component handed to the hook. */
	gate: null as { query: () => string; enabled: () => boolean } | null,
	hookCalls: 0,
	searchError: false,
	createMutateAsync: vi.fn()
}));

// happy-dom's <form> reports no method, which trips kit's dev-only `enhance` guard. Keep the
// real contract that matters to Superforms: on submit, hand it the submit input; in SPA mode it
// validates and runs `onUpdate` itself (cancelling the network round trip).
vi.mock('$app/forms', async (importOriginal) => ({
	...(await importOriginal<typeof import('$app/forms')>()),
	applyAction: vi.fn(),
	enhance: (
		form: HTMLFormElement,
		submit: (input: Record<string, unknown>) => unknown = () => {}
	) => {
		const onSubmit = (event: Event) => {
			event.preventDefault();
			void submit({
				action: new URL('http://localhost/'),
				formData: new FormData(form),
				formElement: form,
				controller: new AbortController(),
				submitter: null,
				cancel: () => {}
			});
		};
		form.addEventListener('submit', onSubmit);
		return { destroy: () => form.removeEventListener('submit', onSubmit) };
	}
}));
vi.mock('@tanstack/svelte-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return { name: 'u', roles: mocks.roles };
		}
	}
}));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
vi.mock('$lib/stores/shelter.svelte', () => ({ shelterStore: { selectedShelterCode: 'SH001' } }));
vi.mock('$lib/features/shelters', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/shelters')>()),
	useShelter: () => ({ data: { name: 'ศูนย์ทดสอบ' } })
}));
vi.mock('$lib/features/people', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/people')>()),
	useSearchEvacuees: (query: () => string, enabled: () => boolean) => {
		mocks.hookCalls++;
		mocks.gate = { query, enabled };
		return {
			get data() {
				mocks.searchTerms.push(query());
				const on = enabled();
				mocks.enabledReads.push(on);
				return on && !mocks.searchError ? mocks.evacuees : undefined;
			},
			get isError() {
				return enabled() && mocks.searchError;
			},
			isFetching: false
		};
	}
}));
vi.mock('../application/queries', () => ({
	useCreateWalkInVolunteer: () => ({ mutateAsync: mocks.createMutateAsync, isPending: false }),
	useAssignVolunteers: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useCheckIn: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useSkillOptions: () => ({ options: [] }),
	useJobs: () => ({ data: [] }),
	useShiftAssignments: () => ({ data: [] }),
	todayDateString: () => '2026-11-02'
}));

const somchai = {
	_id: 'evacuee:001',
	type: 'evacuee',
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	nickname: 'ชาย',
	phone: '081-234-5678',
	person_id: { cardType: 'national_id', number: '1234567890123' },
	current_stay: { status: 'active', zone: null, since: '2026-11-01T00:00:00Z' }
} as unknown as Evacuee;

const noExtras = {
	_id: 'evacuee:002',
	type: 'evacuee',
	first_name: 'สมหญิง',
	last_name: 'รักดี',
	phone: null,
	current_stay: { status: 'active', zone: null, since: '2026-11-01T00:00:00Z' }
} as unknown as Evacuee;

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	await vi.waitFor(() => flushSync());
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}

async function render() {
	instance = mount(WalkInRegistrationDialog, { target: document.body, props: { open: true } });
	await settle();
}

const searchBox = () =>
	document.body.querySelector('#walk-in-evacuee-search') as HTMLInputElement | null;
const clearButton = () =>
	[...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.includes('ล้างคำค้น')
	) ?? null;
const errorMessage = () => document.body.querySelector('[data-testid="walk-in-evacuee-error"]');
const field = (name: string) =>
	document.body.querySelector(`input[name="${name}"]`) as HTMLInputElement;
const hits = () => [
	...document.body.querySelectorAll<HTMLButtonElement>('[data-testid="walk-in-evacuee-hit"]')
];
/** The footer button calls `form.submit()` (requestSubmit); dispatch the same submit event. */
const submitForm = () =>
	document.body
		.querySelector('form')!
		.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

async function typeInto(input: HTMLInputElement, text: string) {
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
}

async function search(text: string) {
	await typeInto(searchBox()!, text);
	await vi.waitFor(() => expect(hits().length).toBeGreaterThan(0), { timeout: 2000 });
}

beforeEach(() => {
	mocks.evacuees = [somchai, noExtras];
	mocks.roles = MANAGER;
	mocks.searchTerms = [];
	mocks.enabledReads = [];
	mocks.hookCalls = 0;
	mocks.gate = null;
	mocks.searchError = false;
	vi.mocked(toast.error).mockClear();
	mocks.createMutateAsync.mockReset();
	mocks.createMutateAsync.mockResolvedValue({ _id: 'volunteer:9', volunteer_code: 'V-009' });
});

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	// bits-ui restores the body style 24ms after the dialog's scroll lock goes; let that timer run
	// here, or it fires after the file's DOM is torn down ("document is not defined").
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('WalkInRegistrationDialog — search shelter evacuees (#1062)', () => {
	it('shows the optional search box above the form fields', async () => {
		await render();
		expect(searchBox()).not.toBeNull();
		expect(document.body.textContent).toContain('ค้นหาคนในศูนย์');
		expect(field('first_name')).toBeTruthy();
	});

	it('shows the national ID masked in results, never in full', async () => {
		await render();
		await search('สม');
		const text = hits()[0].textContent ?? '';
		expect(text).toContain('สมชาย ใจดี');
		expect(text).toContain('123***123');
		expect(text).not.toContain('1234567890123');
		expect(mocks.searchTerms).toContain('สม');
	});

	it('fills first_name, last_name, nickname, phone and national_id on pick, and they stay editable', async () => {
		await render();
		await search('สม');
		hits()[0].click();
		await settle();

		expect(field('first_name').value).toBe('สมชาย');
		expect(field('last_name').value).toBe('ใจดี');
		expect(field('nickname').value).toBe('ชาย');
		expect(field('phone').value).toBe('0812345678');
		expect(field('national_id').value).toBe('1234567890123');
		expect(document.body.textContent).toContain('แก้ไขได้ก่อนบันทึก');

		await typeInto(field('first_name'), 'สมศักดิ์');
		expect(field('first_name').value).toBe('สมศักดิ์');
		expect(field('first_name').disabled).toBe(false);
		expect(field('first_name').readOnly).toBe(false);

		submitForm();
		await vi.waitFor(() => expect(mocks.createMutateAsync).toHaveBeenCalledTimes(1));
		expect(mocks.createMutateAsync.mock.calls[0][0]).toMatchObject({
			first_name: 'สมศักดิ์',
			last_name: 'ใจดี',
			nickname: 'ชาย',
			phone: '0812345678',
			national_id: '1234567890123',
			source: 'walk_in'
		});
		// UI-only fill: nothing links the volunteer back to the evacuee.
		expect(JSON.stringify(mocks.createMutateAsync.mock.calls[0][0])).not.toContain('evacuee:001');
	});

	it('keeps typed values for fields the picked evacuee does not have', async () => {
		await render();
		await typeInto(field('phone'), '0899999999');
		await typeInto(field('nickname'), 'มี');
		mocks.evacuees = [noExtras];
		await search('สมหญิง');
		hits()[0].click();
		await settle();

		expect(field('first_name').value).toBe('สมหญิง');
		expect(field('last_name').value).toBe('รักดี');
		expect(field('phone').value).toBe('0899999999');
		expect(field('nickname').value).toBe('มี');
		expect(field('national_id').value).toBe('');
	});

	it("clears the first pick's details the second picked evacuee does not have", async () => {
		await render();
		mocks.evacuees = [somchai];
		await search('สมชาย');
		hits()[0].click();
		await settle();
		mocks.evacuees = [noExtras];
		await search('สมหญิง');
		hits()[0].click();
		await settle();

		expect(field('first_name').value).toBe('สมหญิง');
		expect(field('nickname').value).toBe('');
		expect(field('phone').value).toBe('');
		expect(field('national_id').value).toBe('');
	});

	it('still registers by hand when search is never used', async () => {
		await render();
		await typeInto(field('first_name'), 'มานะ');
		await typeInto(field('last_name'), 'อดทน');
		submitForm();
		await vi.waitFor(() => expect(mocks.createMutateAsync).toHaveBeenCalledTimes(1));
		expect(mocks.createMutateAsync.mock.calls[0][0]).toMatchObject({
			first_name: 'มานะ',
			last_name: 'อดทน',
			phone: null,
			national_id: null,
			source: 'walk_in'
		});
	});

	it('does not enable the query for fewer than 2 characters', async () => {
		await render();
		await typeInto(searchBox()!, 'ส');
		await new Promise((resolve) => setTimeout(resolve, 400));
		await settle();
		expect(hits()).toHaveLength(0);
		// The hook's own gate: a 1-char term must leave the query disabled, 2 chars enable it.
		expect(mocks.gate!.query()).toBe('ส');
		expect(mocks.gate!.enabled()).toBe(false);
		expect(mocks.enabledReads.every((on) => !on)).toBe(true);
		await search('สม');
		expect(mocks.gate!.query()).toBe('สม');
		expect(mocks.gate!.enabled()).toBe(true);
	});

	it('does not submit the registration form when Enter is pressed in the search box', async () => {
		await render();
		const submitted = vi.fn();
		document.body.querySelector('form')!.addEventListener('submit', submitted);
		const enter = new KeyboardEvent('keydown', {
			key: 'Enter',
			bubbles: true,
			cancelable: true
		});
		searchBox()!.dispatchEvent(enter);
		expect(enter.defaultPrevented).toBe(true);
		expect(submitted).not.toHaveBeenCalled();
		expect(mocks.createMutateAsync).not.toHaveBeenCalled();
	});

	it('clears the term and the results with a 44px clear button', async () => {
		await render();
		expect(clearButton()).toBeNull();
		await search('สม');
		const clear = clearButton()!;
		expect(clear.className).toContain('size-11');
		clear.click();
		await settle();
		expect(searchBox()!.value).toBe('');
		expect(hits()).toHaveLength(0);
		expect(clearButton()).toBeNull();
	});

	it('shows a failed search as an error, not as "no match", and toasts', async () => {
		await render();
		mocks.searchError = true;
		await typeInto(searchBox()!, 'สม');
		await vi.waitFor(() => expect(errorMessage()).not.toBeNull(), { timeout: 2000 });
		expect(errorMessage()!.textContent).toContain('ค้นหาผู้พักพิงไม่สำเร็จ');
		expect(document.body.textContent).not.toContain('ไม่พบผู้พักพิงที่ตรงกับคำค้น');
		expect(toast.error).toHaveBeenCalled();
	});

	it('still says "no match" for an empty result that is not an error', async () => {
		await render();
		mocks.evacuees = [];
		await typeInto(searchBox()!, 'xx');
		await vi.waitFor(() => expect(document.body.textContent).toContain('ไม่พบผู้พักพิง'), {
			timeout: 2000
		});
		expect(errorMessage()).toBeNull();
		expect(toast.error).not.toHaveBeenCalled();
	});

	it('announces results and status through a polite live region', async () => {
		await render();
		const live = document.body
			.querySelector('#walk-in-evacuee-search')!
			.closest('div.space-y-2')!
			.querySelector('[aria-live="polite"]');
		expect(live).not.toBeNull();
		await search('สม');
		expect(live!.querySelectorAll('[data-testid="walk-in-evacuee-hit"]').length).toBe(2);
		hits()[0].click();
		await settle();
		expect(live!.textContent).toContain('เติมข้อมูลจาก สมชาย ใจดี');
	});

	it('says how many matches are hidden when results are cut to 8', async () => {
		await render();
		mocks.evacuees = Array.from({ length: 11 }, (_, i) => ({
			...somchai,
			_id: `evacuee:${100 + i}`
		}));
		await search('สม');
		expect(hits()).toHaveLength(8);
		expect(
			document.body.querySelector('[data-testid="walk-in-evacuee-more"]')!.textContent
		).toContain('มีอีก 3 รายการ — พิมพ์คำค้นให้ละเอียดขึ้น');
	});

	it('does not show the "more" hint when everything fits', async () => {
		await render();
		await search('สม');
		expect(document.body.querySelector('[data-testid="walk-in-evacuee-more"]')).toBeNull();
	});

	it('tells which fields a pick filled', async () => {
		await render();
		mocks.evacuees = [somchai];
		await search('สม');
		hits()[0].click();
		await settle();
		const text = document.body.querySelector('[data-testid="walk-in-evacuee-picked"]')!.textContent;
		for (const label of ['ชื่อ', 'นามสกุล', 'ชื่อเล่น', 'เบอร์โทร', 'เลขบัตรประชาชน']) {
			expect(text).toContain(label);
		}
		expect(document.body.querySelector('[data-testid="walk-in-evacuee-phone-skipped"]')).toBeNull();
	});

	it('says so when a non-mobile phone was not copied', async () => {
		await render();
		mocks.evacuees = [{ ...somchai, phone: '074-123456' }];
		await search('สม');
		hits()[0].click();
		await settle();
		expect(field('phone').value).toBe('');
		expect(
			document.body.querySelector('[data-testid="walk-in-evacuee-phone-skipped"]')!.textContent
		).toContain('ไม่ใช่เบอร์มือถือ');
		expect(
			document.body.querySelector('[data-testid="walk-in-evacuee-picked"]')!.textContent
		).not.toContain('เบอร์โทร');
	});
});

describe('WalkInRegistrationDialog — who may search evacuees (#1062)', () => {
	it.each([
		['shelter manager', MANAGER],
		['registration staff', REGISTRATION],
		['system admin', ['system_admin']]
	])('shows the search box to %s', async (_name, roles) => {
		mocks.roles = roles;
		await render();
		expect(searchBox()).not.toBeNull();
		expect(mocks.hookCalls).toBe(1);
	});

	it.each([
		['volunteer coordinator', COORDINATOR],
		['no roles', []],
		['registration staff of another shelter', ['shelter:SH002', 'SH002:registration_staff']]
	])('hides the search box and never queries evacuees for %s', async (_name, roles) => {
		mocks.roles = roles;
		await render();
		expect(searchBox()).toBeNull();
		expect(document.body.textContent).not.toContain('ค้นหาคนในศูนย์');
		expect(mocks.hookCalls).toBe(0);
		expect(mocks.gate).toBeNull();
		expect(mocks.enabledReads).toHaveLength(0);
		expect(mocks.searchTerms).toHaveLength(0);
	});

	it('lets the coordinator register by hand exactly as before', async () => {
		mocks.roles = COORDINATOR;
		await render();
		await typeInto(field('first_name'), 'มานะ');
		await typeInto(field('last_name'), 'อดทน');
		submitForm();
		await vi.waitFor(() => expect(mocks.createMutateAsync).toHaveBeenCalledTimes(1));
		expect(mocks.createMutateAsync.mock.calls[0][0]).toMatchObject({
			first_name: 'มานะ',
			source: 'walk_in'
		});
	});
});

describe('WalkInRegistrationDialog — duplicate phone rejection (CR-239)', () => {
	it('shows error and duplicate volunteer button when phone is taken', async () => {
		mocks.roles = COORDINATOR;
		mocks.createMutateAsync.mockRejectedValueOnce(
			new VolunteerPhoneTakenError([
				{
					_id: 'volunteer:01TEST',
					volunteer_code: 'V-012',
					first_name: 'สมชาย',
					last_name: 'ใจดี',
					status: 'active'
				}
			])
		);

		await render();
		await typeInto(field('first_name'), 'สมศักดิ์');
		await typeInto(field('last_name'), 'รักชาติ');
		await typeInto(field('phone'), '0812345678');
		submitForm();

		await vi.waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining('เบอร์นี้มีอยู่แล้วในศูนย์: V-012 สมชาย ใจดี'),
				expect.anything()
			);
		});

		expect(document.body.textContent).toContain('พบโปรไฟล์ที่ใช้เบอร์นี้แล้วในศูนย์');
		expect(document.body.textContent).toContain('เปิดโปรไฟล์ V-012');
	});
});

describe('WalkInRegistrationDialog — form reset behavior', () => {
	it('resets form fields when reopened after submit succeeds', async () => {
		mocks.roles = COORDINATOR;
		mocks.createMutateAsync.mockResolvedValueOnce({
			_id: 'volunteer:001',
			volunteer_code: 'V-001',
			first_name: 'มานะ',
			last_name: 'อดทน'
		});

		const harness = mount(Harness, { target: document.body });
		instance = harness;
		await settle();

		await typeInto(field('first_name'), 'มานะ');
		await typeInto(field('last_name'), 'อดทน');
		await typeInto(field('phone'), '0891234567');
		submitForm();

		await vi.waitFor(() => expect(mocks.createMutateAsync).toHaveBeenCalledTimes(1));
		await settle();

		expect(harness.getOpen()).toBe(false);

		harness.reopen();
		await settle();

		expect(harness.getOpen()).toBe(true);
		expect(field('first_name').value).toBe('');
		expect(field('last_name').value).toBe('');
		expect(field('phone').value).toBe('');
	});
});
