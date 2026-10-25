import { describe, expect, it, vi } from 'vitest';
import { KioskRequestError } from '../data/kiosk-check-in.api';
import { abandonWalkIn, registerWalkInCardRead, submitWalkInThaid } from './walk-in-registration';
import { createWalkInSession } from './walk-in-session.svelte';

const session = {
	citizenId: '1234567890123',
	consented: true,
	consentedAt: new Date().toISOString()
};
const card = { citizen_id: '1234567890123' } as never;
const registration = {
	evacuee_id: 'evacuee:01',
	qr_payload: 'qr-payload',
	label: { name: 'สมชาย ใจดี', phone: '0812345678' }
};

describe('registerWalkInCardRead', () => {
	it('rejects a different card without submitting it', async () => {
		const register = vi.fn();

		await expect(
			registerWalkInCardRead({ citizen_id: '9999999999999' } as never, session, register)
		).resolves.toMatchObject({ kind: 'mismatch' });
		expect(register).not.toHaveBeenCalled();
	});

	it('allows retry after registration failure', async () => {
		const register = vi
			.fn()
			.mockRejectedValueOnce(new Error('บริการไม่พร้อมใช้งาน'))
			.mockResolvedValueOnce(registration);

		await expect(registerWalkInCardRead(card, session, register)).resolves.toMatchObject({
			kind: 'error',
			message: 'บริการไม่พร้อมใช้งาน'
		});
		await expect(registerWalkInCardRead(card, session, register)).resolves.toEqual({
			kind: 'registered',
			registration
		});
		expect(register).toHaveBeenCalledTimes(2);
	});

	it('tells a phone already in use apart from a failure worth retrying', async () => {
		const register = vi
			.fn()
			.mockRejectedValue(
				new KioskRequestError('เบอร์โทรศัพท์นี้ถูกใช้ลงทะเบียนแล้ว', 409, 'KIOSK_PHONE_DUPLICATE')
			);
		await expect(registerWalkInCardRead(card, session, register)).resolves.toEqual({
			kind: 'phone_duplicate',
			message: 'เบอร์โทรศัพท์นี้ถูกใช้ลงทะเบียนแล้ว'
		});
	});
});

describe('submitWalkInThaid', () => {
	const thaidSession = {
		thaidSessionId: 'a'.repeat(32),
		consented: true,
		consentedAt: new Date().toISOString(),
		phone: '0812345678'
	};

	it('sends the session id, consent time and phone', async () => {
		const register = vi.fn().mockResolvedValue(registration);
		await expect(submitWalkInThaid(thaidSession, register)).resolves.toEqual({
			kind: 'registered',
			registration
		});
		expect(register).toHaveBeenCalledWith(
			'a'.repeat(32),
			thaidSession.consentedAt,
			'0812345678',
			null
		);
	});

	it('carries the scan time as the Station 1 start (CR-192)', async () => {
		const register = vi.fn().mockResolvedValue(registration);
		const startedAt = '2026-10-25T03:00:00.000Z';
		await submitWalkInThaid({ ...thaidSession, startedAt }, register);
		expect(register).toHaveBeenCalledWith(
			'a'.repeat(32),
			thaidSession.consentedAt,
			'0812345678',
			startedAt
		);
	});

	it('does nothing before consent', async () => {
		const register = vi.fn();
		await expect(
			submitWalkInThaid({ ...thaidSession, consented: false }, register)
		).resolves.toEqual({ kind: 'ignored' });
		expect(register).not.toHaveBeenCalled();
	});

	it('tells an expired scan apart from a failure worth retrying', async () => {
		const expired = vi
			.fn()
			.mockRejectedValue(
				new KioskRequestError('กรุณาสแกนใหม่', 409, 'KIOSK_THAID_SESSION_INVALID')
			);
		await expect(submitWalkInThaid(thaidSession, expired)).resolves.toEqual({
			kind: 'expired',
			message: 'กรุณาสแกนใหม่'
		});

		const down = vi.fn().mockRejectedValue(new KioskRequestError('ลองใหม่', 503, null));
		await expect(submitWalkInThaid(thaidSession, down)).resolves.toEqual({
			kind: 'error',
			message: 'ลองใหม่'
		});
	});

	it('tells a phone already in use apart from a failure worth retrying', async () => {
		const register = vi
			.fn()
			.mockRejectedValue(
				new KioskRequestError('เบอร์โทรศัพท์นี้ถูกใช้ลงทะเบียนแล้ว', 409, 'KIOSK_PHONE_DUPLICATE')
			);
		await expect(submitWalkInThaid(thaidSession, register)).resolves.toEqual({
			kind: 'phone_duplicate',
			message: 'เบอร์โทรศัพท์นี้ถูกใช้ลงทะเบียนแล้ว'
		});
	});
});

describe('abandonWalkIn', () => {
	it('burns a handed-over ThaiD scan and forgets the walk-in', () => {
		const session = createWalkInSession();
		session.beginThaid('a'.repeat(32));
		const cancel = vi.fn().mockResolvedValue(undefined);

		abandonWalkIn(session, cancel);

		expect(cancel).toHaveBeenCalledWith('a'.repeat(32));
		expect(session.active).toBe(false);
	});

	it('only forgets a card walk-in', () => {
		const session = createWalkInSession();
		session.begin('1234567890123');
		const cancel = vi.fn();

		abandonWalkIn(session, cancel);

		expect(cancel).not.toHaveBeenCalled();
		expect(session.citizenId).toBeNull();
	});
});
