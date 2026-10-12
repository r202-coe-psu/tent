/**
 * Helpers shared by the distribution desk suites (distribution-desk-*.test.ts).
 * Helpers used by one suite only live at the top of that suite.
 */

import { seedItemWithStock, type DistributionScenario, type SeededItem } from './distribution';
import type { DeskPage, DeskTab } from './pages/desk.page';

/** README §3: one layer tag + the feature tag, inherited by every test of a suite. */
export const DESK_TAGS = ['@critical', '@distribution'];

/** A plain consumable item with 20 in stock, named after the scenario. */
export async function consumable(
	scenario: DistributionScenario,
	label: string
): Promise<SeededItem> {
	return seedItemWithStock(scenario, {
		name: `E2E ${label} ${scenario.namespace}`,
		stockQty: '20',
		returnable: false,
		typeClass: 'CONSUMABLE'
	});
}

/** Number in a tab badge ("รอรับ N", "เปิดแจก N"); 0 when the badge is absent. */
export async function tabBadge(desk: DeskPage, tab: DeskTab, pattern: RegExp): Promise<number> {
	return Number(((await desk.tab(tab).textContent()) ?? '').match(pattern)?.[1] ?? 0);
}
