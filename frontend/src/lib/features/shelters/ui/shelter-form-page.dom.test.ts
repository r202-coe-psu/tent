// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { QueryClient } from '@tanstack/svelte-query';
import type { ShelterSummary } from '../data/shelters.repository';
import { sheltersKeys } from '../application/queries';
import Harness from './__fixtures__/shelter-form-page-harness.svelte';

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('$app/forms', async (importOriginal) => ({
	...(await importOriginal<typeof import('$app/forms')>()),
	enhance: () => ({ destroy() {} })
}));
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	invalidateAll: vi.fn()
}));
// The page reads the doc through the remote repository; the test serves it from `served`.
let served: ShelterSummary;
vi.mock('../data/shelters.remote', () => ({
	SHELTER_REGISTRY_DB: 'registry',
	sheltersRepository: () => ({ getShelter: async () => served })
}));

const CODE = 'SH001';
const doc = (over: Partial<ShelterSummary> = {}) =>
	({
		code: CODE,
		_rev: '1-a',
		name: 'ศูนย์เดิม',
		site_kind: 'evacuation_center',
		operation_status: 'standby',
		capacity: 100,
		common_areas: { sub_storage: [] },
		...over
	}) as unknown as ShelterSummary;

let instance: ReturnType<typeof mount> | null = null;
let client: QueryClient;

const nameInput = () => document.body.querySelector<HTMLInputElement>('input[name="name"]')!;
const notice = () => document.body.querySelector('[role="status"]');
const loadLatest = () =>
	[...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.includes('โหลดข้อมูลล่าสุด')
	);

async function settle() {
	for (let i = 0; i < 4; i++) {
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		await tick();
	}
}

/** The registry feed fired: the doc changed elsewhere and the query refetches it. */
async function docChangesElsewhere(over: Partial<ShelterSummary>) {
	served = doc({ _rev: '2-b', ...over });
	await client.invalidateQueries({ queryKey: sheltersKeys.detail(CODE) });
	await settle();
}

async function type(value: string) {
	const input = nameInput();
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
}

beforeEach(async () => {
	served = doc();
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	instance = mount(Harness, { target: document.body, props: { client, code: CODE } });
	await settle();
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	client.clear();
	document.body.innerHTML = '';
});

describe('ShelterFormPage — the stored doc changes while the form is open', () => {
	it('loads the doc into the form without a notice', () => {
		expect(nameInput().value).toBe('ศูนย์เดิม');
		expect(notice()).toBeNull();
	});

	it('updates an untouched form silently', async () => {
		await docChangesElsewhere({ name: 'ศูนย์ใหม่' });
		expect(nameInput().value).toBe('ศูนย์ใหม่');
		expect(notice()).toBeNull();
	});

	it('keeps what the user typed and says there is newer data', async () => {
		await type('ชื่อที่พิมพ์');
		await docChangesElsewhere({ name: 'ศูนย์ใหม่' });
		expect(nameInput().value).toBe('ชื่อที่พิมพ์');
		expect(notice()?.textContent).toContain('มีข้อมูลใหม่');
	});

	it('replaces the form with the latest doc on "load latest" and drops the notice', async () => {
		await type('ชื่อที่พิมพ์');
		await docChangesElsewhere({ name: 'ศูนย์ใหม่' });
		loadLatest()!.click();
		await settle();
		expect(nameInput().value).toBe('ศูนย์ใหม่');
		expect(notice()).toBeNull();
	});
});
