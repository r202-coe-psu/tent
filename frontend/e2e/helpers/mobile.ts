/**
 * Phone-layout assertions (#1347): the page must not scroll sideways, and no visible control may
 * sit past either edge — a nowrap row can push a button off the left edge without growing
 * `scrollWidth`, so the width check alone misses it.
 */
import { expect, type Page } from '@playwright/test';

export async function expectFitsViewport(page: Page): Promise<void> {
	const { scrollWidth, clientWidth, offscreen } = await page.evaluate(() => {
		const width = document.documentElement.clientWidth;
		const offscreen = [...document.querySelectorAll('main button, main a, main input')]
			.filter((el) => {
				const box = el.getBoundingClientRect();
				return box.width > 0 && box.height > 0 && (box.left < -1 || box.right > width + 1);
			})
			.map((el) => (el.textContent || el.getAttribute('aria-label') || el.tagName).trim());
		return {
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: width,
			offscreen
		};
	});
	expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
	expect(offscreen, 'controls outside the viewport').toEqual([]);
}

/** Household summary: on a phone the member table becomes cards; restores the viewport after. */
export async function expectMemberCardsOnPhone(page: Page, memberCount: number): Promise<void> {
	const desktop = page.viewportSize();
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.getByTestId('household-member-cards').getByRole('listitem')).toHaveCount(
		memberCount
	);
	await expect(page.locator('table:visible')).toHaveCount(0);
	await expectFitsViewport(page);
	if (desktop) await page.setViewportSize(desktop);
}
