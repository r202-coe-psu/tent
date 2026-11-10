import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { languageStore } from '$lib/stores/language.svelte';
import KioskBiometricConsent from './kiosk-biometric-consent.svelte';
import KioskFaceCameraPanel from './kiosk-face-camera-panel.svelte';
import KioskFaceCardNotice from './kiosk-face-card-notice.svelte';

const THAI = /[฀-๿]/;
const noop = () => {};

const cameraProps = {
	shown: true,
	starting: false,
	verifying: false,
	message: 'ยังไม่พบใบหน้า กรุณามองตรงที่กล้อง',
	attempt: 1,
	maxAttempts: 3,
	slow: true,
	frameReady: false,
	framingProblem: false,
	showSkip: true,
	onskip: noop
};

describe('face check screens in English', () => {
	afterEach(() => languageStore.setLanguage('th'));

	it('asks for biometric consent in English with a real way to decline', () => {
		languageStore.setLanguage('en');
		const { body } = render(KioskBiometricConsent, { props: { onagree: noop, ondecline: noop } });

		expect(body).toContain('Compare your face with the card photo');
		expect(body).toContain('Your face image is not saved.');
		expect(body).toContain('Agree, start face check');
		expect(body).toContain('Decline, staff will check');
		expect(body).not.toMatch(THAI);
	});

	it('says the card must stay in, then that it can come out', () => {
		languageStore.setLanguage('en');

		const staying = render(KioskFaceCardNotice, { props: { removable: false } }).body;
		const removable = render(KioskFaceCardNotice, { props: { removable: true } }).body;

		expect(staying).toContain('Keep your card inserted until told to remove it');
		expect(removable).toContain('You can remove your card now');
		expect(staying + removable).not.toMatch(THAI);
	});

	it('shows the camera heading, hint, attempt count and skip button in English', () => {
		languageStore.setLanguage('en');
		const { body } = render(KioskFaceCameraPanel, { props: cameraProps });

		expect(body).toContain('Face check');
		expect(body).toContain('No face found yet. Please look at the camera');
		expect(body).toContain('Attempt 2 of 3');
		expect(body).toContain('aria-label="Camera view"');
		expect(body).toContain('Staff skip this step');
		expect(body).not.toMatch(THAI);
	});

	it('keeps the camera hint in Thai when the language is Thai', () => {
		const { body } = render(KioskFaceCameraPanel, { props: cameraProps });

		expect(body).toContain('ยังไม่พบใบหน้า กรุณามองตรงที่กล้อง');
		expect(body).toContain('ครั้งที่ 2 จาก 3');
	});
});
