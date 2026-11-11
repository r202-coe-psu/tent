import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { languageStore } from '$lib/stores/language.svelte';
import KioskBackButton from './kiosk-back-button.svelte';
import KioskDeviceInfo from './kiosk-device-info.svelte';
import KioskLookupErrorActions from './kiosk-lookup-error-actions.svelte';
import KioskNumpad from './kiosk-numpad.svelte';
import KioskShell from './kiosk-shell.svelte';
import KioskStaffPinEntry from './kiosk-staff-pin-entry.svelte';

const route = vi.hoisted(() => ({ url: new URL('http://kiosk.test/kiosk') }));
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return route.url;
		}
	}
}));

const THAI = /[฀-๿]/;

/** Renders in the given language; the caller resets the language afterwards. */
function inLanguage(language: 'th' | 'en', draw: () => string): string {
	languageStore.setLanguage(language);
	return draw();
}

describe('kiosk shared widgets language', () => {
	afterEach(() => languageStore.setLanguage('th'));

	it('shell: aria labels and header read in English with no Thai', () => {
		const body = inLanguage('en', () =>
			render(KioskShell, {
				props: {
					shelterName: 'Shelter A',
					shelterCode: 'SH001',
					stationName: 'Station 1',
					deviceName: 'Kiosk 1'
				}
			}).body.replace(/<a [^>]*kiosk-language-button[\s\S]*?<\/a>/, '')
		);

		expect(body).toContain(
			'aria-label="Shelter Shelter A SH001 service point Station 1 device Kiosk 1"'
		);
		expect(body).toContain('aria-label="Current time ');
		// The date itself is always th-TH (Buddhist year) by project convention: only check the words.
		expect(body.replace(/aria-label="Current time [^"]*"/, '')).not.toMatch(THAI);
	});

	it('shell: keeps the Thai aria labels in Thai', () => {
		const body = inLanguage(
			'th',
			() =>
				render(KioskShell, {
					props: { shelterName: 'A', shelterCode: 'SH001', stationName: 'S1', deviceName: 'K1' }
				}).body
		);

		expect(body).toContain('aria-label="ศูนย์พักพิง A SH001 จุดบริการ S1 เครื่อง K1"');
		expect(body).toContain('aria-label="เวลาปัจจุบัน ');
	});

	it('back button: visible text and accessible name switch language', () => {
		const en = inLanguage('en', () => render(KioskBackButton, { props: { href: '/kiosk' } }).body);
		const th = inLanguage('th', () => render(KioskBackButton, { props: { href: '/kiosk' } }).body);

		expect(en).toContain('aria-label="Back to start"');
		expect(en).toContain('Back');
		expect(en).not.toMatch(THAI);
		expect(th).toContain('aria-label="กลับหน้าเริ่มต้น"');
		expect(th).toContain('กลับ');
	});

	it('numpad: key labels switch language', () => {
		const en = inLanguage('en', () => render(KioskNumpad, { props: { value: '' } }).body);
		const th = inLanguage('th', () => render(KioskNumpad, { props: { value: '' } }).body);

		expect(en).toContain('aria-label="Number keypad"');
		expect(en).toContain('aria-label="Digit 7"');
		expect(en).toContain('aria-label="Clear all"');
		expect(en).not.toMatch(THAI);
		expect(th).toContain('aria-label="ปุ่มกดตัวเลข"');
		expect(th).toContain('aria-label="ตัวเลข 7"');
		expect(th).toContain('aria-label="ลบหนึ่งตัว"');
	});

	it('lookup error actions: retry countdown and back switch language', () => {
		const props = {
			lookupErrorCode: 'SOMETHING',
			isPhoneGate: false,
			isLookingUp: false,
			retryAfterSeconds: 5,
			homeUrl: '/kiosk',
			backUrl: '/kiosk/qr',
			onretry: () => {},
			onreset: () => {}
		};
		const en = inLanguage('en', () => render(KioskLookupErrorActions, { props }).body);
		const th = inLanguage('th', () => render(KioskLookupErrorActions, { props }).body);

		expect(en).toContain('Try again in');
		expect(en).toContain('seconds');
		expect(en).not.toMatch(THAI);
		expect(th).toContain('ลองอีกครั้งใน');
		expect(th).toContain('วินาที');
	});

	it('staff PIN entry: heading, default description and buttons switch language', () => {
		const props = { onverified: () => {}, oncancel: () => {} };
		const en = inLanguage('en', () => render(KioskStaffPinEntry, { props }).body);
		const th = inLanguage('th', () => render(KioskStaffPinEntry, { props }).body);

		expect(en).toContain('Staff only');
		expect(en).toContain('Confirm');
		expect(en).toContain('PIN entered: 0 of 6 digits');
		expect(en).not.toMatch(THAI);
		expect(th).toContain('สำหรับเจ้าหน้าที่');
		expect(th).toContain('ตรวจบัตรประชาชนกับตัวบุคคลแล้ว กรอก PIN 6 หลักเพื่อดำเนินการต่อ');
		expect(th).toContain('กรอก PIN แล้ว 0 จาก 6 หลัก');
	});

	it('device info trigger: accessible name switches language', () => {
		const en = inLanguage('en', () => render(KioskDeviceInfo).body);
		const th = inLanguage('th', () => render(KioskDeviceInfo).body);

		expect(en).toContain('aria-label="Device info"');
		expect(th).toContain('aria-label="ข้อมูลเครื่อง"');
	});
});
