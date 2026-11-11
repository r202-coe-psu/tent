import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { languageStore } from '$lib/stores/language.svelte';
import Page from './+page.svelte';

const route = vi.hoisted(() => ({
	url: new URL(
		'http://kiosk.test/kiosk/closed?shelter_name=%E0%B8%A8%E0%B8%B9%E0%B8%99%E0%B8%A2%E0%B9%8C%20A&station_name=%E0%B8%88%E0%B8%B8%E0%B8%94%201'
	)
}));
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return route.url;
		}
	}
}));

const THAI = /[฀-๿]/;

function messageOf(body: string): string {
	const title = body.match(/<h1[^>]*data-testid="kiosk-closed-title"[^>]*>([\s\S]*?)<\/h1>/);
	const text = body.match(/<p[^>]*data-testid="kiosk-closed-body"[^>]*>([\s\S]*?)<\/p>/);
	return `${title?.[1] ?? ''}|${text?.[1] ?? ''}`;
}

describe('kiosk closed page', () => {
	afterEach(() => languageStore.setLanguage('th'));

	it('shows the Thai closure message with shelter · station and the device-info button', () => {
		languageStore.setLanguage('th');
		route.url = new URL(
			'http://kiosk.test/kiosk/closed?shelter_name=%E0%B8%A8%E0%B8%B9%E0%B8%99%E0%B8%A2%E0%B9%8C%20A&station_name=%E0%B8%88%E0%B8%B8%E0%B8%94%201'
		);

		const { body } = render(Page, { props: { params: {} } });

		expect(body).toContain('ตู้นี้ปิดให้บริการชั่วคราว');
		expect(body).toContain('ขณะนี้ไม่เปิดให้ลงทะเบียนหรือรายงานตัว กรุณาติดต่อเจ้าหน้าที่');
		expect(body).toContain('ศูนย์ A · จุด 1');
		expect(body).toContain('kiosk-device-info-button');
	});

	it('in English shows English text, no Thai characters in the message', () => {
		languageStore.setLanguage('en');
		route.url = new URL(
			'http://kiosk.test/kiosk/closed?shelter_name=Shelter%20A&station_name=Station%201'
		);

		const { body } = render(Page, { props: { params: {} } });

		expect(messageOf(body)).toBe(
			'This kiosk is temporarily closed|Registration and check-in are not available right now. Please contact staff.'
		);
		expect(messageOf(body)).not.toMatch(THAI);
		expect(body).toContain('Shelter A · Station 1');
	});

	it('offers a Thai / English switch that marks the current language', () => {
		languageStore.setLanguage('en');

		const { body } = render(Page, { props: { params: {} } });

		expect(body).toMatch(/data-language="en"[^>]*aria-pressed="true"/);
		expect(body).toMatch(/data-language="th"[^>]*aria-pressed="false"/);
	});
});
