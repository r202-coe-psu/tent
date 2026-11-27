// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { ZoneOccupancySummary } from '$lib/features/dashboard';
import DashboardZoneSummaryCard from './dashboard-zone-summary-card.svelte';

let instance: ReturnType<typeof mount> | null = null;

function render(summary: ZoneOccupancySummary) {
	instance = mount(DashboardZoneSummaryCard, { target: document.body, props: { summary } });
	flushSync();
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('DashboardZoneSummaryCard', () => {
	it('shows the capacity gauge while at least one zone is open', () => {
		render({
			present: 40,
			capacity: 100,
			available: 60,
			percent: 40,
			level: 'normal',
			zones: { normal: 1, warning: 0, full: 0, closed: 0 }
		});

		expect(document.body.querySelector('[role="img"]')).not.toBeNull();
		expect(document.body.textContent).toContain('ว่างอีก');
	});

	it('shows an empty state instead of a red 0% gauge when every zone is closed', () => {
		render({
			present: 0,
			capacity: 0,
			available: 0,
			percent: 0,
			level: null,
			zones: { normal: 0, warning: 0, full: 0, closed: 2 }
		});

		expect(document.body.querySelector('[role="img"]')).toBeNull();
		expect(document.body.querySelector('.stroke-red-500')).toBeNull();
		expect(document.body.textContent).not.toContain('ว่างอีก');
		expect(document.body.textContent).toContain('ไม่มีโซนที่เปิดอยู่');
	});
});
