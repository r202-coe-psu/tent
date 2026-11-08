import { describe, expect, it, vi } from 'vitest';
import { compareLanguages } from '$lib/testing/i18n-parity';
import {
	KioskRequestError,
	type KioskEvacueeSummary,
	type KioskLookupResponse
} from '../data/kiosk-check-in.api';
import { REPRINT_SESSION_I18N } from './reprint-session.i18n';
import { ReprintSession, type ReprintSessionDeps } from './reprint-session.svelte';

function member(id: string, status: string, selectable: boolean): KioskEvacueeSummary {
	return {
		evacuee_id: id,
		first_name: id,
		last_name: 'S',
		gender: null,
		age: null,
		status,
		is_primary: false,
		selectable
	};
}

function household(members: KioskEvacueeSummary[]): KioskLookupResponse {
	return {
		kind: 'household',
		name_masked: true,
		shelter_code: 'SH001',
		primary_evacuee_id: 'EV1',
		members
	};
}

function sessionIn(language: 'th' | 'en', deps: Partial<ReprintSessionDeps>) {
	return new ReprintSession(
		{
			lookup: vi.fn(),
			reprint: vi.fn(),
			print: vi.fn().mockResolvedValue({ kind: 'printed', printed: 1 }),
			...deps
		},
		() => language
	);
}

describe('ReprintSession language', () => {
	it('words a lookup that found nobody in English', async () => {
		const lookup = vi
			.fn<ReprintSessionDeps['lookup']>()
			.mockRejectedValue(new KioskRequestError('x', 404, 'PRE_REGISTRATION_NOT_FOUND'));
		const session = sessionIn('en', { lookup });
		session.phone = '0812345678';

		await session.submitPhone();

		expect(session.error).toBe('No record was found for this phone number');
	});

	it('words a rate limit and a wrong last four in English', async () => {
		const reprint = vi
			.fn<ReprintSessionDeps['reprint']>()
			.mockRejectedValue(new KioskRequestError('x', 403, 'KIOSK_REPRINT_VERIFY_FAILED'));
		const lookup = vi
			.fn<ReprintSessionDeps['lookup']>()
			.mockResolvedValue(household([member('EV1', 'active', true)]));
		const session = sessionIn('en', { lookup, reprint });
		session.phone = '0812345678';
		await session.submitPhone();
		session.toggleMember('EV1');
		session.continueToVerify();
		session.idLast4 = '9999';

		await session.submitVerify();

		expect(session.error).toBe('The last 4 digits are not correct');
	});

	it('keeps a message the server wrote exactly as it came', async () => {
		const lookup = vi
			.fn<ReprintSessionDeps['lookup']>()
			.mockRejectedValue(new KioskRequestError('เชื่อมต่อช้า กรุณาลองอีกครั้ง', 0, 'TIMEOUT'));
		const session = sessionIn('en', { lookup });
		session.phone = '0812345678';

		await session.submitPhone();

		expect(session.error).toBe('เชื่อมต่อช้า กรุณาลองอีกครั้ง');
	});

	it('words a print that could not even render in English', async () => {
		const lookup = vi
			.fn<ReprintSessionDeps['lookup']>()
			.mockResolvedValue(household([member('EV1', 'active', true)]));
		const reprint = vi.fn<ReprintSessionDeps['reprint']>().mockResolvedValue({
			shelter_code: 'SH001',
			members: [
				{
					evacuee_id: 'EV1',
					qr_payload: 'qr',
					label: { name: 'A', phone: null, zone: null, stations_passed: 0 }
				}
			]
		});
		const print = vi.fn<ReprintSessionDeps['print']>().mockRejectedValue(new Error('boom'));
		const session = sessionIn('en', { lookup, reprint, print });
		session.phone = '0812345678';
		await session.submitPhone();
		session.toggleMember('EV1');
		session.continueToVerify();
		session.idLast4 = '1234';

		await session.submitVerify();

		expect(session.error).toBe('Could not create the QR Code to print');
	});

	it('words a blocked household in English, and stays Thai in Thai', async () => {
		const members = [
			member('EV3', 'pre_registered', false),
			member('EV4', 'pre_registered', false)
		];
		const lookup = vi.fn<ReprintSessionDeps['lookup']>().mockResolvedValue(household(members));
		const english = sessionIn('en', { lookup });
		const thai = sessionIn('th', { lookup });
		for (const session of [english, thai]) {
			session.phone = '0812345678';
			await session.submitPhone();
		}

		expect(english.blockedReason).toBe('Not registered yet — use your ID card or ThaiD');
		expect(thai.blockedReason).toBe('ยังไม่ได้ลงทะเบียน — ใช้บัตรประชาชนหรือ ThaiD');
	});
});

describe('REPRINT_SESSION_I18N', () => {
	it('has the same keys in both languages and no Thai in English', () => {
		const { thKeys, enKeys, thaiInEn } = compareLanguages(REPRINT_SESSION_I18N);

		expect(enKeys).toEqual(thKeys);
		expect(thaiInEn).toEqual([]);
	});
});
