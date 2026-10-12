import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import KioskRegisterPhone from './kiosk-register-phone.svelte';

const noop = () => {};

/** A `<button>` with the disabled attribute (not Tailwind's `disabled:` classes) labelled `text`. */
function disabledButton(text: string): RegExp {
	return new RegExp(`<button(?=[^>]*\\sdisabled(?:=""|\\s|>))[^>]*>(?:(?!<button)[^])*?${text}`);
}

describe('KioskRegisterPhone', () => {
	it('asks for a contact phone and always offers a way on without one', () => {
		const { body } = render(KioskRegisterPhone, { props: { onconfirm: noop } });

		expect(body).toMatch(/<h1[^>]*id="kiosk-register-phone-title"/);
		expect(body).toContain('เบอร์โทรศัพท์ที่ติดต่อได้');
		expect(body).toContain('ยืนยันเบอร์นี้');
		expect(body).toContain('ไม่มีเบอร์');
	});

	it('keeps confirm disabled until a number is typed, but never the skip', () => {
		const { body } = render(KioskRegisterPhone, { props: { onconfirm: noop } });

		expect(body).toMatch(disabledButton('ยืนยันเบอร์นี้'));
		expect(body).not.toMatch(disabledButton('ไม่มีเบอร์<'));
	});

	it('holds every button while saving', () => {
		const { body } = render(KioskRegisterPhone, { props: { onconfirm: noop, disabled: true } });

		expect(body).toMatch(disabledButton('ไม่มีเบอร์<'));
	});
});
