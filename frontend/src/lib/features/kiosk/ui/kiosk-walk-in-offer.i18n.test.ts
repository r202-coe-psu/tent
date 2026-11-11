import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { languageStore } from '$lib/stores/language.svelte';
import KioskWalkInOffer from './kiosk-walk-in-offer.svelte';

const THAI = /[฀-๿]/;
const props = { isLookingUp: false, retryAfterSeconds: 0, onregister: vi.fn(), onretry: vi.fn() };

describe('KioskWalkInOffer in English', () => {
	afterEach(() => languageStore.setLanguage('th'));

	it('offers to register at the kiosk and to search again', () => {
		languageStore.setLanguage('en');
		const { body } = render(KioskWalkInOffer, { props });

		expect(body).toContain('You can register at this kiosk');
		expect(body).toContain('Register at this kiosk');
		expect(body).toContain('Already pre-registered? Search again');
		expect(body).toContain('please see staff to confirm your details');
		expect(body).not.toMatch(THAI);
	});

	it('names the source of the details: the card, or ThaiD without a photo', () => {
		languageStore.setLanguage('en');
		const card = render(KioskWalkInOffer, { props }).body;
		const thaid = render(KioskWalkInOffer, { props: { ...props, source: 'thaid' } }).body;

		expect(card).toContain('the ID card in the reader');
		expect(thaid).toContain('verified through ThaiD (no photo)');
		expect(card + thaid).not.toMatch(THAI);
	});

	it('shows the wait before searching again, in English', () => {
		languageStore.setLanguage('en');
		const { body } = render(KioskWalkInOffer, { props: { ...props, retryAfterSeconds: 42 } });

		expect(body).toContain('Search again in');
		expect(body).toContain('42');
		expect(body).not.toMatch(THAI);
	});
});
