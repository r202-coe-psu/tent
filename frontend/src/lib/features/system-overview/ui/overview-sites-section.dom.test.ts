// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { languageStore } from '$lib/stores/language.svelte';
import OverviewSitesSection from './overview-sites-section.svelte';
import type { OverviewSiteRow } from '../domain/schemas';

vi.mock('$lib/features/master-data', () => ({
	formatMasterLabelByCode: (code: string) => code,
	useMasterData: () => ({ data: { items: [] } })
}));

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
	dashboard_href: '/back-office/evacuee-management?shelter=SH001',
	...over
});

let instance: ReturnType<typeof mount> | undefined;
function render(sites: OverviewSiteRow[]) {
	instance = mount(OverviewSitesSection, {
		target: document.body,
		props: {
			sites,
			movementFrom: '2026-11-01',
			movementTo: '2026-11-02',
			onMovementRangeChange: () => {}
		}
	});
	flushSync();
	return document.body.textContent ?? '';
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
	languageStore.setLanguage('th');
});

describe('OverviewSitesSection rows', () => {
	it('labels an unknown status as ไม่ทราบสถานะ', () => {
		expect(render([row({ operation_status: 'unknown' })])).toContain('ไม่ทราบสถานะ');
	});

	it('shows the external badge after the shelter code only for external shelters', () => {
		const text = render([
			row({ shelter_code: 'SH070', is_external: true }),
			row({ shelter_code: 'SH001', name: 'ในระบบ', is_external: false })
		]);
		expect(text.match(/ศูนย์อพยพภายนอก/g)).toHaveLength(1);
		expect(text).toContain('SH070');
	});
});
