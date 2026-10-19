import { describe, expect, it } from 'vitest';
import { match } from './kioskScreen';

describe('kioskScreen param matcher', () => {
	it('accepts the two screen types', () => {
		expect(match('compact')).toBe(true);
		expect(match('portrait')).toBe(true);
	});

	it('rejects anything else, including the sibling route names', () => {
		for (const value of ['new', '', 'Compact', 'kiosk_banner:a', 'order']) {
			expect(match(value)).toBe(false);
		}
	});
});
