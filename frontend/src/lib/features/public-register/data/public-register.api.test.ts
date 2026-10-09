import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createBooking,
	createUnassignedRegistration,
	isNetworkError,
	lookupBooking,
	PublicApiError,
	publicFetch,
	uploadShelterBookingPhoto,
	uploadUnassignedPhoto,
	type PublicUnassignedRegistrationPayload
} from './public-register.api';
import { NETWORK_ERROR_MESSAGE, publicBookingErrorMessage } from '../domain/booking';
import { unassignedRegistrationErrorMessage } from '../domain/unassigned-registration';

const payload = {} as PublicUnassignedRegistrationPayload;
const RAW_CODE = /[A-Z]{2,}_[A-Z_]+/;

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function stubFetch(impl: () => Promise<Response>) {
	vi.stubGlobal('fetch', vi.fn(impl));
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (err) {
		return err;
	}
	throw new Error('expected the call to reject');
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('publicFetch network mapping', () => {
	it.each([
		['TypeError: Failed to fetch', new TypeError('Failed to fetch')],
		['AbortError', new DOMException('The operation was aborted', 'AbortError')],
		['plain Error', new Error('socket hang up')]
	])('maps a %s rejection to a NETWORK_ERROR PublicApiError', async (_name, rejection) => {
		stubFetch(() => Promise.reject(rejection));
		const err = await caught(publicFetch('/x'));
		expect(err).toBeInstanceOf(PublicApiError);
		expect((err as PublicApiError).code).toBe('NETWORK_ERROR');
		expect((err as PublicApiError).message).toBe(NETWORK_ERROR_MESSAGE);
		expect((err as PublicApiError).message).not.toMatch(/fetch|abort|socket/i);
		expect(isNetworkError(err)).toBe(true);
	});

	it('passes a successful response through untouched', async () => {
		const res = jsonResponse(200, { ok: true });
		stubFetch(() => Promise.resolve(res));
		await expect(publicFetch('/x')).resolves.toBe(res);
	});

	it('does not flag server errors or foreign errors as network errors', () => {
		expect(isNetworkError(new PublicApiError('WRITE_FAILED', 'x'))).toBe(false);
		expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(false);
		expect(isNetworkError(null)).toBe(false);
	});
});

describe('write endpoints surface a NETWORK_ERROR when the connection drops', () => {
	const calls: [string, () => Promise<unknown>][] = [
		['createUnassignedRegistration', () => createUnassignedRegistration(payload)],
		['createBooking', () => createBooking({} as never)],
		['lookupBooking', () => lookupBooking({} as never)],
		['uploadUnassignedPhoto', () => uploadUnassignedPhoto(new FormData())],
		['uploadShelterBookingPhoto', () => uploadShelterBookingPhoto('S1', new FormData())]
	];

	it.each(calls)('%s', async (_name, call) => {
		stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
		expect(isNetworkError(await caught(call()))).toBe(true);
	});
});

describe('server error responses become one readable PublicApiError', () => {
	const cases: [string, number, unknown, string][] = [
		[
			'409 duplicate identity',
			409,
			{ success: false, error: 'DUPLICATE_OPEN_IDENTITY' },
			unassignedRegistrationErrorMessage('DUPLICATE_OPEN_IDENTITY')
		],
		[
			'422 invalid input with a field message',
			422,
			{
				success: false,
				error: 'INVALID_INPUT',
				details: { formErrors: [], fieldErrors: { a: ['ชื่อไม่ถูกต้อง'] } }
			},
			'ชื่อไม่ถูกต้อง'
		],
		[
			'422 invalid input without details',
			422,
			{ success: false, error: 'INVALID_INPUT' },
			unassignedRegistrationErrorMessage('INVALID_INPUT')
		],
		[
			'429 rate limited',
			429,
			{ success: false, error: 'RATE_LIMITED' },
			unassignedRegistrationErrorMessage('RATE_LIMITED')
		],
		[
			'429 with a non-JSON body (proxy page)',
			429,
			'<html>Too Many Requests</html>',
			unassignedRegistrationErrorMessage('RATE_LIMITED')
		],
		[
			'500 write failed',
			500,
			{ success: false, error: 'WRITE_FAILED' },
			unassignedRegistrationErrorMessage('WRITE_FAILED')
		],
		[
			'502 with a non-JSON body',
			502,
			'<html>Bad gateway</html>',
			unassignedRegistrationErrorMessage('WRITE_FAILED')
		],
		[
			'captcha failure',
			400,
			{ success: false, error: 'CAPTCHA_FAILED' },
			unassignedRegistrationErrorMessage('CAPTCHA_FAILED')
		],
		[
			'unknown server code',
			500,
			{ success: false, error: 'SOMETHING_NEW_AND_INTERNAL' },
			unassignedRegistrationErrorMessage('SOMETHING_NEW_AND_INTERNAL')
		]
	];

	it.each(cases)('unassigned: %s', async (_name, status, body, message) => {
		stubFetch(() =>
			Promise.resolve(
				typeof body === 'string'
					? new Response(body, { status, headers: { 'Content-Type': 'text/html' } })
					: jsonResponse(status, body)
			)
		);
		const err = (await caught(createUnassignedRegistration(payload))) as PublicApiError;
		expect(err).toBeInstanceOf(PublicApiError);
		expect(err.message).toBe(message);
		expect(err.message).not.toMatch(RAW_CODE);
		expect(isNetworkError(err)).toBe(false);
	});

	it('shelter booking: 409 duplicate hold maps to its Thai copy', async () => {
		stubFetch(() =>
			Promise.resolve(jsonResponse(409, { success: false, error: 'DUPLICATE_HOLD' }))
		);
		const err = (await caught(createBooking({} as never))) as PublicApiError;
		expect(err.code).toBe('DUPLICATE_HOLD');
		expect(err.message).toBe(publicBookingErrorMessage('DUPLICATE_HOLD'));
	});

	it('shelter booking: a bare 429 maps to RATE_LIMITED', async () => {
		stubFetch(() => Promise.resolve(new Response('', { status: 429 })));
		const err = (await caught(createBooking({} as never))) as PublicApiError;
		expect(err.code).toBe('RATE_LIMITED');
		expect(err.message).toBe(publicBookingErrorMessage('RATE_LIMITED'));
	});
});

describe('error copy', () => {
	it('has NETWORK_ERROR copy in both domains that says the data is kept', () => {
		expect(publicBookingErrorMessage('NETWORK_ERROR')).toBe(NETWORK_ERROR_MESSAGE);
		expect(unassignedRegistrationErrorMessage('NETWORK_ERROR')).toBe(NETWORK_ERROR_MESSAGE);
		expect(NETWORK_ERROR_MESSAGE).toContain('ข้อมูลที่กรอกยังอยู่ครบ');
	});

	it('never returns a raw code for unknown input', () => {
		expect(publicBookingErrorMessage('WHATEVER_CODE')).not.toContain('WHATEVER_CODE');
		expect(unassignedRegistrationErrorMessage(undefined)).not.toMatch(RAW_CODE);
	});
});
