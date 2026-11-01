// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { Evacuee } from '$lib/features/people';
import WalkInRegistrationDialog from './walk-in-registration-dialog.svelte';

const mocks = vi.hoisted(() => ({
	evacuees: [] as unknown[],
	searchTerms: [] as string[],
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
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
vi.mock('$lib/stores/shelter.svelte', () => ({ shelterStore: { selectedShelterCode: 'SH001' } }));
vi.mock('$lib/features/shelters', () => ({
	useShelter: () => ({ data: { name: 'ศูนย์ทดสอบ' } })
}));
vi.mock('$lib/features/people', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/people')>()),
	useSearchEvacuees: (query: () => string, enabled: () => boolean) => ({
		get data() {
			mocks.searchTerms.push(query());
			return enabled() ? mocks.evacuees : undefined;
		},
		isFetching: false
	})
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
	mocks.searchTerms = [];
	mocks.createMutateAsync.mockReset();
	mocks.createMutateAsync.mockResolvedValue({ _id: 'volunteer:9', volunteer_code: 'V-009' });
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
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

	it('does not search for fewer than 2 characters', async () => {
		await render();
		await typeInto(searchBox()!, 'ส');
		await new Promise((resolve) => setTimeout(resolve, 400));
		await settle();
		expect(hits()).toHaveLength(0);
	});
});
