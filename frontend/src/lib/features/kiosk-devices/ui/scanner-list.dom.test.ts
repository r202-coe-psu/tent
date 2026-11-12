// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { toast } from 'svelte-sonner';
import type { ScannerDevice } from '../domain/scanner.schema';
import ScannerList from './scanner-list.svelte';

const updateMutation = vi.hoisted(() => ({
	mutate: vi.fn(),
	isPending: false,
	variables: undefined as { deviceId: string } | undefined
}));
vi.mock('../application/queries', () => ({
	useDeleteScannerDevice: () => ({ mutate: vi.fn(), isPending: false }),
	useUpdateScannerDevice: () => updateMutation
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const device = (id: string, over: Partial<ScannerDevice> = {}): ScannerDevice => ({
	id: `scanner:${id}`,
	device_id: id,
	name: `Kiosk ${id}`,
	shelter_code: 'SH001',
	station_name: 'จุดคัดกรอง',
	status: 'active',
	last_seen_at: null,
	staff_pin_set: false,
	staff_pin_is_default: false,
	banner_group_id: null,
	screen_type: 'compact',
	service_open: true,
	service_open_changed_at: null,
	service_open_changed_by: null,
	...over
});

let instance: ReturnType<typeof mount> | null = null;

async function render(devices: ScannerDevice[]) {
	instance = mount(ScannerList, { target: document.body, props: { devices } });
	flushSync();
	await tick();
	flushSync();
}

const switchByLabel = (label: string) => {
	const id = [...document.body.querySelectorAll('label')]
		.find((l) => l.textContent?.trim() === label)
		?.getAttribute('for');
	return document.getElementById(id ?? '') as HTMLButtonElement | null;
};

/** Exact-text match: 'เปิดให้บริการ' (the switch label) contains 'ปิดให้บริการ' as a substring. */
const hasBadge = (label: string) =>
	[...document.body.querySelectorAll('span')].some((el) => el.textContent?.trim() === label);

beforeEach(() => {
	vi.clearAllMocks();
	updateMutation.isPending = false;
	updateMutation.variables = undefined;
});
afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('ScannerList service switch', () => {
	it('gives an active device a เปิดให้บริการ switch that is on while service is open', async () => {
		await render([device('a')]);
		const toggle = switchByLabel('เปิดให้บริการ');
		expect(toggle?.getAttribute('role')).toBe('switch');
		expect(toggle?.getAttribute('aria-checked')).toBe('true');
	});

	it('gives an inactive device no switch', async () => {
		await render([device('a', { status: 'inactive' })]);
		expect(document.body.querySelector('[role="switch"]')).toBeNull();
	});

	it('flags a closed active device with a ปิดให้บริการ badge and who closed it, when', async () => {
		await render([
			device('a', {
				service_open: false,
				service_open_changed_by: 'somchai',
				service_open_changed_at: '2026-11-10T03:30:00.000Z'
			})
		]);
		const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');
		expect(hasBadge('ปิดให้บริการ')).toBe(true);
		expect(text).toMatch(/ปิดโดย somchai เมื่อ .*2569.*10:30/);
		expect(switchByLabel('เปิดให้บริการ')?.getAttribute('aria-checked')).toBe('false');
	});

	it('shows no ปิดให้บริการ badge while service is open', async () => {
		await render([device('a')]);
		expect(hasBadge('ปิดให้บริการ')).toBe(false);
		expect(document.body.textContent).not.toContain('ปิดโดย');
	});

	it('closes service immediately on toggle, with no confirm step', async () => {
		await render([device('a')]);
		switchByLabel('เปิดให้บริการ')?.click();
		flushSync();

		expect(updateMutation.mutate).toHaveBeenCalledTimes(1);
		expect(updateMutation.mutate).toHaveBeenCalledWith(
			{ deviceId: 'a', patch: { service_open: false } },
			expect.anything()
		);
	});

	it('reopens service with service_open true when the switch is turned back on', async () => {
		await render([device('a', { service_open: false })]);
		switchByLabel('เปิดให้บริการ')?.click();
		flushSync();

		expect(updateMutation.mutate).toHaveBeenCalledWith(
			{ deviceId: 'a', patch: { service_open: true } },
			expect.anything()
		);
	});

	it('disables only the switch of the row being saved', async () => {
		updateMutation.isPending = true;
		updateMutation.variables = { deviceId: 'a' };
		await render([device('a'), device('b')]);
		expect(document.getElementById('service-open-a')?.hasAttribute('disabled')).toBe(true);
		expect(document.getElementById('service-open-b')?.hasAttribute('disabled')).toBe(false);
	});

	it('leaves the switch enabled when nothing is pending', async () => {
		await render([device('a')]);
		expect(switchByLabel('เปิดให้บริการ')?.hasAttribute('disabled')).toBe(false);
	});

	it('toasts success naming the device once the update succeeds', async () => {
		updateMutation.mutate.mockImplementation((_input, opts) => opts.onSuccess?.());
		await render([device('a')]);
		switchByLabel('เปิดให้บริการ')?.click();
		flushSync();

		expect(toast.success).toHaveBeenCalledTimes(1);
		expect(vi.mocked(toast.success).mock.calls[0][0]).toContain('Kiosk a');
		expect(toast.error).not.toHaveBeenCalled();
	});

	it('toasts the error message when the update fails', async () => {
		updateMutation.mutate.mockImplementation((_input, opts) => opts.onError?.(new Error('boom')));
		await render([device('a')]);
		switchByLabel('เปิดให้บริการ')?.click();
		flushSync();

		expect(toast.error).toHaveBeenCalledWith('boom');
		expect(toast.success).not.toHaveBeenCalled();
	});
});
