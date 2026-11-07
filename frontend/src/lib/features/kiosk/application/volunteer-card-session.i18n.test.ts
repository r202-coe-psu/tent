import { afterEach, describe, expect, it, vi } from 'vitest';
import { languageStore } from '$lib/stores/language.svelte';
import { KioskRequestError } from '../data/kiosk-check-in.api';
import type { KioskVolunteerCardResult } from '../data/kiosk-volunteer-card.api';
import { VolunteerCardSession } from './volunteer-card-session.svelte';

const THAI = /[฀-๿]/;
const FOUND: KioskVolunteerCardResult = {
	shelter_code: 'SH001',
	volunteer: { display_name: 'Somchai', volunteer_code: 'VOL-0042', qr_payload: 'qr-vol-42' }
};

async function failedLookup(error: unknown): Promise<string> {
	const session = new VolunteerCardSession({
		lookup: vi.fn().mockRejectedValue(error),
		print: vi.fn()
	});
	session.phone = '0812345678';
	await session.submitPhone();
	return session.error;
}

describe('VolunteerCardSession messages', () => {
	afterEach(() => languageStore.setLanguage('th'));

	it('says why a lookup failed in English', async () => {
		languageStore.setLanguage('en');

		const notFound = await failedLookup(
			new KioskRequestError('x', 404, 'KIOSK_VOLUNTEER_CARD_NOT_FOUND')
		);
		const limited = await failedLookup(new KioskRequestError('x', 429, 'KIOSK_RATE_LIMITED'));
		const disabled = await failedLookup(new KioskRequestError('x', 403, 'KIOSK_METHOD_DISABLED'));
		const generic = await failedLookup(new Error('boom'));

		expect(notFound).toBe('No volunteer with this number at this shelter. Please see staff');
		expect(limited).toBe('Too many wrong tries. Please wait a moment or see staff');
		expect(disabled).toBe('This option is turned off. Please see staff');
		expect(generic).toBe('Something went wrong. Please try again');
		expect(notFound + limited + disabled + generic).not.toMatch(THAI);
	});

	it('says in English when the print QR could not be made', async () => {
		languageStore.setLanguage('en');
		const session = new VolunteerCardSession({
			lookup: vi.fn().mockResolvedValue(FOUND),
			print: vi.fn().mockRejectedValue(new Error('render'))
		});
		session.phone = '0812345678';
		await session.submitPhone();

		await session.confirmPrint();

		expect(session.step).toBe('print_failed');
		expect(session.error).toBe('Could not create the QR code to print');
	});

	it('keeps Thai when the kiosk language is Thai', async () => {
		expect(await failedLookup(new Error('boom'))).toBe('ระบบไม่สามารถทำรายการได้ กรุณาลองอีกครั้ง');
	});
});
