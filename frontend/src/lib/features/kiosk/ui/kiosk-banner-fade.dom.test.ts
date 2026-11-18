// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { hideOutgoing } from './kiosk-banner-fade';

describe('hideOutgoing', () => {
	it('hides the slide that is fading out from screen readers', () => {
		const img = document.createElement('img');
		img.alt = 'ประกาศเก่า';
		img.addEventListener('outrostart', hideOutgoing);

		img.dispatchEvent(new CustomEvent('outrostart'));

		expect(img.getAttribute('aria-hidden')).toBe('true');
	});
});
