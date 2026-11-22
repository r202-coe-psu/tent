// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ActiveFilterChips from './active-filter-chips.svelte';
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
const hideFull: ActiveFilterChip = {
	key: 'hide_full',
	label: 'ซ่อนที่เต็ม',
	removes: ['hide_full'],
	counts: true
};

function render(chips: ActiveFilterChip[]) {
	const onRemove = vi.fn();
	const onClearAll = vi.fn();
	component = mount(ActiveFilterChips, {
		target: document.body,
		props: { chips, onRemove, onClearAll }
	});
	flushSync();
	return { onRemove, onClearAll };
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

describe('ActiveFilterChips (#1419)', () => {
	it('renders nothing when no filter is active', () => {
		render([]);
		expect(document.body.querySelector('button')).toBeNull();
		expect(document.body.textContent?.trim()).toBe('');
	});

	it('shows one removable button per chip, named for what it removes', () => {
		render([radius, hideFull]);
		expect(button('เอา ระยะ 5 กม. ออก')?.textContent).toContain('ระยะ 5 กม.');
		expect(button('เอา ซ่อนที่เต็ม ออก')?.textContent).toContain('ซ่อนที่เต็ม');
		expect(document.body.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
			'ตัวกรองที่ใช้อยู่'
		);
	});

	it('hands the clicked chip back to the page', () => {
		const { onRemove } = render([radius, hideFull]);
		button('เอา ซ่อนที่เต็ม ออก')!.click();
		expect(onRemove).toHaveBeenCalledWith(hideFull);
	});

	it('offers "clear all" when a counted filter is on', () => {
		const { onClearAll } = render([radius, hideFull]);
		button('ล้างทั้งหมด')!.click();
		expect(onClearAll).toHaveBeenCalledOnce();
	});

	it('has no "clear all" when only the default radius is shown (it would change nothing)', () => {
		render([radius]);
		expect(button('เอา ระยะ 5 กม. ออก')).toBeDefined();
		expect(button('ล้างทั้งหมด')).toBeUndefined();
	});

	it('speaks English when the page does', () => {
		lang.current = 'en';
		render([hideFull]);
		expect(button('Remove ซ่อนที่เต็ม')).toBeDefined();
		expect(button('Clear all')).toBeDefined();
	});
});
