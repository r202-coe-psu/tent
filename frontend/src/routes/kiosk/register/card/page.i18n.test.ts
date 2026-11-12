import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { languageStore } from '$lib/stores/language.svelte';
import CardPage from './+page.svelte';

vi.mock('$app/state', () => ({ page: { url: new URL('http://kiosk.test/kiosk/register/card') } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const THAI = /[฀-๿]/;

describe('kiosk register card page language', () => {
	afterEach(() => languageStore.setLanguage('th'));

	it('keeps the Thai title and instruction', () => {
		const { body, head } = render(CardPage);

		expect(body).toContain('เสียบบัตรประชาชน');
		expect(body).toContain('ระบบจะอ่านข้อมูลจากชิปโดยอัตโนมัติ');
		expect(head).toContain('เสียบบัตรประชาชน — SmartShelter Kiosk');
	});

	it('asks for the ID card in English', () => {
		languageStore.setLanguage('en');
		const { body, head } = render(CardPage);

		expect(body).toContain('Insert your ID card');
		expect(body).toContain('The kiosk reads the chip automatically.');
		expect(body).toContain('Read card');
		expect(body).toContain('Cancel');
		expect(head).toContain('Insert ID card — SmartShelter Kiosk');
		// The wizard header and back button are shared components with their own tests.
		expect(body.slice(body.indexOf('Insert your ID card'))).not.toMatch(THAI);
		expect(head).not.toMatch(THAI);
	});
});
