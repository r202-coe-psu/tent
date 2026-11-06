// @vitest-environment happy-dom
// CR-231 S5 — /search consent gate. (Named page.dom.test.ts: SvelteKit reserves `+*` filenames and
// the dom project only picks up *.dom.test.ts.)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/search') }));
vi.mock('$app/state', () => ({ page: pageState }));
vi.mock('$app/environment', () => ({ browser: true }));

import Page from './+page.svelte';

let instance: ReturnType<typeof mount> | null = null;
let fetchFn: ReturnType<typeof vi.fn>;

const $ = <T extends Element>(selector: string) => document.body.querySelector<T>(selector);
const dialog = () => $('[role="dialog"]');

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
	await setValue('#consent-phone', '081-234-5678');
	await click($('input[type="radio"][value="find_family"]'));
	await click($('#consent-accept'));
	await click(
		[...document.body.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('ยืนยันและค้นหา')
		) ?? null
	);
}

async function search(text: string) {
	await setValue('input[type="text"]', text);
	await click(
		[...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'ค้นหา') ??
			null
	);
}

async function render() {
	instance = mount(Page, { target: document.body });
	await settle();
}

beforeEach(() => {
	sessionStorage.clear();
	pageState.url = new URL('http://localhost/search');
	fetchFn = vi.fn(() =>
		Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: [] }) })
	);
	vi.stubGlobal('fetch', fetchFn);
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

describe('/search consent gate (CR-231)', () => {
	it('opens the dialog on the first valid search and does not call the API yet', async () => {
		await render();
		await search('สมชาย');
		expect(dialog()).not.toBeNull();
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('does not open the dialog for an invalid query and shows the usual error', async () => {
		await render();
		await search('ท');
		expect(dialog()).toBeNull();
		expect(document.body.textContent).toContain(
			'กรุณากรอกชื่อหรือนามสกุลอย่างน้อย 2 ตัวอักษรต่อคำ'
		);
	});

	it('links to /policy from the dialog', async () => {
		await render();
		await search('สมชาย');
		expect($('a[href="/policy"]')).not.toBeNull();
	});

	it('cancel closes the dialog, keeps the query and sends nothing', async () => {
		await render();
		await search('สมชาย');
		await click(
			[...document.body.querySelectorAll('button')].find(
				(b) => b.textContent?.trim() === 'ยกเลิก'
			) ?? null
		);
		expect(dialog()).toBeNull();
		expect($<HTMLInputElement>('input[type="text"]')!.value).toBe('สมชาย');
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('blocks confirm until the form is valid and consent is ticked', async () => {
		await render();
		await search('สมชาย');
		await click(
			[...document.body.querySelectorAll('button')].find((b) =>
				b.textContent?.includes('ยืนยันและค้นหา')
			) ?? null
		);
		expect(dialog()).not.toBeNull();
		expect(document.body.textContent).toContain('กรุณาติกยินยอมก่อนดำเนินการต่อ');
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('confirm searches with the searcher, purpose and consent, then skips the dialog next time', async () => {
		await render();
		await search('สมชาย');
		await fillAndConfirm();

		expect(dialog()).toBeNull();
		expect(fetchFn).toHaveBeenCalledTimes(1);
		const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
		expect(body).toEqual({
			search: 'สมชาย',
			searcher: { first_name: 'สมชาย', last_name: '', phone: '0812345678' },
			purpose: 'find_family',
			consent_accepted: true
		});

		await search('สมหมาย');
		expect(dialog()).toBeNull();
		expect(fetchFn).toHaveBeenCalledTimes(2);
		const second = JSON.parse((fetchFn.mock.calls[1][1] as RequestInit).body as string);
		expect(second).toMatchObject({
			search: 'สมหมาย',
			purpose: 'find_family',
			consent_accepted: true
		});
	});

	it('?q= opens the dialog first and auto-searches after confirm', async () => {
		pageState.url = new URL(
			'http://localhost/search?q=%E0%B8%AA%E0%B8%A1%E0%B8%8A%E0%B8%B2%E0%B8%A2'
		);
		await render();
		expect(dialog()).not.toBeNull();
		expect(fetchFn).not.toHaveBeenCalled();
		expect($<HTMLInputElement>('input[type="text"]')!.value).toBe('สมชาย');

		await fillAndConfirm();
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('?q= searches straight away when the session already confirmed', async () => {
		sessionStorage.setItem(
			'public-search-consent:v1',
			JSON.stringify({
				searcher: { first_name: 'สมชาย', last_name: '', phone: '0812345678' },
				purpose: 'find_family',
				consent_accepted: true
			})
		);
		pageState.url = new URL(
			'http://localhost/search?q=%E0%B8%AA%E0%B8%A1%E0%B8%8A%E0%B8%B2%E0%B8%A2'
		);
		await render();
		expect(dialog()).toBeNull();
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});
});
