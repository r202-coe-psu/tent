import { afterEach, describe, expect, it, vi } from 'vitest';
import { KioskRequestError } from './kiosk-check-in.api';
import { requestKioskVolunteerCard } from './kiosk-volunteer-card.api';

describe('requestKioskVolunteerCard', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('posts the phone to the volunteer-card endpoint and returns the card', async () => {
		const card = {
			shelter_code: 'SH001',
			volunteer: {
				display_name: 'สมหญิง ใจดี',
				volunteer_code: 'VOL-0001',
				qr_payload: 'volunteer:VOL-0001'
			}
		};
		const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
			void args;
			return new Response(JSON.stringify(card), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchMock);

		expect(await requestKioskVolunteerCard('0812345678')).toEqual(card);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/v1/kiosk/volunteer-card');
		expect(init?.method).toBe('POST');
		expect(init?.cache).toBe('no-store');
		expect(JSON.parse(String(init?.body))).toEqual({ phone: '0812345678' });
	});

	it('maps a 404 to a KioskRequestError with its code and message', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({ error: { code: 'KIOSK_VOLUNTEER_CARD_NOT_FOUND', message: 'm' } }),
						{ status: 404 }
					)
			)
		);

		const error = await requestKioskVolunteerCard('0812345678').catch((e: unknown) => e);
		expect(error).toBeInstanceOf(KioskRequestError);
		expect(error).toMatchObject({
			status: 404,
			code: 'KIOSK_VOLUNTEER_CARD_NOT_FOUND',
			message: 'm'
		});
	});

	it('maps a 429 to KIOSK_RATE_LIMITED', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: { code: 'KIOSK_RATE_LIMITED', message: 'slow' } }), {
						status: 429
					})
			)
		);

		await expect(requestKioskVolunteerCard('0812345678')).rejects.toMatchObject({
			status: 429,
			code: 'KIOSK_RATE_LIMITED'
		});
	});
});
