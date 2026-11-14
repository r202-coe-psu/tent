import { describe, expect, it } from 'vitest';
import { KioskRequestError } from './kiosk-check-in.api';
import { KioskThaidError } from './kiosk-thaid.api';
import { isKioskClosedError } from './kiosk-closed';

describe('isKioskClosedError', () => {
	it.each([
		['a kiosk request answered 403 KIOSK_CLOSED', new KioskRequestError('x', 403, 'KIOSK_CLOSED')],
		['a ThaiD request answered 403 KIOSK_CLOSED', new KioskThaidError(403, 'KIOSK_CLOSED')],
		['any error carrying the code', Object.assign(new Error('x'), { code: 'KIOSK_CLOSED' })]
	])('is true for %s', (_name, error) => {
		expect(isKioskClosedError(error)).toBe(true);
	});

	it.each([
		['the method-disabled refusal', new KioskRequestError('x', 403, 'KIOSK_METHOD_DISABLED')],
		['a refusal without a code', new KioskRequestError('x', 403, null)],
		['a plain error', new Error('KIOSK_CLOSED')],
		['a non-error', null]
	])('is false for %s', (_name, error) => {
		expect(isKioskClosedError(error)).toBe(false);
	});
});
