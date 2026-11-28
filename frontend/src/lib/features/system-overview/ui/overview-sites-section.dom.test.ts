// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import OverviewSitesSection from './overview-sites-section.svelte';
import type { OverviewSiteRow } from '../domain/schemas';

vi.mock('$lib/features/master-data', () => ({
	formatMasterLabelByCode: (code: string) => code,
	useMasterData: () => ({ data: undefined })
}));
vi.mock('$lib/states/i18n.svelte', () => ({ langState: { current: 'th' } }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));

const row = (over: Partial<OverviewSiteRow>): OverviewSiteRow => ({
	shelter_code: 'SH001',
	name: 'ศูนย์ทดสอบ',
	site_kind: 'evacuation_center',
	operation_status: 'active',
	province: null,
	district: null,
	subdistrict: null,
	capacity: 10,
	present: 0,
	forecast: 0,
	pre_registered: 0,
	present_pct: 0,
	forecast_pct: 0,
	checkin: 0,
	checkout: 0,
	has_coords: false,
	is_external: false,
	public_visible: true,
	dashboard_href: '/back-office/evacuee-management?shelter=SH001',
	...over
});

let instance: ReturnType<typeof mount> | null = null;

async function render(
	sites: OverviewSiteRow[],
	paging: { total?: number; limit?: number; offset?: number } = {}
) {
	const onOffsetChange = vi.fn();
	instance = mount(OverviewSitesSection, {
		target: document.body,
		props: {
			sites,
			movementFrom: '2026-11-01',
			movementTo: '2026-11-02',
			onMovementRangeChange: () => {},
			onOffsetChange,
			...paging
		}
	});
	await tick();
	flushSync();
	return onOffsetChange;
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('OverviewSitesSection rows', () => {
	it('labels an unknown status as ไม่ทราบสถานะ', async () => {
		await render([row({ operation_status: 'unknown' })]);
		expect(document.body.textContent).toContain('ไม่ทราบสถานะ');
	});

	it('shows the external badge after the shelter code only for external shelters', async () => {
		await render([
			row({ shelter_code: 'SH070', is_external: true }),
			row({ shelter_code: 'SH001', name: 'ในระบบ', is_external: false })
		]);
		const text = document.body.textContent ?? '';
		expect(text.match(/ศูนย์อพยพภายนอก/g)).toHaveLength(1);
		expect(text).toContain('SH070');
	});
});

describe('OverviewSitesSection paging', () => {
	it('shows the range, marks the current page and disables Previous on page 1', async () => {
		const onChange = await render([row({})], { total: 9, limit: 4, offset: 0 });
		expect(document.body.textContent).toContain('แสดง 1 - 4 จาก 9 แห่ง');
		expect(document.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe('1');
		expect(document.querySelector('[aria-label="ไปหน้าก่อนหน้า"]')?.hasAttribute('disabled')).toBe(
			true
		);
		(document.querySelector('[aria-label="ไปหน้าถัดไป"]') as HTMLElement).click();
		await tick();
		expect(onChange).toHaveBeenCalledWith(4);
	});

	it('clamps the range end and disables Next on the last page', async () => {
		const onChange = await render([row({})], { total: 9, limit: 4, offset: 8 });
		expect(document.body.textContent).toContain('แสดง 9 - 9 จาก 9 แห่ง');
		expect(document.querySelector('[aria-label="ไปหน้าถัดไป"]')?.hasAttribute('disabled')).toBe(
			true
		);
		(document.querySelector('[aria-label="ไปหน้าก่อนหน้า"]') as HTMLElement).click();
		await tick();
		expect(onChange).toHaveBeenCalledWith(4);
	});

	it('hides the pager when everything fits on one page', async () => {
		await render([row({})], { total: 3, limit: 4, offset: 0 });
		expect(document.querySelector('[aria-label="ไปหน้าถัดไป"]')).toBeNull();
	});
});
