import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { languageStore } from '$lib/stores/language.svelte';
import { kioskLanguageSession } from '$lib/features/kiosk';
import { resetKioskConfigCache } from '$lib/features/kiosk/config';
import { load } from './+layout';

type ConfigResponse = Response | Error;

function configFetch(config: ConfigResponse): typeof fetch {
	return vi
		.fn<typeof fetch>()
		.mockImplementation(() =>
			config instanceof Error ? Promise.reject(config) : Promise.resolve(config.clone())
		);
}

const OPEN = new Response(JSON.stringify({ service_open: true }), { status: 200 });
const CLOSED = new Response(JSON.stringify({ service_open: false }), { status: 200 });

async function visit(path: string, config: ConfigResponse = OPEN): Promise<unknown> {
	try {
		return await load({
			url: new URL(`http://kiosk.test${path}`),
			fetch: configFetch(config)
		} as unknown as Parameters<typeof load>[0]);
	} catch (thrown) {
		return thrown;
	}
}

describe('kiosk layout language gate', () => {
	beforeEach(() => {
		resetKioskConfigCache();
		languageStore.setLanguage('en');
		kioskLanguageSession.markChosen();
	});

	it('sends the first visit of /kiosk to the language page, in Thai, keeping the shelter context', async () => {
		kioskLanguageSession.resetForIdle();
		languageStore.setLanguage('en');

		const result = await visit('/kiosk?shelter_name=A');

		expect(isRedirect(result) && result.location).toBe('/kiosk/language?shelter_name=A');
		expect(languageStore.current).toBe('th');
	});

	it('lets /kiosk open once a language has been chosen', async () => {
		expect(isRedirect(await visit('/kiosk'))).toBe(false);
	});

	it('does not gate other kiosk pages, even before a choice', async () => {
		kioskLanguageSession.resetForIdle();

		expect(isRedirect(await visit('/kiosk/language'))).toBe(false);
		expect(isRedirect(await visit('/kiosk/qr'))).toBe(false);
	});
});

describe('kiosk layout closure gate', () => {
	beforeEach(() => {
		resetKioskConfigCache();
		languageStore.setLanguage('en');
		kioskLanguageSession.markChosen();
	});

	it.each(['/kiosk', '/kiosk/qr', '/kiosk/register/phone', '/kiosk/language'])(
		'when the kiosk is closed, %s redirects (307) to /kiosk/closed keeping only the display query',
		async (path) => {
			const query =
				'shelter_name=A&station_name=B&shelter_code=S1&device_name=D&secret=x&session=y';

			const result = await visit(`${path}?${query}`, CLOSED);

			expect(isRedirect(result) && result.status).toBe(307);
			expect(isRedirect(result) && result.location).toBe(
				'/kiosk/closed?shelter_name=A&shelter_code=S1&station_name=B&device_name=D'
			);
		}
	);

	it('redirects to /kiosk/closed without a query when there is no display context', async () => {
		const result = await visit('/kiosk/qr', CLOSED);

		expect(isRedirect(result) && result.location).toBe('/kiosk/closed');
	});

	it('a closed kiosk on a fresh boot goes to /kiosk/closed, not the language picker', async () => {
		kioskLanguageSession.resetForIdle();

		const result = await visit('/kiosk?shelter_name=A', CLOSED);

		expect(isRedirect(result) && result.location).toBe('/kiosk/closed?shelter_name=A');
	});

	it('does not redirect /kiosk/closed itself while closed', async () => {
		expect(isRedirect(await visit('/kiosk/closed?shelter_name=A', CLOSED))).toBe(false);
	});

	it('an open kiosk still sends a fresh boot to the language picker', async () => {
		kioskLanguageSession.resetForIdle();

		const result = await visit('/kiosk', OPEN);

		expect(isRedirect(result) && result.location).toBe('/kiosk/language');
	});

	it.each([
		['a server error', new Response(null, { status: 503 })],
		['a network failure', new Error('offline')]
	])('an unreadable config (%s) keeps the kiosk open', async (_label, config) => {
		expect(isRedirect(await visit('/kiosk/qr', config))).toBe(false);

		kioskLanguageSession.resetForIdle();
		const fresh = await visit('/kiosk', config);
		expect(isRedirect(fresh) && fresh.location).toBe('/kiosk/language');
	});

	it('after an unreadable config, the next navigations do not wait on another read', async () => {
		const failing = configFetch(new Error('offline'));
		const navigate = (path: string) =>
			load({
				url: new URL(`http://kiosk.test${path}`),
				fetch: failing
			} as unknown as Parameters<typeof load>[0]);

		await navigate('/kiosk/qr');
		await navigate('/kiosk/register/phone');
		await navigate('/kiosk/done');

		expect(failing).toHaveBeenCalledTimes(1);
	});
});
