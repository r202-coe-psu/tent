import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import KioskCardInsertScene from './kiosk-card-insert-scene.svelte';

describe('KioskCardInsertScene', () => {
	it('is decorative: the instruction lives in the page text, not in the picture', () => {
		const { body } = render(KioskCardInsertScene);

		expect(body).toContain('aria-hidden="true"');
		expect(body).not.toContain('role="img"');
	});

	it('sizes the card per screen profile from a single width variable', () => {
		const { body } = render(KioskCardInsertScene);

		expect(body).toContain('[--w:13.9rem]');
		expect(body).toContain('kiosk-portrait:[--w:27rem]');
	});
});
