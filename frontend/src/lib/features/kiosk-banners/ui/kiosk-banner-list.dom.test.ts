// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { KioskBannerSummary } from '../data/kiosk-banner.repository';
import KioskBannerList from './kiosk-banner-list.svelte';

const setStatus = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
const remove = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));

vi.mock('../application/kiosk-banner.queries', () => ({
	useSetKioskBannerStatus: () => setStatus,
	useDeleteKioskBanner: () => remove
}));

const banner = (id: string, over: Partial<KioskBannerSummary> = {}): KioskBannerSummary => ({
	_id: `kiosk_banner:${id}`,
	_rev: `1-${id}`,
	type: 'kiosk_banner',
	schema_v: 1,
	shelter_code: 'SH001',
	title: `แบนเนอร์ ${id}`,
	caption: null,
	order: 1,
	duration_sec: 10,
	start_at: '2026-10-15T01:00:00.000Z',
	end_at: '2026-10-15T11:00:00.000Z',
	status: 'active',
	created_at: '2026-10-14T00:00:00.000Z',
	updated_at: '2026-10-14T00:00:00.000Z',
	created_by: 'tester',
	image_content_type: 'image/png',
	...over
});

let instance: ReturnType<typeof mount> | null = null;

function render(props: {
	banners: KioskBannerSummary[];
	view?: 'current' | 'expired';
	screenFilter?: 'all' | 'compact' | 'portrait';
}) {
	instance = mount(KioskBannerList, { target: document.body, props });
	flushSync();
}

const byText = (selector: string, text: string) =>
	[...document.body.querySelectorAll<HTMLElement>(selector)].find((el) =>
		el.textContent?.includes(text)
	);

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('KioskBannerList', () => {
	it('renders the two tabs with the current one selected', () => {
		render({ banners: [] });

		const tabs = [...document.body.querySelectorAll('[role="tab"]')];
		expect(tabs.map((t) => t.textContent?.trim())).toEqual(['กำลังแสดง / รอแสดง', 'หมดอายุ']);
		expect(tabs[0].getAttribute('aria-selected')).toBe('true');
	});

	it('shows an empty state', () => {
		render({ banners: [] });
		expect(document.body.textContent).toContain('ยังไม่มีแบนเนอร์');
	});

	it('shows title, Bangkok time window, order and an edit link per row', () => {
		render({ banners: [banner('a', { order: 3 })] });

		const row = document.body.querySelector('tbody tr') as HTMLElement;
		expect(row.textContent).toContain('แบนเนอร์ a');
		expect(row.textContent).toContain('08:00');
		expect(row.textContent).toContain('18:00');
		const edit = row.querySelector('a') as HTMLAnchorElement;
		expect(edit.getAttribute('href')).toContain('/back-office/kiosks/banners/kiosk_banner%3Aa');
		const image = row.querySelector('img') as HTMLImageElement;
		expect(image.getAttribute('src')).toContain('/api/back-office/kiosk-banners/');
	});

	it('labels the switch with the real status and sends the opposite on click', () => {
		render({
			banners: [banner('on'), banner('off', { status: 'inactive', title: 'ปิดอยู่' })]
		});

		expect(byText('tbody tr', 'แบนเนอร์ on')?.textContent).toContain('แสดงบนตู้');
		expect(byText('tbody tr', 'ปิดอยู่')?.textContent).toContain('ไม่แสดง');

		const on = byText('tbody tr', 'แบนเนอร์ on')?.querySelector('[role="switch"]') as HTMLElement;
		on.click();
		flushSync();
		expect(setStatus.mutate).toHaveBeenCalledWith(
			{ id: 'kiosk_banner:on', rev: '1-on', status: 'inactive' },
			expect.anything()
		);

		const off = byText('tbody tr', 'ปิดอยู่')?.querySelector('[role="switch"]') as HTMLElement;
		off.click();
		flushSync();
		expect(setStatus.mutate).toHaveBeenLastCalledWith(
			{ id: 'kiosk_banner:off', rev: '1-off', status: 'active' },
			expect.anything()
		);
	});

	it('has no switch on the expired tab (edit and delete only)', () => {
		render({ banners: [banner('old')], view: 'expired' });

		expect(document.body.querySelector('[role="switch"]')).toBeNull();
		expect(document.body.querySelector('tbody a')).not.toBeNull();
		expect(document.body.querySelector('tbody button')).not.toBeNull();
	});

	it('asks for confirmation naming the banner; cancel sends nothing', () => {
		render({ banners: [banner('a')] });

		(document.body.querySelector('[data-testid="delete-banner"]') as HTMLElement).click();
		flushSync();

		const dialog = document.body.querySelector('[role="alertdialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('แบนเนอร์ a');

		byText('[role="alertdialog"] button', 'ยกเลิก')?.click();
		flushSync();
		expect(remove.mutate).not.toHaveBeenCalled();
	});

	it('deletes the confirmed banner with its current revision', () => {
		render({ banners: [banner('a'), banner('b')] });

		const row = byText('tbody tr', 'แบนเนอร์ b') as HTMLElement;
		(row.querySelector('[data-testid="delete-banner"]') as HTMLElement).click();
		flushSync();
		byText('[role="alertdialog"] button', 'ลบแบนเนอร์')?.click();
		flushSync();

		expect(remove.mutate).toHaveBeenCalledTimes(1);
		expect(remove.mutate).toHaveBeenCalledWith(
			{ id: 'kiosk_banner:b', rev: '1-b' },
			expect.anything()
		);
	});

	it('labels each row with its screen type and size; a legacy banner counts as ตู้เล็ก', () => {
		render({
			banners: [banner('old'), banner('big', { screen_type: 'portrait', title: 'จอใหญ่' })]
		});

		expect(
			[...document.body.querySelectorAll('thead th')].some(
				(th) => th.textContent?.trim() === 'ขนาดจอ'
			)
		).toBe(true);
		const old = byText('tbody tr', 'แบนเนอร์ old') as HTMLElement;
		expect(old.querySelector('.badge-muted')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'ตู้เล็ก 1024×600'
		);
		const big = byText('tbody tr', 'จอใหญ่') as HTMLElement;
		expect(big.querySelector('.badge-muted')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'ตู้ใหญ่ 1080×1920'
		);
		expect(old.querySelector('img')?.className).toContain('w-20');
		expect(big.querySelector('img')?.className).toContain('w-9');
	});

	it('words the empty state for the screen filter', () => {
		render({ banners: [], screenFilter: 'portrait' });
		expect(document.body.textContent).toContain('ยังไม่มีแบนเนอร์ตู้ใหญ่ที่กำลังแสดงหรือรอแสดง');
	});

	it('keeps the generic empty wording without a filter', () => {
		render({ banners: [], screenFilter: 'all' });
		expect(document.body.textContent).toContain('ยังไม่มีแบนเนอร์ที่กำลังแสดงหรือรอแสดง');
	});

	it('spans every column in the empty state', () => {
		render({ banners: [] });
		expect(document.body.querySelector('tbody td')?.getAttribute('colspan')).toBe('7');
	});
});
