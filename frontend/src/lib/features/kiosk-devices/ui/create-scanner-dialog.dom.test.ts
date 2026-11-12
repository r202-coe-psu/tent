// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import CreateScannerDialog from './create-scanner-dialog.svelte';

vi.mock('../application/queries', () => ({
	useCreateScannerDevice: () => ({ mutate: vi.fn(), isPending: false })
}));
vi.mock('$lib/features/shelters', () => ({
	useShelters: () => ({ data: [], isLoading: false })
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let instance: ReturnType<typeof mount> | null = null;

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	// bits-ui releases the body scroll lock on a 24 ms timer; let it run before happy-dom tears down.
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('CreateScannerDialog', () => {
	it('offers only ตู้เล็ก and ตู้ใหญ่ for the screen, never จอ TV', async () => {
		instance = mount(CreateScannerDialog, {
			target: document.body,
			props: { open: true, fixedShelterCode: 'SH001', oncreated: vi.fn() }
		});
		flushSync();
		await tick();
		flushSync();

		const values = [...document.body.querySelectorAll('[role="radio"]')].map((r) =>
			r.getAttribute('data-value')
		);
		expect(values).toEqual(['compact', 'portrait']);
		expect(document.body.textContent).not.toContain('จอ TV');
	});
});
