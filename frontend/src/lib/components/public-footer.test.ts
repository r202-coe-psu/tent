import { describe, it, expect, vi } from 'vitest';
import { render } from 'svelte/server';
import PublicFooter from './public-footer.svelte';

vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

vi.mock('$app/state', () => ({
	page: {
		data: {}
	}
}));

describe('PublicFooter (#398 Verification)', () => {
	it('does NOT render online channels column when configData is empty', () => {
		const result = render(PublicFooter, {
			props: {
				configData: {}
			}
		});

		// Check that online channels header is NOT rendered
		expect(result.body).not.toContain('ช่องทางออนไลน์ด่วน');
		expect(result.body).not.toContain('LINE Official');
		expect(result.body).not.toContain('Facebook');

		// Check that branding and emergency numbers are rendered
		expect(result.body).toContain('Smart Shelter Platform');
		expect(result.body).toContain('1784');
		expect(result.body).toContain('1669');

		// Check grid layout classes: Column 1 is 7 cols and Column 2 is 5 cols
		expect(result.body).toContain('md:col-span-7');
		expect(result.body).toContain('md:col-span-5');
	});

	it('does NOT render online channels column when configData is omitted / undefined', () => {
		const result = render(PublicFooter);

		expect(result.body).not.toContain('ช่องทางออนไลน์ด่วน');
		expect(result.body).toContain('Smart Shelter Platform');
		expect(result.body).toContain('md:col-span-7');
		expect(result.body).toContain('md:col-span-5');
	});

	it('renders online channels column when line_oa_url or facebook_url is provided', () => {
		const result = render(PublicFooter, {
			props: {
				configData: {
					line_oa_url: 'https://line.me/R/ti/p/@smartshelter',
					facebook_url: 'https://facebook.com/smartshelter'
				}
			}
		});

		// Should show online channels column
		expect(result.body).toContain('ช่องทางออนไลน์ด่วน');
		expect(result.body).toContain('https://line.me/R/ti/p/@smartshelter');
		expect(result.body).toContain('https://facebook.com/smartshelter');

		// Grid layout adjusts to 3 columns (5 : 4 : 3)
		expect(result.body).toContain('md:col-span-5');
		expect(result.body).toContain('md:col-span-4');
		expect(result.body).toContain('md:col-span-3');
	});

	it('renders online channels column if only LINE OA is provided', () => {
		const result = render(PublicFooter, {
			props: {
				configData: {
					line_oa_url: 'https://line.me/R/ti/p/@smartshelter'
				}
			}
		});

		expect(result.body).toContain('ช่องทางออนไลน์ด่วน');
		expect(result.body).toContain('https://line.me/R/ti/p/@smartshelter');
		expect(result.body).not.toContain('facebook.com');
	});

	it('renders online channels column if only Facebook is provided', () => {
		const result = render(PublicFooter, {
			props: {
				configData: {
					facebook_url: 'https://facebook.com/smartshelter'
				}
			}
		});

		expect(result.body).toContain('ช่องทางออนไลน์ด่วน');
		expect(result.body).toContain('https://facebook.com/smartshelter');
		expect(result.body).not.toContain('line.me');
	});
});
