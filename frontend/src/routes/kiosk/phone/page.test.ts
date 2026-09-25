import { describe, expect, it } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { load } from './+page';

describe('kiosk phone route load', () => {
	it('redirects to the kiosk home and preserves display context when phone check-in is off', () => {
		const url = new URL(
			'https://tent.example.go.th/kiosk/phone?shelter_name=Shelter%201&shelter_code=SH001&station_name=Desk%201&device_name=Kiosk%201&phone_check_in=off&device_secret=must-not-forward'
		);

		let error: unknown;
		try {
			load({ url } as Parameters<typeof load>[0]);
		} catch (caught) {
			error = caught;
		}

		expect(isRedirect(error)).toBe(true);
		if (!isRedirect(error)) throw new Error('Expected SvelteKit redirect');
		expect(error).toMatchObject({
			status: 307,
			location:
				'/kiosk?shelter_name=Shelter+1&shelter_code=SH001&station_name=Desk+1&device_name=Kiosk+1&phone_check_in=off'
		});
	});

	it('allows the phone page when the flag is on or absent', () => {
		for (const url of [
			new URL('https://tent.example.go.th/kiosk/phone?phone_check_in=on'),
			new URL('https://tent.example.go.th/kiosk/phone')
		]) {
			expect(load({ url } as Parameters<typeof load>[0])).toBeUndefined();
		}
	});
});
