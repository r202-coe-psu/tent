// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { writable } from 'svelte/store';
import type { SuperForm } from 'sveltekit-superforms';
import type { SuperFormData } from 'sveltekit-superforms/client';
import BasicInfoSection from './basic-info-section.svelte';
import type { Shelter } from '../domain/schema';

vi.mock('../application/queries', () => ({
	useProvinces: () => ({ data: ['สงขลา'] }),
	useDistricts: () => ({ data: ['หาดใหญ่'] }),
	useSubdistricts: () => ({ data: [{ subdistrict: 'คอหงส์', zipcode: '90110' }] })
}));
vi.mock('$lib/features/master-data', () => ({
	useMasterData: () => ({ data: [] }),
	formatMasterLabel: (item: { name?: string } | null | undefined) => item?.name ?? ''
}));
vi.mock('./location-map-picker.svelte', () => ({ default: () => '' }));
// Same guard as the other shelter DOM tests: happy-dom's cloned <form> trips kit's `enhance` check.
vi.mock('$app/forms', async (importOriginal) => ({
	...(await importOriginal<typeof import('$app/forms')>()),
	enhance: () => ({ destroy() {} })
}));

let instance: ReturnType<typeof mount> | null = null;

function setup(feature_flags: Record<string, unknown> | undefined, disabled = false) {
	const formData = writable({
		name: 'ศูนย์ทดสอบ',
		operation_status: 'standby',
		feature_flags
	});
	const form = {
		form: formData,
		errors: writable({}),
		constraints: writable({}),
		tainted: writable(undefined),
		submitting: writable(false),
		delayed: writable(false),
		timeout: writable(false),
		posted: writable(false),
		allErrors: writable([]),
		capture: vi.fn(),
		restore: vi.fn(),
		enhance: vi.fn(),
		message: writable(undefined)
	} as unknown as SuperForm<Shelter>;
	instance = mount(BasicInfoSection, {
		target: document.body,
		props: {
			form,
			formData: formData as unknown as SuperFormData<Shelter>,
			disabled
		}
	});
	flushSync();
	return formData;
}

const sw = (id: string) => document.body.querySelector<HTMLButtonElement>(`#${id}`)!;

async function click(id: string) {
	sw(id).click();
	flushSync();
	await tick();
	flushSync();
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.clearAllMocks();
});

describe('BasicInfoSection — CR-251 public_visible / accepts_referrals switches', () => {
	it('FR-23 both switches render on when the stored doc has no keys (missing = true)', () => {
		setup({});

		expect(sw('public-visible').getAttribute('aria-checked')).toBe('true');
		expect(sw('accepts-referrals').getAttribute('aria-checked')).toBe('true');
	});

	it('links each description to its switch and has no duplicate aria-label', () => {
		setup({});

		for (const id of ['public-visible', 'accepts-referrals']) {
			expect(sw(id).hasAttribute('aria-label')).toBe(false);
			expect(sw(id).getAttribute('aria-describedby')).toBe(`${id}-desc`);
			expect(document.getElementById(`${id}-desc`)).not.toBeNull();
		}
		expect(document.getElementById('public-visible-desc')?.textContent?.trim()).toBe(
			'เปิด: ประชาชนเห็นศูนย์นี้ในหน้าค้นหาศูนย์ · ปิด: ประชาชนและหน่วยงานภายนอกจะไม่เห็นศูนย์นี้และจำนวนผู้พักอาศัย (ค่าเริ่มต้นเปิด)'
		);
	});

	it('reflects stored false values in both switches', () => {
		setup({ public_visible: false, accepts_referrals: false });

		expect(sw('public-visible').getAttribute('aria-checked')).toBe('false');
		expect(sw('accepts-referrals').getAttribute('aria-checked')).toBe('false');
	});

	it('toggling accepts-referrals writes only that key and keeps sibling flags', async () => {
		const formData = setup({ accepts_pre_registration: true, allow_pets: true });

		await click('accepts-referrals');

		let flags: Record<string, unknown> | undefined;
		formData.subscribe((v) => (flags = v.feature_flags))();
		expect(flags).toMatchObject({
			accepts_referrals: false,
			public_visible: true,
			accepts_pre_registration: true,
			allow_pets: true
		});
	});

	it('FR-25 turning public-visible off only writes after the confirm', async () => {
		const formData = setup({ accepts_referrals: true });
		const flags = () => {
			let f: Record<string, unknown> | undefined;
			formData.subscribe((v) => (f = v.feature_flags))();
			return f;
		};

		await click('public-visible');
		expect(flags()).toEqual({ accepts_referrals: true });
		expect(document.body.textContent).toContain('ซ่อนศูนย์จากหน้าสาธารณะ?');

		const hide = [...document.body.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === 'ซ่อนศูนย์'
		)!;
		hide.click();
		flushSync();
		await tick();
		expect(flags()).toMatchObject({ public_visible: false, accepts_referrals: true });
	});

	it('FR-25 cancelling the confirm keeps public_visible on', async () => {
		const formData = setup({});

		await click('public-visible');
		const cancel = [...document.body.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === 'ยกเลิก'
		)!;
		cancel.click();
		flushSync();
		await tick();

		let f: Record<string, unknown> | undefined;
		formData.subscribe((v) => (f = v.feature_flags))();
		expect(f).toEqual({});
	});

	it('FR-25 turning public-visible back on needs no confirm', async () => {
		const formData = setup({ public_visible: false });

		await click('public-visible');

		let f: Record<string, unknown> | undefined;
		formData.subscribe((v) => (f = v.feature_flags))();
		expect(f).toMatchObject({ public_visible: true });
	});

	it('FR-26 a disabled form ignores both switches', async () => {
		const formData = setup({}, true);

		await click('public-visible');
		await click('accepts-referrals');

		let flags: Record<string, unknown> | undefined;
		formData.subscribe((v) => (flags = v.feature_flags))();
		expect(flags).toEqual({});
	});
});
