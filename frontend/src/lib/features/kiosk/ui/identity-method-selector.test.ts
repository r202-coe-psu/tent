import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import IdentityMethodSelector from './identity-method-selector.svelte';

describe('IdentityMethodSelector', () => {
	it('renders all four method cards in a two-column grid when phone check-in is enabled', () => {
		const result = render(IdentityMethodSelector, {
			props: { contextQuery: '', phoneCheckInEnabled: true, thaidCheckInEnabled: true }
		});

		expect(result.body).toContain('grid-cols-2');
		expect(result.body).toContain('kiosk-portrait:grid-cols-1');
		expect(result.body).toContain('--method-count: 4');
		expect(result.body).toContain('เบอร์โทรศัพท์');
		expect(result.body.match(/class="method-card/g)).toHaveLength(4);
		expect(result.body).not.toContain('data-single-row');
	});

	it('hides the ThaiD card and renders two cards in one row when phone and ThaiD are off', () => {
		const result = render(IdentityMethodSelector, {
			props: { contextQuery: '', phoneCheckInEnabled: false, thaidCheckInEnabled: false }
		});

		expect(result.body).toContain('grid-cols-2');
		expect(result.body).toContain('--method-count: 2');
		expect(result.body).not.toContain('ThaiD');
		expect(result.body.match(/class="method-card/g)).toHaveLength(2);
	});

	it('hides the phone card and renders three cards in one row when disabled', () => {
		const result = render(IdentityMethodSelector, {
			props: {
				contextQuery: '?shelter_code=SH001',
				phoneCheckInEnabled: false,
				thaidCheckInEnabled: true
			}
		});

		expect(result.body).toContain('grid-cols-3');
		expect(result.body).toContain('kiosk-portrait:grid-cols-1');
		expect(result.body).toContain('--method-count: 3');
		expect(result.body).toContain('data-single-row=""');
		expect(result.body).not.toContain('เบอร์โทรศัพท์');
		expect(result.body.match(/class="method-card/g)).toHaveLength(3);
	});
});
