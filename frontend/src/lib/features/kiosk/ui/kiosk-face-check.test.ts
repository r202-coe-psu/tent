import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import KioskBiometricConsent from './kiosk-biometric-consent.svelte';
import KioskFaceCheck from './kiosk-face-check.svelte';

const noop = () => {};

describe('KioskBiometricConsent', () => {
	it('says what is done, that nothing is kept but the result, and that no is allowed', () => {
		const { body } = render(KioskBiometricConsent, { props: { onagree: noop, ondecline: noop } });

		expect(body).toContain('ตรวจใบหน้าเทียบกับรูปในบัตร');
		expect(body).toContain('ภาพใบหน้าจะไม่ถูกบันทึก');
		expect(body).toContain('หากไม่ยินยอม ท่านยังรับบริการได้ตามปกติ');
	});

	it('offers a real way to decline next to the way to agree', () => {
		const { body } = render(KioskBiometricConsent, { props: { onagree: noop, ondecline: noop } });

		expect(body).toContain('ยินยอม เริ่มตรวจใบหน้า');
		expect(body).toContain('ไม่ยินยอม ให้เจ้าหน้าที่ตรวจแทน');
	});

	it('is an h1 on its own page and an h2 under another heading', () => {
		const alone = render(KioskBiometricConsent, { props: { onagree: noop, ondecline: noop } });
		const nested = render(KioskBiometricConsent, {
			props: { onagree: noop, ondecline: noop, headingTag: 'h2' }
		});

		expect(alone.body).toMatch(/<h1[^>]*id="face-consent-title"/);
		expect(nested.body).toMatch(/<h2[^>]*id="face-consent-title"/);
	});

	it('gives the buttons a touch size for both kiosk screens', () => {
		const { body } = render(KioskBiometricConsent, { props: { onagree: noop, ondecline: noop } });

		for (const token of ['min-h-12', 'kiosk-portrait:min-h-16', 'kiosk-compact:']) {
			expect(body).toContain(token);
		}
	});
});

describe('KioskFaceCheck', () => {
	const props = {
		flow: 'walk_in',
		citizenId: '1234567890123',
		mode: 'on',
		cameraLabel: null,
		onfinish: noop
	} as const;

	it('starts at the consent step: no camera is opened before the person agrees', () => {
		const { body } = render(KioskFaceCheck, { props });

		expect(body).toContain('data-face-phase="consent"');
		expect(body).toContain('ยินยอม เริ่มตรวจใบหน้า');
	});

	it('keeps the video element in the page so the camera can open into it', () => {
		const { body } = render(KioskFaceCheck, { props });

		expect(body).toContain('<video');
		expect(body).toContain('muted');
	});

	it('hides the camera panel and any result until they are needed', () => {
		const { body } = render(KioskFaceCheck, { props });

		expect(body).toMatch(/class="[^"]*\bhidden\b[^"]*"/);
		expect(body).not.toContain('kiosk-face-result');
	});

	it('uses h2 headings when embedded under the check-in header', () => {
		const embedded = render(KioskFaceCheck, { props: { ...props, embedded: true } });
		const alone = render(KioskFaceCheck, { props });

		expect(embedded.body).not.toContain('<h1');
		expect(alone.body).toContain('<h1');
	});
});
