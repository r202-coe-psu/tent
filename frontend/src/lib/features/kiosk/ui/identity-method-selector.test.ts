import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import IdentityMethodSelector from './identity-method-selector.svelte';

describe('IdentityMethodSelector', () => {
	it('renders all four method cards in a two-column grid when phone check-in is enabled', () => {
		const result = render(IdentityMethodSelector, {
			props: { contextQuery: '', phoneCheckInEnabled: true }
		});

		expect(result.body).toContain('grid-cols-2');
		expect(result.body).toContain('เบอร์โทรศัพท์');
		expect(result.body.match(/class="method-card/g)).toHaveLength(4);
		expect(result.body).not.toContain('data-single-row');
	});

	it('hides the phone card and renders three cards in one row when disabled', () => {
		const result = render(IdentityMethodSelector, {
			props: { contextQuery: '?phone_check_in=off', phoneCheckInEnabled: false }
		});

		expect(result.body).toContain('grid-cols-3');
		expect(result.body).toContain('data-single-row=""');
		expect(result.body).not.toContain('เบอร์โทรศัพท์');
		expect(result.body.match(/class="method-card/g)).toHaveLength(3);
	});
});
