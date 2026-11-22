// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ShelterListEmpty from './shelter-list-empty.svelte';
import type { EmptyListReason } from '../domain/active-filters';

const lang = vi.hoisted(() => ({ current: 'th' }));
vi.mock('$lib/states/i18n.svelte', () => ({ langState: lang }));

let component: ReturnType<typeof mount> | undefined;

function render(reason: EmptyListReason, radiusKm = '5') {
	const handlers = {
		onExpandRadius: vi.fn(),
		onClearPosition: vi.fn(),
		onClearFilters: vi.fn()
	};
	component = mount(ShelterListEmpty, {
		target: document.body,
		props: { reason, radiusKm, ...handlers }
	});
	flushSync();
	return handlers;
}

const buttons = () =>
	[...document.body.querySelectorAll('button')].map((b) => b.textContent?.trim());
const button = (name: string) =>
	[...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)!;

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.innerHTML = '';
	lang.current = 'th';
});

describe('ShelterListEmpty (#1419)', () => {
	it('says the radius is why, and offers to widen it or forget the location', () => {
		const h = render('radius', '5');
		expect(document.body.textContent).toContain('ไม่มีศูนย์ในรัศมี 5 กม. จากตำแหน่งนี้');
		expect(buttons()).toEqual(['ขยายรัศมี', 'ล้างตำแหน่ง']);
		button('ขยายรัศมี').click();
		expect(h.onExpandRadius).toHaveBeenCalledOnce();
		button('ล้างตำแหน่ง').click();
		expect(h.onClearPosition).toHaveBeenCalledOnce();
	});

	it('says the filters are why, and offers to clear them', () => {
		const h = render('filtered');
		expect(document.body.textContent).toContain('ไม่พบศูนย์ที่ตรงกับตัวกรอง');
		expect(buttons()).toEqual(['ล้างตัวกรอง']);
		button('ล้างตัวกรอง').click();
		expect(h.onClearFilters).toHaveBeenCalledOnce();
	});

	it('keeps the plain "nothing found" wording, without actions, when nothing is filtered', () => {
		render('none');
		expect(document.body.textContent).toContain('ไม่พบข้อมูลศูนย์พักพิง');
		expect(document.body.textContent).toContain('ลองเปลี่ยนเงื่อนไขการค้นหาอีกครั้ง');
		expect(buttons()).toEqual([]);
	});

	it('speaks English when the page does', () => {
		lang.current = 'en';
		render('radius', '10');
		expect(document.body.textContent).toContain('No shelters within 10 km of this location');
	});
});
