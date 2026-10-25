// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { KioskBannerSummary } from '../data/kiosk-banner.repository';
import type { ScreenSummary } from './kiosk-banner-order';
import KioskBannerScreenCard from './kiosk-banner-screen-card.svelte';

const banner = (id: string): KioskBannerSummary => ({
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
	image_content_type: 'image/png'
});

const summary = (over: Partial<ScreenSummary> = {}): ScreenSummary => ({
	active: 0,
	scheduled: 0,
	inactive: 0,
	expired: 0,
	strip: [],
	...over
});

let instance: ReturnType<typeof mount> | null = null;

const GROUP_SCREEN_HREF = '/back-office/kiosks/banners/groups/kiosk_banner_group%3AA/portrait';

function render(props: { screen?: 'compact' | 'portrait'; summary: ScreenSummary; href?: string }) {
	instance = mount(KioskBannerScreenCard, {
		target: document.body,
		props: { screen: 'compact', href: GROUP_SCREEN_HREF, ...props }
	});
	flushSync();
}

const link = () => document.body.querySelector('a') as HTMLAnchorElement;

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('KioskBannerScreenCard', () => {
	it('shows the screen title, an accessible name and only the non-zero counts', () => {
		render({
			screen: 'portrait',
			summary: summary({ active: 2, scheduled: 1, expired: 3, strip: [banner('a')] })
		});

		expect(link().getAttribute('aria-label')).toBe('จัดการแบนเนอร์ตู้ใหญ่ 1080×1920');
		const text = document.body.textContent ?? '';
		expect(text).toContain('ตู้ใหญ่ 1080×1920');
		expect(text).toContain('แสดงอยู่ 2');
		expect(text).toContain('รอแสดง 1');
		expect(text).not.toContain('ปิดอยู่');
		expect(text).toContain('หมดอายุ 3');
	});

	it('keeps「แสดงอยู่ 0」but omits the other zero counts', () => {
		render({ summary: summary() });

		const text = document.body.textContent ?? '';
		expect(text).toContain('แสดงอยู่ 0');
		expect(text).not.toContain('รอแสดง');
		expect(text).not.toMatch(/หมดอายุ \d/);
	});

	it('lists the strip thumbnails in order with number badges', () => {
		render({ summary: summary({ strip: [banner('a'), banner('b'), banner('c')] }) });

		const thumbs = [...document.body.querySelectorAll('img')];
		expect(thumbs.map((img) => img.getAttribute('src'))).toEqual([
			expect.stringContaining(encodeURIComponent('kiosk_banner:a')),
			expect.stringContaining(encodeURIComponent('kiosk_banner:b')),
			expect.stringContaining(encodeURIComponent('kiosk_banner:c'))
		]);
		expect(
			[...document.body.querySelectorAll('[data-testid="strip-order"]')].map((el) => el.textContent)
		).toEqual(['1', '2', '3']);
	});

	it('shows the first 6 thumbnails and +N for the rest', () => {
		render({
			summary: summary({ strip: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(banner) })
		});

		expect(document.body.querySelectorAll('img')).toHaveLength(6);
		expect(document.body.textContent).toContain('+2');
	});

	it('shows a muted message for an empty strip', () => {
		render({ summary: summary() });

		expect(document.body.querySelectorAll('img')).toHaveLength(0);
		expect(document.body.textContent).toContain('ยังไม่มีแบนเนอร์ที่ยังไม่หมดอายุ');
	});

	it('is a single link to the href it is given (the group screen page)', () => {
		render({ screen: 'portrait', summary: summary() });

		expect(document.body.querySelectorAll('a')).toHaveLength(1);
		expect(link().getAttribute('href')).toBe(GROUP_SCREEN_HREF);
	});
});
