// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { KioskBannerGroupSummary } from '../data/kiosk-banner.repository';
import KioskBannerGroupTvCode from './kiosk-banner-group-tv-code.svelte';
import GroupTvCodeHarness from './__fixtures__/group-tv-code-harness.svelte';

const rotate = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock('../application/kiosk-banner.queries', () => ({ useRotateTvCode: () => rotate }));
const writeText = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('svelte-sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

const group = (over: Record<string, unknown> = {}): KioskBannerGroupSummary =>
	({
		_id: 'kiosk_banner_group:01A',
		_rev: '1-a',
		type: 'kiosk_banner_group',
		schema_v: 2,
		tv_code: '048213',
		shelter_code: 'SH001',
		name: 'ล็อบบี้',
		description: null,
		created_at: '2026-10-14T00:00:00.000Z',
		updated_at: '2026-10-14T00:00:00.000Z',
		created_by: 'tester',
		device_ids: [],
		...over
	}) as KioskBannerGroupSummary;

let instance: ReturnType<typeof mount> | null = null;

function render(props: { group?: KioskBannerGroupSummary; origin?: string } = {}) {
	instance = mount(KioskBannerGroupTvCode, {
		target: document.body,
		props: { group: group(), origin: 'https://tent.example.go.th', ...props }
	});
	flushSync();
}

const text = () => document.body.textContent ?? '';
const byText = (selector: string, label: string) =>
	[...document.body.querySelectorAll<HTMLElement>(selector)].find((el) =>
		el.textContent?.includes(label)
	);

beforeEach(() => {
	vi.clearAllMocks();
	rotate.isPending = false;
	writeText.mockResolvedValue(undefined);
	vi.stubGlobal('navigator', { clipboard: { writeText } });
});
afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	// bits-ui releases the body scroll lock on a 24 ms timer; let it run before happy-dom tears down.
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('KioskBannerGroupTvCode', () => {
	it('shows the six-digit code and the TV link', () => {
		render();

		expect(text()).toContain('รหัสจอ TV');
		expect(text()).toContain('048213');
		expect(text()).toContain('https://tent.example.go.th/banner/SH001/internal?c=048213');
	});

	it('copies the TV link to the clipboard and toasts', async () => {
		render();

		byText('button', 'คัดลอกลิงก์')?.click();
		await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('คัดลอกลิงก์แล้ว'));

		expect(writeText).toHaveBeenCalledWith(
			'https://tent.example.go.th/banner/SH001/internal?c=048213'
		);
	});

	it('toasts an error, not a success, when the browser has no clipboard (plain http)', async () => {
		vi.stubGlobal('navigator', {});
		render();

		byText('button', 'คัดลอกลิงก์')?.click();
		await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith('คัดลอกไม่สำเร็จ'));

		expect(toastSuccess).not.toHaveBeenCalled();
	});

	it('asks for confirmation before rotating; cancel sends nothing', () => {
		render();

		byText('button', 'ออกรหัสใหม่')?.click();
		flushSync();

		const dialog = document.body.querySelector('[role="alertdialog"]') as HTMLElement;
		expect(dialog.textContent).toContain(
			'รหัสเดิมจะใช้ไม่ได้ทันที จอที่เปิดรหัสเดิมอยู่จะกลับไปหน้ากรอกรหัส'
		);
		byText('[role="alertdialog"] button', 'ยกเลิก')?.click();
		flushSync();

		expect(rotate.mutateAsync).not.toHaveBeenCalled();
	});

	it('rotates the confirmed group, shows the new code, closes the dialog and toasts', async () => {
		rotate.mutateAsync.mockResolvedValue(group({ _rev: '2-a', tv_code: '731905' }));
		render();

		byText('button', 'ออกรหัสใหม่')?.click();
		flushSync();
		byText('[role="alertdialog"] button', 'ออกรหัสใหม่')?.click();
		await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('ออกรหัสใหม่แล้ว'));
		flushSync();

		expect(rotate.mutateAsync).toHaveBeenCalledExactlyOnceWith({ id: 'kiosk_banner_group:01A' });
		expect(text()).toContain('731905');
		expect(text()).not.toContain('048213');
		expect(text()).toContain('https://tent.example.go.th/banner/SH001/internal?c=731905');
		expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
	});

	it('lets a refetched group carrying another code take over a rotated code', async () => {
		rotate.mutateAsync.mockResolvedValue(group({ _rev: '2-a', tv_code: '731905' }));
		instance = mount(GroupTvCodeHarness, {
			target: document.body,
			props: {
				initial: group(),
				refreshed: group({ _rev: '3-a', tv_code: '550127' }),
				origin: 'https://tent.example.go.th'
			}
		});
		flushSync();

		byText('button', 'ออกรหัสใหม่')?.click();
		flushSync();
		byText('[role="alertdialog"] button', 'ออกรหัสใหม่')?.click();
		await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalled());
		flushSync();
		expect(text()).toContain('731905');

		document.body.querySelector<HTMLButtonElement>('[data-testid="refetch"]')?.click();
		flushSync();

		expect(text()).toContain('550127');
		expect(text()).not.toContain('731905');
	});

	it('keeps the old code and the dialog open when rotating fails', async () => {
		rotate.mutateAsync.mockRejectedValue(new Error('x'));
		render();

		byText('button', 'ออกรหัสใหม่')?.click();
		flushSync();
		byText('[role="alertdialog"] button', 'ออกรหัสใหม่')?.click();
		await vi.waitFor(() => expect(rotate.mutateAsync).toHaveBeenCalled());
		flushSync();

		expect(text()).toContain('048213');
		expect(toastSuccess).not.toHaveBeenCalled();
		expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull();
	});
});
