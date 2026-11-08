// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { langState } from '$lib/states/i18n.svelte';
import Page from './+page.svelte';

const THAI = /[฀-๿]/;

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/volunteers') } }));

let instance: ReturnType<typeof mount> | null = null;

function open(language: 'th' | 'en') {
	langState.current = language;
	instance = mount(Page, { target: document.body });
	flushSync();
}

function openTab(label: string) {
	const tab = [...document.body.querySelectorAll('button')].find((b) =>
		b.textContent?.includes(label)
	);
	expect(tab, `tab "${label}"`).toBeTruthy();
	tab!.click();
	flushSync();
}

const placeholders = () =>
	[...document.body.querySelectorAll('input')]
		.map((input) => input.getAttribute('placeholder') ?? '')
		.join('|');

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	langState.current = 'th';
});

describe('/volunteers landing page', () => {
	it('shows English copy on every tab and no Thai text when the language is EN', () => {
		open('en');
		const seen: string[] = [document.body.textContent ?? '', placeholders()];
		expect(seen[0]).toContain('Integrated disaster volunteer information system');
		expect(seen[0]).toContain('1. Register to volunteer');
		expect(seen[0]).toContain('Cooking');
		openTab('Portal & volunteer card');
		seen.push(document.body.textContent ?? '', placeholders());
		expect(document.body.textContent).toContain('Search to open your ID card');
		openTab('Staffing needs');
		seen.push(document.body.textContent ?? '', placeholders());
		expect(document.body.textContent).toContain('6 more volunteers needed');
		expect(document.body.textContent).toContain('Needed: 2');
		for (const text of seen) expect(text).not.toMatch(THAI);
	});

	it('keeps the Thai copy when the language is TH', () => {
		open('th');
		expect(document.body.textContent).toContain('ระบบงานข้อมูลอาสาสมัครร่วมบูรณาการภัยพิบัติ');
		expect(document.body.textContent).toContain('1. ลงทะเบียนร่วมเป็นกำลังอาสา');
		expect(placeholders()).toContain('ระบุชื่อจริง นามสกุล');
		openTab('ประกาศความต้องการกำลังพล');
		expect(document.body.textContent).toContain('ต้องการอาสาเพิ่ม 6 อัตรา');
		expect(document.body.textContent).toContain('ต้องการ: 2 คน');
	});
});
