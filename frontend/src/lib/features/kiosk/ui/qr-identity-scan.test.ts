import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { languageStore } from '$lib/stores/language.svelte';
import QrIdentityScan from './qr-identity-scan.svelte';

const props = { contextQuery: '' as const, displayShelterCode: 'SH001' };

function renderScan(): string {
	return render(QrIdentityScan, { props }).body;
}

describe('QrIdentityScan language', () => {
	afterEach(() => languageStore.setLanguage('th'));

	it('shows the Thai heading and hint by default', () => {
		const body = renderScan();

		expect(body).toContain('สแกน QR ลงทะเบียน');
		expect(body).toContain('กำลังเตรียม…');
	});

	it('shows the English heading and hint when the language is English', () => {
		languageStore.setLanguage('en');

		const body = renderScan();

		expect(body).toContain('Scan your registration QR');
		expect(body).toContain('Getting ready…');
		expect(body).not.toContain('สแกน QR ลงทะเบียน');
		expect(body).not.toContain('กำลังเตรียม');
		expect(body).not.toMatch(/[฀-๿]/);
	});
});
