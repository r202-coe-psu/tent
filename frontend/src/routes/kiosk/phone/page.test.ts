import { describe, expect, it } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { load } from './+page';

async function redirectFor(href: string): Promise<unknown> {
	try {
		await load({ url: new URL(href), fetch: () => {} } as unknown as Parameters<typeof load>[0]);
	} catch (error) {
		return error;
	}
	return undefined;
}

describe('kiosk phone route load (legacy URL)', () => {
	it('always redirects to the reprint page, keeping the display context only', async () => {
		const caught = await redirectFor(
			'https://tent.example.go.th/kiosk/phone?shelter_name=Shelter%201&shelter_code=SH001&station_name=Desk%201&device_name=Kiosk%201&device_secret=must-not-forward'
		);

		expect(isRedirect(caught)).toBe(true);
		if (!isRedirect(caught)) throw new Error('Expected SvelteKit redirect');
		expect(caught).toMatchObject({
			status: 307,
			location:
				'/kiosk/reprint?shelter_name=Shelter+1&shelter_code=SH001&station_name=Desk+1&device_name=Kiosk+1'
		});
	});

	it('falls back to the default display context when the link carries none', async () => {
		const caught = await redirectFor('https://tent.example.go.th/kiosk/phone');

		expect(isRedirect(caught)).toBe(true);
		if (!isRedirect(caught)) throw new Error('Expected SvelteKit redirect');
		expect(caught).toMatchObject({ status: 307 });
		expect((caught as { location: string }).location).toMatch(/^\/kiosk\/reprint(\?|$)/);
	});
});
