import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { languageStore } from '$lib/stores/language.svelte';
import IdentityMethodSelector from './identity-method-selector.svelte';

const THAI = /[฀-๿]/;

function renderSelector(): string {
	return render(IdentityMethodSelector, {
		props: { contextQuery: '', reprintEnabled: true, thaidCheckInEnabled: true }
	}).body;
}

describe('IdentityMethodSelector language', () => {
	afterEach(() => languageStore.setLanguage('th'));

	it('shows the registration title and every method card in English, with no Thai', () => {
		languageStore.setLanguage('en');

		const body = renderSelector();

		expect(body).toMatch(/<h1[^>]*id="method-title"[^>]*>\s*Registration\s*<\/h1>/);
		expect(body).toContain('Choose how to find your record');
		expect(body).toContain('Registration QR');
		expect(body).toContain('Thai ID card');
		expect(body).toContain('ThaiD');
		expect(body).toContain('Print QR');
		expect(body).not.toMatch(THAI);
	});

	it('keeps the Thai literals when the language is Thai', () => {
		languageStore.setLanguage('th');

		const body = renderSelector();

		expect(body).toContain('เลือกวิธีค้นหา');
		expect(body).toContain('QR ลงทะเบียน');
		expect(body).toContain('บัตรประชาชน');
		expect(body).toContain('ขั้น 1 จาก 5 · วิธีค้นหา');
		expect(body).toContain('aria-label="วิธีค้นหาข้อมูล"');
	});
});
