// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import QuickCreateItemSheet from './quick-create-item-sheet.svelte';

vi.mock('./quick-create-item.svelte', async () => ({
	default: (await import('./__fixtures__/quick-create-item.fixture.svelte')).default
}));

let instance: ReturnType<typeof mount> | null = null;

async function render(props: Record<string, unknown>) {
	instance = mount(QuickCreateItemSheet, {
		target: document.body,
		props: { shelterCode: 'SH001', onCreated: vi.fn(), onUseExisting: vi.fn(), ...props }
	});
	flushSync();
	await tick();
}

const stub = () => document.body.querySelector<HTMLElement>('[data-testid="qc-stub"]');

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('QuickCreateItemSheet', () => {
	it('renders nothing while closed', async () => {
		await render({ open: false });
		expect(stub()).toBeNull();
	});

	it('opens with the title and the initial name', async () => {
		await render({ open: true, initialName: 'น้ำมันพืช' });
		expect(document.body.textContent).toContain('สร้างสินค้าใหม่');
		expect(stub()?.getAttribute('data-name')).toBe('น้ำมันพืช');
	});

	it('forwards a created item and closes', async () => {
		const onCreated = vi.fn();
		await render({ open: true, onCreated });
		stub()!.querySelector<HTMLElement>('[data-testid="qc-created"]')!.click();
		flushSync();
		await tick();
		expect(onCreated).toHaveBeenCalledWith({ _id: 'item_master:x' });
		expect(stub()).toBeNull();
	});

	it('forwards "use existing" and closes', async () => {
		const onUseExisting = vi.fn();
		await render({ open: true, onUseExisting });
		stub()!.querySelector<HTMLElement>('[data-testid="qc-existing"]')!.click();
		flushSync();
		await tick();
		expect(onUseExisting).toHaveBeenCalledWith({ _id: 'item_master:y' });
		expect(stub()).toBeNull();
	});
});
