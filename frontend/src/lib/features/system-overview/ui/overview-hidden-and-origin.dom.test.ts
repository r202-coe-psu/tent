// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import OverviewSitesSection from './overview-sites-section.svelte';
import OverviewOriginSection from './overview-origin-section.svelte';
import type { OriginBucket, OverviewSiteRow } from '../domain/schemas';

vi.mock('$lib/features/master-data', () => ({
	useMasterData: () => ({ data: { items: [] } }),
	formatMasterLabelByCode: (code: string) => code
}));

const site = (code: string, publicVisible: boolean): OverviewSiteRow => ({
	shelter_code: code,
	name: `ศูนย์ ${code}`,
	site_kind: 'evacuation_center',
	operation_status: 'active',
	province: null,
	district: null,
	subdistrict: null,
	capacity: 10,
	present: 0,
	forecast: 0,
	pre_registered: 0,
	present_pct: null,
	forecast_pct: null,
	checkin: 0,
	checkout: 0,
	has_coords: false,
	is_external: false,
	public_visible: publicVisible,
	dashboard_href: '/back-office/evacuee-management'
});

let instance: ReturnType<typeof mount> | null = null;

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

async function mountSites(sites: OverviewSiteRow[]) {
	const hiddenTotal = sites.filter((s) => !s.public_visible).length;
	instance = mount(OverviewSitesSection, {
		target: document.body,
		props: {
			sites,
			total: sites.length,
			hiddenTotal,
			movementFrom: '2026-11-01',
			movementTo: '2026-11-14',
			onMovementRangeChange: () => {}
		}
	});
	await tick();
	flushSync();
}

describe('OverviewSitesSection — hidden shelters (#1515)', () => {
	it('marks only the hidden rows and counts them at the head of the table', async () => {
		await mountSites([site('SH001', true), site('SH002', false), site('SH003', false)]);

		const badges = document.body.querySelectorAll('[data-testid="hidden-site-badge"]');
		expect(badges).toHaveLength(2);
		for (const badge of badges) {
			expect(badge.closest('tr')?.textContent).toMatch(/SH00[23]/);
		}
		expect(document.body.querySelector('[data-testid="hidden-sites-count"]')?.textContent).toMatch(
			/2 ศูนย์ จากทั้งหมด 3 ศูนย์/
		);
	});

	it('shows no badge and no count when every shelter is on the public plane', async () => {
		await mountSites([site('SH001', true), site('SH002', true)]);

		expect(document.body.querySelector('[data-testid="hidden-site-badge"]')).toBeNull();
		expect(document.body.querySelector('[data-testid="hidden-sites-count"]')).toBeNull();
	});
});

describe('OverviewOriginSection — source shelter (#1515)', () => {
	it('shows the shelter code of each row, or says the registrants have not chosen one yet', async () => {
		const buckets: OriginBucket[] = [
			{
				province: 'สงขลา',
				district: 'หาดใหญ่',
				subdistrict: 'คอหงส์',
				shelter_code: 'SH001',
				count: 4
			},
			{ province: 'ยะลา', district: null, subdistrict: null, shelter_code: null, count: 2 }
		];
		instance = mount(OverviewOriginSection, { target: document.body, props: { buckets } });
		await tick();
		flushSync();

		const rows = [...document.body.querySelectorAll('tbody tr')].map((tr) => tr.textContent ?? '');
		expect(rows).toHaveLength(2);
		expect(rows[0]).toContain('SH001');
		expect(rows[1]).toContain('ยังไม่ได้เลือกศูนย์');
		expect(document.body.textContent).toContain('ศูนย์');
	});

	it('pages the rows when there are more than one page of them', async () => {
		const onOffsetChange = vi.fn();
		const buckets: OriginBucket[] = Array.from({ length: 2 }, (_, i) => ({
			province: `จังหวัด${i}`,
			district: null,
			subdistrict: null,
			shelter_code: 'SH001',
			count: 1
		}));
		instance = mount(OverviewOriginSection, {
			target: document.body,
			props: { buckets, total: 5, limit: 2, offset: 2, onOffsetChange }
		});
		await tick();
		flushSync();

		expect(document.body.textContent).toContain('แสดง 3 - 4 จาก 5 แถว');
		const next = [...document.body.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === '3'
		);
		next?.click();
		flushSync();
		expect(onOffsetChange).toHaveBeenCalledWith(4);
	});

	it('shows no pager when every row fits on one page', async () => {
		const buckets: OriginBucket[] = [
			{ province: 'ยะลา', district: null, subdistrict: null, shelter_code: null, count: 2 }
		];
		instance = mount(OverviewOriginSection, {
			target: document.body,
			props: { buckets, total: 1, limit: 20, offset: 0, onOffsetChange: vi.fn() }
		});
		await tick();
		flushSync();

		expect(document.body.textContent).not.toContain('จาก 1 แถว');
	});
});
