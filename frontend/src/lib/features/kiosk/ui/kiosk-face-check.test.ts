import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import KioskBiometricConsent from './kiosk-biometric-consent.svelte';
import KioskFaceCameraPanel from './kiosk-face-camera-panel.svelte';
import KioskFaceCardNotice from './kiosk-face-card-notice.svelte';
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

describe('KioskFaceCheck — card notice and skip', () => {
	const props = {
		flow: 'walk_in',
		citizenId: '1234567890123',
		mode: 'on',
		cameraLabel: null,
		onfinish: noop
	} as const;

	it('warns check-in to keep the card in from the first step, and not walk-in', () => {
		const checkIn = render(KioskFaceCheck, { props: { ...props, flow: 'check_in' } });
		const walkIn = render(KioskFaceCheck, { props });

		expect(checkIn.body).toContain('กรุณาเสียบบัตรค้างไว้จนกว่าระบบจะบอกให้ถอด');
		expect(walkIn.body).not.toContain('กรุณาเสียบบัตรค้างไว้');
		expect(walkIn.body).not.toContain('kiosk-face-card-notice');
	});

	it('does not offer to skip before the person has agreed to the check', () => {
		const { body } = render(KioskFaceCheck, { props });

		expect(body).toContain('data-face-phase="consent"');
		expect(body).not.toContain('ข้าม ให้เจ้าหน้าที่ตรวจแทน');
	});
});

describe('KioskFaceCardNotice', () => {
	it('is amber with an alert icon until the card may come out', () => {
		const { body } = render(KioskFaceCardNotice, { props: { removable: false } });

		expect(body).toContain('กรุณาเสียบบัตรค้างไว้จนกว่าระบบจะบอกให้ถอด');
		expect(body).toContain('border-amber-200');
		expect(body).toContain('lucide-circle-alert');
		expect(body).toContain('role="status"');
	});

	it('turns emerald and says the card may be taken out', () => {
		const { body } = render(KioskFaceCardNotice, { props: { removable: true } });

		expect(body).toContain('ถอดบัตรได้แล้ว');
		expect(body).toContain('border-emerald-200');
		expect(body).not.toContain('กรุณาเสียบบัตรค้างไว้');
		expect(body).toContain('lucide-circle-check');
	});
});

describe('KioskFaceCameraPanel', () => {
	const panel = {
		shown: true,
		starting: false,
		verifying: false,
		message: 'กรุณามองตรงที่กล้อง',
		attempt: 0,
		maxAttempts: 3,
		slow: false,
		frameReady: false,
		framingProblem: false,
		showSkip: true,
		onskip: noop
	};

	it('draws the guide white while nothing is settled, with no status icon', () => {
		const { body } = render(KioskFaceCameraPanel, { props: panel });

		expect(body).toContain('data-face-guide="idle"');
		expect(body).toContain('border-white/90');
		expect(body).not.toContain('kiosk-face-guide-icon');
	});

	it('turns the guide emerald with a check once the face is well placed, message kept', () => {
		const { body } = render(KioskFaceCameraPanel, { props: { ...panel, frameReady: true } });

		expect(body).toContain('data-face-guide="ready"');
		expect(body).toContain('border-emerald-500');
		expect(body).toContain('lucide-check');
		expect(body).toContain('กรุณามองตรงที่กล้อง');
	});

	it('turns the guide amber with an alert icon on a framing problem, message kept', () => {
		const { body } = render(KioskFaceCameraPanel, {
			props: { ...panel, framingProblem: true, message: 'กรุณาขยับเข้าใกล้กล้องอีกนิด' }
		});

		expect(body).toContain('data-face-guide="problem"');
		expect(body).toContain('border-amber-400');
		expect(body).toContain('lucide-circle-alert');
		expect(body).toContain('กรุณาขยับเข้าใกล้กล้องอีกนิด');
	});

	it('does not animate the colour change for people who asked for less motion', () => {
		const { body } = render(KioskFaceCameraPanel, { props: panel });

		expect(body).toContain('motion-reduce:transition-none');
	});

	it('counts attempts against the maximum, only after the first', () => {
		const first = render(KioskFaceCameraPanel, { props: panel });
		const second = render(KioskFaceCameraPanel, { props: { ...panel, attempt: 1 } });
		const last = render(KioskFaceCameraPanel, { props: { ...panel, attempt: 2, maxAttempts: 5 } });

		expect(first.body).not.toContain('ครั้งที่');
		expect(second.body).toContain('ครั้งที่ 2 จาก 3');
		expect(last.body).toContain('ครั้งที่ 3 จาก 5');
	});

	it('mentions staff help only once positioning is slow', () => {
		const quick = render(KioskFaceCameraPanel, { props: panel });
		const slow = render(KioskFaceCameraPanel, { props: { ...panel, slow: true } });

		expect(quick.body).not.toContain('ระบบจะให้เจ้าหน้าที่ช่วยตรวจ');
		expect(slow.body).toContain('หากยังไม่สำเร็จ ระบบจะให้เจ้าหน้าที่ช่วยตรวจ');
	});

	it('offers the skip button only while the camera step runs, as big as the main buttons', () => {
		const running = render(KioskFaceCameraPanel, { props: panel });
		const idle = render(KioskFaceCameraPanel, { props: { ...panel, showSkip: false } });

		expect(running.body).toContain('ข้าม ให้เจ้าหน้าที่ตรวจแทน');
		for (const token of ['min-h-12', 'kiosk-portrait:min-h-16']) {
			expect(running.body).toContain(token);
		}
		expect(idle.body).not.toContain('ข้าม ให้เจ้าหน้าที่ตรวจแทน');
	});

	it('shows the opening and checking texts instead of the instruction', () => {
		const starting = render(KioskFaceCameraPanel, { props: { ...panel, starting: true } });
		const verifying = render(KioskFaceCameraPanel, { props: { ...panel, verifying: true } });

		expect(starting.body).toContain('กำลังเปิดกล้อง…');
		expect(verifying.body).toContain('กำลังตรวจสอบ…');
	});
});
