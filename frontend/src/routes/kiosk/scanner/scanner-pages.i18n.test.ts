import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/svelte-query';
import { render } from 'svelte/server';
import { languageStore } from '$lib/stores/language.svelte';
import HomePage from '../+page.svelte';
import { KIOSK_HOME_PAGE_I18N } from '../page.i18n';
import ErrorPage from './error/+page.svelte';
import ReadingPage from './reading/+page.svelte';
import { KIOSK_SCANNER_I18N } from './scanner.i18n';
import WaitingPage from './waiting/+page.svelte';

vi.mock('$app/state', () => ({ page: { url: new URL('http://kiosk.test/kiosk/scanner') } }));
vi.mock('$lib/features/kiosk/data/kiosk-banners.api', () => ({
	fetchKioskBanners: vi.fn().mockResolvedValue([])
}));

const THAI = /[฀-๿]/;

/** Dotted paths of every leaf, so two dictionaries can be compared key for key. */
function leaves(value: unknown, path = ''): [string, unknown][] {
	if (value && typeof value === 'object') {
		return Object.entries(value).flatMap(([key, child]) =>
			leaves(child, path ? `${path}.${key}` : key)
		);
	}
	return [[path, value]];
}

function compareLanguages(dictionary: { th: unknown; en: unknown }) {
	const th = leaves(dictionary.th);
	const en = leaves(dictionary.en);
	return {
		thKeys: th.map(([key]) => key).sort(),
		enKeys: en.map(([key]) => key).sort(),
		thaiInEn: en
			.filter(([, value]) => typeof value === 'string' && THAI.test(value))
			.map(([key]) => key)
	};
}

describe.each([
	['KIOSK_SCANNER_I18N', KIOSK_SCANNER_I18N],
	['KIOSK_HOME_PAGE_I18N', KIOSK_HOME_PAGE_I18N]
])('%s', (_name, dictionary) => {
	it('has the same keys in both languages and no Thai in English', () => {
		const { thKeys, enKeys, thaiInEn } = compareLanguages(dictionary);

		expect(enKeys).toEqual(thKeys);
		expect(thaiInEn).toEqual([]);
	});
});

describe('kiosk scanner pages language', () => {
	afterEach(() => languageStore.setLanguage('th'));

	it('waiting: asks for the ID card in English with no Thai', () => {
		languageStore.setLanguage('en');

		const html = render(WaitingPage, { props: {} }).body;

		expect(html).toContain('Insert your ID card');
		expect(html).toContain('Card face up · barcode side in');
		expect(html).toContain('Waiting for card · do not remove it');
		expect(html).not.toMatch(THAI);
	});

	it('waiting: keeps the Thai literals in Thai', () => {
		const html = render(WaitingPage, { props: {} }).body;

		expect(html).toContain('เสียบบัตรประชาชน');
		expect(html).toContain('หงายบัตรขึ้น · เอาด้านบาร์โค้ดเข้า');
		expect(html).toContain('รออ่านบัตร · อย่าถอดบัตร');
		expect(html).toContain('ช่องเสียบบัตร');
	});

	it('reading: tells the user the card is being read in English with no Thai', () => {
		languageStore.setLanguage('en');

		const html = render(ReadingPage, { props: {} }).body;

		expect(html).toContain('Reading your card');
		expect(html).toContain('Please wait');
		expect(html).not.toMatch(THAI);
	});

	it('reading: keeps the Thai literals in Thai', () => {
		const html = render(ReadingPage, { props: {} }).body;

		expect(html).toContain('กำลังอ่านบัตร');
		expect(html).toContain('กรุณารอสักครู่');
		expect(html).toContain('ใช้เลขบัตรค้นหาการลงทะเบียนเท่านั้น');
	});

	it('error: shows the retry steps in English with no Thai', () => {
		languageStore.setLanguage('en');

		const html = render(ErrorPage, { props: {} }).body;

		expect(html).toContain('Could not read the card');
		expect(html).toContain('Insert the card again');
		expect(html).toContain('Still not working? Please ask staff for help');
		expect(html).not.toMatch(THAI);
	});

	it('error: keeps the Thai literals in Thai', () => {
		const html = render(ErrorPage, { props: {} }).body;

		expect(html).toContain('อ่านบัตรไม่สำเร็จ');
		expect(html).toContain('เสียบบัตรใหม่อีกครั้ง');
		expect(html).toContain('ตรวจสอบการเสียบบัตร แล้วลองอีกครั้ง');
	});

	it('home: page title is English with no Thai', () => {
		languageStore.setLanguage('en');

		const html = render(HomePage, {
			props: {
				params: {},
				data: {
					queryClient: new QueryClient(),
					qrCheckInEnabled: true,
					phoneCheckInEnabled: false,
					thaidCheckInEnabled: true,
					walkInRegistrationEnabled: false,
					serviceOpen: true
				}
			}
		}).body;

		expect(html).toContain('Choose how to find your record');
		expect(html).not.toMatch(THAI);
	});
});
