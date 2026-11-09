// @vitest-environment happy-dom
// "วันที่แจก" on the food ticket form (CR-241 R3): defaults to today in Thailand, not a past day.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../application/queries', () => ({
	useCreateRequisitionTicket: () => ({ mutateAsync: vi.fn(), isPending: false })
}));
vi.mock('$lib/features/shelters', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/shelters')>()),
	useShelter: () => ({ data: undefined, isPending: false, isError: false })
}));
vi.mock('./CatalogItemPicker.svelte', () => ({ default: () => {} }));

import Host from './__fixtures__/create-ticket-dialog-host.svelte';

// 2026-11-09 22:00 and 2026-11-10 00:05 in Thailand (UTC+7).
const BEFORE_MIDNIGHT = new Date('2026-11-09T15:00:00.000Z');
const AFTER_MIDNIGHT = new Date('2026-11-09T17:05:00.000Z');

let instance: ReturnType<typeof mount> | null = null;
const dateInput = () => document.querySelector<HTMLInputElement>('#service-date');

async function settle() {
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
		flushSync();
	}
	await tick();
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.useRealTimers();
});

describe('CreateTicketDialog service date', () => {
	it('defaults to today and blocks earlier days', async () => {
		vi.setSystemTime(BEFORE_MIDNIGHT);
		instance = mount(Host, { target: document.body });
		await settle();
		instance.show();
		await settle();

		expect(dateInput()?.value).toBe('2026-11-09');
		expect(dateInput()?.min).toBe('2026-11-09');
	});

	it('takes the new Thailand day when the dialog opens after midnight', async () => {
		vi.setSystemTime(BEFORE_MIDNIGHT);
		instance = mount(Host, { target: document.body });
		await settle();

		vi.setSystemTime(AFTER_MIDNIGHT);
		instance.show();
		await settle();

		expect(dateInput()?.value).toBe('2026-11-10');
		expect(dateInput()?.min).toBe('2026-11-10');
	});
});
