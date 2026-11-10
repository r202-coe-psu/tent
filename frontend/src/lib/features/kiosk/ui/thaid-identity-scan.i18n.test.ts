import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { languageStore } from '$lib/stores/language.svelte';
import ThaidIdentityScan from './thaid-identity-scan.svelte';

const THAI = /[฀-๿]/;

function renderScan(): string {
	return render(ThaidIdentityScan, {
		props: { contextQuery: '?shelter_code=SH001', displayShelterCode: 'SH001' }
	}).body;
}

describe('ThaidIdentityScan language', () => {
	afterEach(() => languageStore.setLanguage('th'));

	it('keeps the Thai heading and steps in Thai', () => {
		const body = renderScan();

		expect(body).toContain('สแกน QR ด้วยมือถือ');
		expect(body).toContain('เปิดกล้องหรือ LINE');
		expect(body).toContain('ยืนยันในแอป ThaiD');
	});

	it('shows the heading, steps and spinner label in English', () => {
		languageStore.setLanguage('en');
		const body = renderScan();

		expect(body).toContain('Scan the QR with your phone');
		expect(body).toContain('Open the camera or LINE');
		expect(body).toContain('Confirm in the ThaiD app');
		expect(body).toContain('aria-label="Creating QR"');
		// The wizard header and the back button are shared components with their own tests.
		expect(body.slice(body.indexOf('thaid-qr-frame'))).not.toMatch(THAI);
	});
});
