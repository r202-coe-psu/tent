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

	it.each([
		{
			name: 'both LINE OA and Facebook',
			configData: {
				line_oa_url: 'https://line.me/R/ti/p/@smartshelter',
				facebook_url: 'https://facebook.com/smartshelter'
			}
		},
		{
			name: 'LINE OA only',
			configData: { line_oa_url: 'https://line.me/R/ti/p/@smartshelter' }
		},
		{
			name: 'Facebook only',
			configData: { facebook_url: 'https://facebook.com/smartshelter' }
		}
	])(
		'never renders the online channels column (removed in #398), even when LINE OA / Facebook URLs are configured ($name)',
		({ configData }) => {
			const result = render(PublicFooter, { props: { configData } });

			expect(result.body).not.toContain('ช่องทางออนไลน์ด่วน');
			expect(result.body).not.toContain('line.me');
			expect(result.body).not.toContain('facebook.com');
			expect(result.body).toContain('Smart Shelter Platform');
		}
	);
});
