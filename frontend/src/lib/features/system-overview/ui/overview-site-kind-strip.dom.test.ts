// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { languageStore } from '$lib/stores/language.svelte';
import OverviewSiteKindStrip from './overview-site-kind-strip.svelte';
import type { OverviewSummary } from '../domain/schemas';

const items = [
	{
		code: 'evacuation_center',
		label_th: 'ศูนย์อพยพ',
		label_en: 'Evacuation center',
		status: 'active'
	},
	{ code: 'host_house', label_th: 'บ้านพี่เลี้ยง', label_en: 'Host house', status: 'active' },
	{ code: 'field_camp', label_th: 'ค่ายสนาม', label_en: 'Field camp', status: 'active' },
	{ code: 'old_kind', label_th: 'ประเภทเดิม', label_en: 'Old kind', status: 'inactive' }
];

vi.mock('$lib/features/master-data', async () => {
	const actual = await vi.importActual<
		typeof import('$lib/features/master-data/domain/master-data')
	>('$lib/features/master-data/domain/master-data');
	return {
		formatMasterLabelByCode: actual.formatMasterLabelByCode,
		useMasterData: () => ({ data: { items } })
	};
});

const summary = (kinds: Record<string, number>, external = 0, closedOrCancelled = 0) =>
	({
		sites_total: 5,
		sites_by_site_kind: kinds,
		sites_external: external,
		sites_closed_or_cancelled: closedOrCancelled
	}) as unknown as OverviewSummary;

let instance: ReturnType<typeof mount> | undefined;
function render(s: OverviewSummary) {
	instance = mount(OverviewSiteKindStrip, { target: document.body, props: { summary: s } });
	flushSync();
	return [...document.querySelectorAll('[data-testid="site-kind-strip"] > *')].map((el) =>
		el.textContent?.replace(/\s+/g, ' ').trim()
	);
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
	languageStore.setLanguage('th');
});

describe('OverviewSiteKindStrip (CR-266)', () => {
	it('shows one card per active kind in master order, including zero counts', () => {
		const cards = render(summary({ evacuation_center: 3, host_house: 2 }));
		expect(cards).toEqual([
			'ศูนย์อพยพ 3 ศูนย์',
			'บ้านพี่เลี้ยง 2 ศูนย์',
			'ค่ายสนาม 0 ศูนย์',
			'ศูนย์ภายนอก 0 ศูนย์',
			'ศูนย์ที่ปิด/ยกเลิก 0 ศูนย์'
		]);
	});

	it('appends an inactive kind that still holds shelters', () => {
		const cards = render(summary({ evacuation_center: 4, old_kind: 1 }));
		expect(cards.at(-3)).toBe('ประเภทเดิม 1 ศูนย์');
	});

	it('uses English labels when the language is en', () => {
		languageStore.setLanguage('en');
		const cards = render(summary({ evacuation_center: 5 }));
		expect(cards[0]).toBe('Evacuation center 5 shelters');
	});

	it('shows External shelters as their own card after the kinds, even at 0', () => {
		expect(render(summary({ evacuation_center: 3 }, 2)).at(-2)).toBe('ศูนย์ภายนอก 2 ศูนย์');
	});

	it('shows closed / cancelled shelters as the last card (FR-13a), even at 0', () => {
		expect(render(summary({ evacuation_center: 3 }, 0, 3)).at(-1)).toBe(
			'ศูนย์ที่ปิด/ยกเลิก 3 ศูนย์'
		);
		document.body.innerHTML = '';
		expect(render(summary({ evacuation_center: 3 })).at(-1)).toBe('ศูนย์ที่ปิด/ยกเลิก 0 ศูนย์');
	});

	it('uses English for the closed / cancelled card', () => {
		languageStore.setLanguage('en');
		expect(render(summary({ evacuation_center: 1 }, 0, 2)).at(-1)).toBe(
			'Closed / cancelled shelters 2 shelters'
		);
	});
});
