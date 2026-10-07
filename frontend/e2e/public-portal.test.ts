/**
 * Public portal footer — real page, no response mocks, read-only (safe on any target).
 *
 * The LINE OA / Facebook links come from `config:public_portal`; they are exercised end
 * to end in public-portal-faq-crud.test.ts, which edits that document through the admin
 * UI in the same serial file as the FAQ edits (both save the same document).
 *
 * Locators are generated with Playwright codegen (`pnpm exec playwright codegen`).
 */
import { test, expect } from '@playwright/test';

test.describe('Public Portal - Footer contacts', () => {
	test('always shows the 1784 and 1669 emergency numbers', async ({ page }) => {
		await page.goto('/');

		const footer = page.getByRole('contentinfo');
		await expect(footer.getByRole('heading', { name: 'เบอร์ติดต่อฉุกเฉิน' })).toBeVisible();
		await expect(footer.getByRole('link', { name: '1784' })).toHaveAttribute('href', 'tel:1784');
		await expect(footer.getByRole('link', { name: '1669' })).toHaveAttribute('href', 'tel:1669');
	});
});
