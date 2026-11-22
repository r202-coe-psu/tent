// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import MapFilterOverlay from './map-filter-overlay.svelte';
import type { ActiveFilterChip } from '../domain/active-filters';

const lang = vi.hoisted(() => ({ current: 'th' }));
vi.mock('$lib/states/i18n.svelte', () => ({ langState: lang }));

let component: ReturnType<typeof mount> | undefined;

const radius: ActiveFilterChip = {
	key: 'radius',
	label: 'ระยะ 5 กม.',
	removes: ['distance'],
	counts: false
};
const search: ActiveFilterChip = {
	key: 'search',
	label: 'ค้นหา: "ไม่มีจริง"',
	removes: ['q'],
	counts: true
};

function render(chips: ActiveFilterChip[], resultCount: number) {
	const h = {
		onRemove: vi.fn(),
		onClearAll: vi.fn(),
		onExpandRadius: vi.fn(),
		onClearPosition: vi.fn()
	};
	component = mount(MapFilterOverlay, {
		target: document.body,
		props: { chips, resultCount, radiusKm: '5', ...h }
	});
	flushSync();
	return h;
}

const button = (name: string) =>
	[...document.body.querySelectorAll('button')].find(
		(b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name
	);

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.innerHTML = '';
	lang.current = 'th';
});

describe('MapFilterOverlay — desktop, list panel collapsed (#1419)', () => {
	it('with nothing found inside the radius: says why and offers both ways out', () => {
		const h = render([radius], 0);
		const text = document.body.textContent ?? '';
		expect(text).toContain('ไม่มีศูนย์ในรัศมี 5 กม. จากตำแหน่งนี้');
		expect(button('เอา ระยะ 5 กม. ออก')).toBeDefined();
		button('ล้างตำแหน่ง')!.click();
		expect(h.onClearPosition).toHaveBeenCalledOnce();
		button('ขยายรัศมี')!.click();
		expect(h.onExpandRadius).toHaveBeenCalledOnce();
	});

	it('with nothing found under a search: the chips, "clear all" and "clear filters" all clear', () => {
		const h = render([radius, search], 0);
		expect(document.body.textContent).toContain('ไม่พบศูนย์ที่ตรงกับตัวกรอง');
		button('ล้างตัวกรอง')!.click();
		button('ล้างทั้งหมด')!.click();
		expect(h.onClearAll).toHaveBeenCalledTimes(2);
		button('เอา ค้นหา: "ไม่มีจริง" ออก')!.click();
		expect(h.onRemove).toHaveBeenCalledWith(search);
	});

	it('with shelters found: only the chips, no empty-state message', () => {
		render([radius, search], 7);
		expect(button('เอา ค้นหา: "ไม่มีจริง" ออก')).toBeDefined();
		expect(document.body.textContent).not.toContain('ไม่พบศูนย์');
	});

	it('is a labelled region so it can be found on the map', () => {
		render([radius], 0);
		const region = document.body.querySelector('[data-testid="map-filter-overlay"]');
		expect(region).not.toBeNull();
		expect(region!.getAttribute('aria-label')).toBe('ตัวกรองที่ใช้อยู่');
	});
});
