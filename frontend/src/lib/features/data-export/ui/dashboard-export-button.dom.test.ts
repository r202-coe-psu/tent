// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import Button from './dashboard-export-button.svelte';

type Q = { data?: unknown; isError?: boolean; isPlaceholderData?: boolean };

const mocks = vi.hoisted(() => ({
	roles: [] as string[],
	occupancy: {} as Q,
	demographics: {} as Q,
	registrations: {} as Q,
	stationTimes: {} as Q,
	exportDashboard: vi.fn()
}));

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return { name: 'u', roles: mocks.roles };
		}
	}
}));
vi.mock('$lib/features/dashboard', () => ({
	useDashboardOccupancy: () => mocks.occupancy,
	useDashboardDemographics: () => mocks.demographics,
	useDashboardRegistrations: () => mocks.registrations,
	useDashboardStationTimes: () => mocks.stationTimes
}));
vi.mock('$lib/features/shelters', () => ({ useShelter: () => ({ data: { name: 'Shelter' } }) }));
vi.mock('../application/export-dashboard', () => ({ exportDashboard: mocks.exportDashboard }));

const CODE = 'SH001';
let instance: ReturnType<typeof mount> | null = null;

async function render() {
	instance = mount(Button, { target: document.body, props: { shelterCode: CODE, params: {} } });
	await tick();
	flushSync();
}

const button = () => document.querySelector('button');

beforeEach(() => {
	vi.clearAllMocks();
	mocks.roles = [`shelter:${CODE}`, `${CODE}:shelter_manager`];
	for (const k of ['occupancy', 'demographics', 'registrations', 'stationTimes'] as const) {
		mocks[k] = { data: {} };
	}
	mocks.exportDashboard.mockResolvedValue('file.xlsx');
});

afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('dashboard export button (CR-232 FR-2, FR-50)', () => {
	it('is hidden from registration_staff', async () => {
		mocks.roles = [`shelter:${CODE}`, `${CODE}:registration_staff`];
		await render();
		expect(button()).toBeNull();
	});

	it('is shown to a shelter_manager of this shelter and to system_admin', async () => {
		await render();
		expect(button()).not.toBeNull();
		await unmount(instance!);
		document.body.innerHTML = '';
		mocks.roles = ['system_admin'];
		await render();
		expect(button()).not.toBeNull();
	});

	it('is disabled while a query is still loading', async () => {
		mocks.occupancy = { data: undefined };
		await render();
		expect(button()!.disabled).toBe(true);
	});

	it('is disabled on a kept-previous-range placeholder and on query error', async () => {
		mocks.registrations = { data: {}, isPlaceholderData: true };
		await render();
		expect(button()!.disabled).toBe(true);
		await unmount(instance!);
		document.body.innerHTML = '';
		mocks.registrations = { data: {} };
		mocks.stationTimes = { data: {}, isError: true };
		await render();
		expect(button()!.disabled).toBe(true);
	});

	it('is enabled once everything is loaded, and exports on click', async () => {
		await render();
		expect(button()!.disabled).toBe(false);
		button()!.click();
		await tick();
		expect(mocks.exportDashboard).toHaveBeenCalledOnce();
	});
});
