// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const mocks = vi.hoisted(() => ({ roles: [] as string[] }));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return { name: 'u@example.com', roles: mocks.roles };
		}
	}
}));
vi.mock('$lib/features/shelters', () => ({ useShelter: () => ({ data: undefined }) }));
vi.mock('$lib/features/master-data', () => ({ useMasterData: () => ({ data: undefined }) }));
vi.mock('../application/queries', () => ({
	useExportCountries: () => ({ data: [], isPending: false, isError: false, fetchStatus: 'idle' }),
	useConsulateExport: () => ({ isPending: false, mutate: vi.fn() })
}));

import ConsulateExportButton from './consulate-export-button.svelte';

let instance: ReturnType<typeof mount> | null = null;

async function renderWith(roles: string[], shelterCode = 'SH001') {
	mocks.roles = roles;
	instance = mount(ConsulateExportButton, { target: document.body, props: { shelterCode } });
	await tick();
	flushSync();
	return document.body.textContent ?? '';
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('ConsulateExportButton gating (FR-2)', () => {
	const LABEL = 'Export รายชื่อสำหรับกงสุล';

	it('shows for system_admin', async () => {
		expect(await renderWith(['system_admin'])).toContain(LABEL);
	});

	it('shows for the shelter_manager of that shelter', async () => {
		expect(await renderWith(['shelter:SH001', 'SH001:shelter_manager'])).toContain(LABEL);
	});

	it('is hidden for registration_staff', async () => {
		expect(await renderWith(['shelter:SH001', 'SH001:registration_staff'])).not.toContain(LABEL);
	});

	it('is hidden for a shelter_manager of a different shelter', async () => {
		expect(await renderWith(['shelter:SH002', 'SH002:shelter_manager'])).not.toContain(LABEL);
	});
});
