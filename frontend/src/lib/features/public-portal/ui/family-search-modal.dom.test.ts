// @vitest-environment happy-dom
// CR-231 S6 — home-page search modal uses the same consent gate and session as /search.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

vi.mock('$app/environment', () => ({ browser: true }));

import FamilySearchModal from './family-search-modal.svelte';

let instance: ReturnType<typeof mount> | null = null;
let fetchFn: ReturnType<typeof vi.fn>;

const $ = <T extends Element>(selector: string) => document.body.querySelector<T>(selector);
const consentDialog = () => $('#consent-first-name');
const button = (label: string) =>
	[...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(label)) ?? null;

async function settle() {
	for (let i = 0; i < 5; i++) {
		await tick();
		await Promise.resolve();
	}
	flushSync();
}

async function setValue(selector: string, value: string) {
	const el = $<HTMLInputElement>(selector)!;
	el.value = value;
	el.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
}

async function click(el: Element | null) {
	(el as HTMLElement).click();
	await settle();
}

async function fillAndConfirm() {
	await setValue('#consent-first-name', 'สมชาย');
	await setValue('#consent-phone', '0812345678');
	await click($('input[type="radio"][value="other"]'));
	await setValue('#consent-purpose-note', 'ธุระส่วนตัว');
	await click($('#consent-accept'));
	await click(button('ยืนยันและค้นหา'));
}

async function search(text: string) {
	await setValue('input[aria-label="คำค้นหา"]', text);
	await click(button('ค้นหา'));
}

beforeEach(async () => {
	sessionStorage.clear();
	fetchFn = vi.fn(() =>
		Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: [] }) })
	);
	vi.stubGlobal('fetch', fetchFn);
	instance = mount(FamilySearchModal, { target: document.body, props: { open: true } });
	await settle();
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

describe('FamilySearchModal consent gate (CR-231)', () => {
	it('does not open the dialog for an invalid query', async () => {
		await search('ท');
		expect(consentDialog()).toBeNull();
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('opens the dialog on the first valid search; cancel keeps the query and sends nothing', async () => {
		await search('สมชาย');
		expect(consentDialog()).not.toBeNull();
		expect(fetchFn).not.toHaveBeenCalled();

		await click(button('ยกเลิก'));
		expect(consentDialog()).toBeNull();
		expect($<HTMLInputElement>('input[aria-label="คำค้นหา"]')!.value).toBe('สมชาย');
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('confirm sends the consent data, and the next search in the session is not asked again', async () => {
		await search('สมชาย');
		await fillAndConfirm();

		expect(fetchFn).toHaveBeenCalledTimes(1);
		const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
		expect(body).toEqual({
			search: 'สมชาย',
			searcher: { first_name: 'สมชาย', last_name: '', phone: '0812345678' },
			purpose: 'other',
			purpose_note: 'ธุระส่วนตัว',
			consent_accepted: true
		});

		await search('สมหมาย');
		expect(consentDialog()).toBeNull();
		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(JSON.parse((fetchFn.mock.calls[1][1] as RequestInit).body as string)).toMatchObject({
			search: 'สมหมาย',
			purpose: 'other',
			consent_accepted: true
		});
	});

	it('requires the reason when the purpose is other', async () => {
		await search('สมชาย');
		await setValue('#consent-first-name', 'สมชาย');
		await setValue('#consent-phone', '0812345678');
		await click($('input[type="radio"][value="other"]'));
		await click($('#consent-accept'));
		await click(button('ยืนยันและค้นหา'));
		expect(document.body.textContent).toContain('กรุณาระบุเหตุผล (ไม่เกิน 200 ตัวอักษร)');
		expect(fetchFn).not.toHaveBeenCalled();
	});
});
