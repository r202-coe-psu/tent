import { afterEach, describe, expect, it, vi } from 'vitest';
import { languageStore } from '$lib/stores/language.svelte';
import { mintConsentStamp, type ConsentDecision } from '$lib/features/consent/server';
import { KioskRequestError } from '../data/kiosk-check-in.api';
import {
	registerWalkInCardRead,
	submitWalkInThaid,
	THAID_CONSENT_EXPIRED_MESSAGE,
	walkInCardMismatch
} from './walk-in-registration';

const THAI = /[฀-๿]/;
const decision: ConsentDecision = {
	mode: 'full',
	health: false,
	search_visible: true,
	guardian_for: [],
	verbal: false,
	...mintConsentStamp()
};
const card = { citizen_id: '1234567890123' } as never;
const session = { citizenId: '1234567890123', consentDecision: decision };
const thaidSession = { thaidSessionId: 'a'.repeat(32), consentDecision: decision, phone: null };

describe('walk-in registration messages', () => {
	afterEach(() => languageStore.setLanguage('th'));

	it('tells a wrong card apart in English when asked for English', () => {
		const message = walkInCardMismatch({ citizen_id: '9' } as never, session, 'en');

		expect(message).toBe(
			'This is not the card you searched with. Please insert the original card or see staff'
		);
		expect(walkInCardMismatch({ citizen_id: '9' } as never, session, 'th')).toContain('บัตรไม่ตรง');
	});

	it('follows the kiosk language when none is given', () => {
		languageStore.setLanguage('en');

		expect(walkInCardMismatch({ citizen_id: '9' } as never, session)).not.toMatch(THAI);
	});

	it('words a failed card read in English', async () => {
		const register = vi.fn().mockRejectedValue('boom');

		await expect(registerWalkInCardRead(card, session, register, 'en')).resolves.toEqual({
			kind: 'error',
			message: 'Could not read the data. Please try again'
		});
	});

	it('words a failed ThaiD registration, and the expired consent restart, in English', async () => {
		const failing = vi.fn().mockRejectedValue('boom');
		const expired = vi
			.fn()
			.mockRejectedValue(new KioskRequestError('x', 410, 'KIOSK_CONSENT_EXPIRED'));

		const error = await submitWalkInThaid(thaidSession, failing, 'en');
		const restart = await submitWalkInThaid(thaidSession, expired, 'en');

		expect(error).toEqual({ kind: 'error', message: 'Registration failed. Please try again' });
		expect(restart.kind).toBe('thaid_restart');
		expect('message' in restart ? restart.message : '').toBe(
			'Consent and ThaiD verification timed out. Please scan ThaiD again'
		);
		expect(THAID_CONSENT_EXPIRED_MESSAGE).toMatch(THAI);
	});

	it('words the server-coded walk-in errors in English instead of the server Thai', async () => {
		const reject = (code: string) =>
			vi.fn().mockRejectedValue(new KioskRequestError('ข้อความจาก server', 409, code));

		const duplicate = await registerWalkInCardRead(
			card,
			session,
			reject('KIOSK_PHONE_DUPLICATE'),
			'en'
		);
		const consent = await registerWalkInCardRead(
			card,
			session,
			reject('KIOSK_CONSENT_EXPIRED'),
			'en'
		);
		const expired = await submitWalkInThaid(
			thaidSession,
			reject('KIOSK_THAID_SESSION_INVALID'),
			'en'
		);
		const thaidDuplicate = await submitWalkInThaid(
			thaidSession,
			reject('KIOSK_PHONE_DUPLICATE'),
			'en'
		);

		expect(duplicate).toEqual({
			kind: 'phone_duplicate',
			message: 'This phone number is already registered. Enter another number or tap "No phone"'
		});
		expect(consent).toEqual({
			kind: 'consent_expired',
			message: 'Your consent timed out. Please give consent again'
		});
		expect(expired).toEqual({
			kind: 'expired',
			message: 'ThaiD verification expired or is not valid. Please scan again'
		});
		expect(thaidDuplicate.kind).toBe('phone_duplicate');
		expect('message' in thaidDuplicate ? thaidDuplicate.message : '').not.toMatch(THAI);
	});

	it('keeps the server wording for coded walk-in errors in Thai', async () => {
		const duplicate = await registerWalkInCardRead(
			card,
			session,
			vi
				.fn()
				.mockRejectedValue(
					new KioskRequestError('ข้อความจาก server', 409, 'KIOSK_PHONE_DUPLICATE')
				),
			'th'
		);

		expect(duplicate).toEqual({ kind: 'phone_duplicate', message: 'ข้อความจาก server' });
	});
});
