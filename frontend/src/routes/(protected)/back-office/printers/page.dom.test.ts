// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { shelterStore } from '$lib/stores/shelter.svelte';
import Page from './+page.svelte';

const mocks = vi.hoisted(() => ({ user: { name: 'admin', roles: [] as string[] } }));

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return mocks.user;
		}
	}
}));
vi.mock('$lib/features/kiosk-devices', () => ({
	useScannerDevices: () => ({ data: [] })
}));
vi.mock('$lib/features/printers', async (importActual) => ({
	...(await importActual<typeof import('$lib/features/printers')>()),
	CreatePrinterDialog: (await import('./__fixtures__/create-printer-dialog-stub.svelte')).default,
	usePrinterAdminList: () => ({ isLoading: false, isError: false, data: { printers: [] } })
}));

let instance: ReturnType<typeof mount> | null = null;

async function render() {
	instance = mount(Page, { target: document.body });
	await tick();
	flushSync();
}
const lockedShelter = () =>
	document.querySelector('[data-testid="create-dialog"]')?.getAttribute('data-fixed-shelter');

beforeEach(() => {
	shelterStore.selectedShelterCode = undefined;
	shelterStore.listDefaultCode = undefined;
});
afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('/back-office/printers create dialog shelter lock', () => {
	it('leaves the shelter open for a system admin who has not picked one (never guesses SH001)', async () => {
		mocks.user = { name: 'admin', roles: ['system_admin'] };

		await render();

		expect(lockedShelter()).toBe('null');
	});

	it('ignores the first-listed shelter default for a system admin', async () => {
		mocks.user = { name: 'admin', roles: ['system_admin'] };
		shelterStore.listDefaultCode = 'SH003';

		await render();

		expect(lockedShelter()).toBe('null');
	});

	it('locks the dialog to the shelter picked in the back-office switcher', async () => {
		mocks.user = { name: 'admin', roles: ['system_admin'] };
		shelterStore.selectedShelterCode = 'SH002';

		await render();

		expect(lockedShelter()).toBe('SH002');
	});
});
