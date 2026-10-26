// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { KioskScreenType } from '$lib/features/shared/domain/kiosk-screen';
import type { ScreenSummary } from './kiosk-banner-order';
import KioskBannerGroupCard from './kiosk-banner-group-card.svelte';

const summary = (over: Partial<ScreenSummary> = {}): ScreenSummary => ({
	active: 0,
	scheduled: 0,
	inactive: 0,
	expired: 0,
	strip: [],
	...over
});

const summaries = (
	over: Partial<Record<KioskScreenType, ScreenSummary>> = {}
): Record<KioskScreenType, ScreenSummary> => ({
	compact: summary(),
	portrait: summary(),
	...over
});

let instance: ReturnType<typeof mount> | null = null;

function render(props: {
	group?: { _id: string; name: string; description?: string | null };
	deviceCount?: number;
	summaries?: Record<KioskScreenType, ScreenSummary>;
}) {
	instance = mount(KioskBannerGroupCard, {
		target: document.body,
		props: {
			group: { _id: 'kiosk_banner_group:01A', name: 'หน้าประตู' },
			deviceCount: 0,
			summaries: summaries(),
			...props
		}
	});
	flushSync();
}

const link = () => document.body.querySelector('a') as HTMLAnchorElement;
const text = () => document.body.textContent ?? '';

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('KioskBannerGroupCard', () => {
	it('is a single link to the group page with the id encoded', () => {
		render({});

		expect(document.body.querySelectorAll('a')).toHaveLength(1);
		expect(link().getAttribute('href')).toBe(
			'/back-office/kiosks/banners/groups/kiosk_banner_group%3A01A'
		);
	});

	it('shows the group name, its description and the kiosk count', () => {
		render({
			group: { _id: 'kiosk_banner_group:01A', name: 'หน้าประตู', description: 'ตู้ทางเข้าหลัก' },
			deviceCount: 3
		});

		expect(text()).toContain('หน้าประตู');
		expect(text()).toContain('ตู้ทางเข้าหลัก');
		expect(text()).toContain('3 เครื่อง');
	});

	it('shows 0 เครื่อง for a group with no kiosk', () => {
		render({ deviceCount: 0 });

		expect(text()).toContain('0 เครื่อง');
	});

	it('shows active and scheduled counts per screen size', () => {
		render({
			summaries: summaries({
				compact: summary({ active: 2, scheduled: 1 }),
				portrait: summary({ active: 4 })
			})
		});

		const rows = [...document.body.querySelectorAll('[data-testid="screen-summary"]')].map((el) =>
			el.textContent?.replace(/\s+/g, ' ').trim()
		);
		expect(rows).toEqual(['ตู้เล็ก 1024×600 แสดงอยู่ 2 รอแสดง 1', 'ตู้ใหญ่ 1080×1920 แสดงอยู่ 4']);
	});
});
