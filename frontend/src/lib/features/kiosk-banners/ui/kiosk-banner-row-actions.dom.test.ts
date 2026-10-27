// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { KioskBannerSummary } from '../data/kiosk-banner.repository';
import KioskBannerRowActions from './kiosk-banner-row-actions.svelte';

const setStatus = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
const remove = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock('../application/kiosk-banner.queries', () => ({
	useSetKioskBannerStatus: () => setStatus,
	useDeleteKioskBanner: () => remove
}));

vi.mock('svelte-sonner', () => ({ toast: { success: toastSuccess } }));

const banner = (
	id: string,
	over: Partial<Omit<KioskBannerSummary, 'schema_v'>> = {}
): KioskBannerSummary => ({
	_id: `kiosk_banner:${id}`,
	_rev: `1-${id}`,
	type: 'kiosk_banner',
	schema_v: 2,
	group_id: 'kiosk_banner_group:A',
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

function render(props: { banner: KioskBannerSummary; expired?: boolean }) {
	instance = mount(KioskBannerRowActions, { target: document.body, props });
	flushSync();
}

const byText = (selector: string, text: string) =>
	[...document.body.querySelectorAll<HTMLElement>(selector)].find((el) =>
		el.textContent?.includes(text)
	);

beforeEach(() => {
	vi.clearAllMocks();
	setStatus.isPending = false;
	remove.isPending = false;
});
afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	// bits-ui releases the body scroll lock on a 24 ms timer; let it run before happy-dom tears down.
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('KioskBannerRowActions', () => {
	it('labels the switch with the real status and sends the opposite on click', () => {
		render({ banner: banner('on') });

		expect(document.body.textContent).toContain('แสดงบนตู้');
		const toggle = document.body.querySelector('[role="switch"]') as HTMLElement;
		expect(toggle.getAttribute('aria-label')).toBe('แสดง แบนเนอร์ on บนตู้');
		toggle.click();
		flushSync();

		expect(setStatus.mutate).toHaveBeenCalledWith(
			{ id: 'kiosk_banner:on', rev: '1-on', status: 'inactive' },
			expect.anything()
		);
	});

	it('sends active for a hidden banner and toasts on success', () => {
		render({ banner: banner('off', { status: 'inactive' }) });

		expect(document.body.textContent).toContain('ไม่แสดง');
		(document.body.querySelector('[role="switch"]') as HTMLElement).click();
		flushSync();

		expect(setStatus.mutate).toHaveBeenCalledWith(
			{ id: 'kiosk_banner:off', rev: '1-off', status: 'active' },
			expect.anything()
		);
		setStatus.mutate.mock.calls[0][1].onSuccess();
		expect(toastSuccess).toHaveBeenCalledWith('เปิดการแสดงแบนเนอร์บนตู้แล้ว');
	});

	it('disables the switch while the status mutation is pending', () => {
		setStatus.isPending = true;
		render({ banner: banner('a') });

		expect(document.body.querySelector('[role="switch"]')?.hasAttribute('disabled')).toBe(true);
	});

	it('links the edit button to the banner editor', () => {
		render({ banner: banner('a') });

		const edit = document.body.querySelector('a') as HTMLAnchorElement;
		expect(edit.getAttribute('href')).toContain('/back-office/kiosks/banners/kiosk_banner%3Aa');
		expect(edit.getAttribute('title')).toBe('แก้ไขแบนเนอร์');
		expect(edit.querySelector('.sr-only')?.textContent).toBe('แก้ไขแบนเนอร์ แบนเนอร์ a');
	});

	it('asks for confirmation naming the banner; cancel sends nothing', () => {
		render({ banner: banner('a') });

		(document.body.querySelector('[data-testid="delete-banner"]') as HTMLElement).click();
		flushSync();

		const dialog = document.body.querySelector('[role="alertdialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('แบนเนอร์ a');

		byText('[role="alertdialog"] button', 'ยกเลิก')?.click();
		flushSync();
		expect(remove.mutate).not.toHaveBeenCalled();
	});

	it('deletes the confirmed banner with its current revision and toasts on success', () => {
		render({ banner: banner('b') });

		(document.body.querySelector('[data-testid="delete-banner"]') as HTMLElement).click();
		flushSync();
		byText('[role="alertdialog"] button', 'ลบแบนเนอร์')?.click();
		flushSync();

		expect(remove.mutate).toHaveBeenCalledTimes(1);
		expect(remove.mutate).toHaveBeenCalledWith(
			{ id: 'kiosk_banner:b', rev: '1-b' },
			expect.anything()
		);
		remove.mutate.mock.calls[0][1].onSuccess();
		flushSync();
		expect(toastSuccess).toHaveBeenCalledWith('ลบแบนเนอร์ "แบนเนอร์ b" แล้ว');
	});

	it('still offers edit and delete when expired', () => {
		render({ banner: banner('old'), expired: true });

		expect(document.body.querySelector('a')).not.toBeNull();
		expect(document.body.querySelector('[data-testid="delete-banner"]')).not.toBeNull();
	});

	it('shows the expired badge and no switch when expired', () => {
		render({ banner: banner('old'), expired: true });

		expect(document.body.querySelector('[role="switch"]')).toBeNull();
		expect(document.body.querySelector('.badge-muted')?.textContent?.trim()).toBe('หมดอายุ');
	});
});
