import { describe, expect, it, vi } from 'vitest';
import {
	KIOSK_STAFF_PIN_VERIFY_PATH,
	verifyKioskStaffPin,
	type KioskStaffPinResult
} from './kiosk-staff-pin.api';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('verifyKioskStaffPin', () => {
	it('posts the PIN to the verify endpoint without caching it', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true }));

		await expect(verifyKioskStaffPin('482913', fetchFn)).resolves.toEqual({ kind: 'verified' });

		const [url, init] = fetchFn.mock.calls[0]!;
		expect(url).toBe(KIOSK_STAFF_PIN_VERIFY_PATH);
		expect(init).toMatchObject({ method: 'POST', cache: 'no-store' });
		expect(init?.signal).toBeInstanceOf(AbortSignal);
		expect(JSON.parse(init?.body as string)).toEqual({ pin: '482913' });
	});

	it.each<[string, Response, KioskStaffPinResult]>([
		[
			'a wrong PIN with the tries left',
			json({ error: { code: 'staff_pin_wrong', message: 'x' }, remaining_attempts: 3 }, 401),
			{ kind: 'wrong', remaining: 3 }
		],
		[
			'a lock with the wait',
			json({ error: { code: 'staff_pin_locked', message: 'x' }, retry_after_s: 299 }, 423),
			{ kind: 'locked', retryAfterS: 299 }
		],
		[
			'no PIN set on this kiosk',
			json({ error: { code: 'staff_pin_not_set', message: 'x' } }, 409),
			{ kind: 'not_set' }
		],
		[
			'a device credential failure (401 without a count)',
			json({ error: { code: 'unauthorized', message: 'x' } }, 401),
			{ kind: 'error' }
		],
		[
			'the service down',
			json({ error: { code: 'unavailable', message: 'x' } }, 503),
			{ kind: 'error' }
		],
		['a malformed request', json({ error: { code: 'bad_request' } }, 400), { kind: 'error' }],
		['a 200 that is not ok', json({ ok: false }), { kind: 'error' }],
		['a lock without a wait', json({ error: {} }, 423), { kind: 'error' }],
		['a body that is not JSON', new Response('nope', { status: 401 }), { kind: 'error' }]
	])('maps %s', async (_name, response, expected) => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response);

		await expect(verifyKioskStaffPin('123456', fetchFn)).resolves.toEqual(expected);
	});

	it('turns a network failure or a timeout into an error instead of throwing', async () => {
		const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
		const slow = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

		await expect(verifyKioskStaffPin('123456', offline)).resolves.toEqual({ kind: 'error' });
		await expect(verifyKioskStaffPin('123456', slow)).resolves.toEqual({ kind: 'error' });
	});
});
