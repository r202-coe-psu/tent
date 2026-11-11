// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { readable } from 'svelte/store';

// The page has no live route, so drive it directly: the form is stubbed to hand back an input.
const h = vi.hoisted(() => ({
	update: vi.fn(async (doc: unknown) => doc),
	formProps: null as null | { onsubmit: (...a: unknown[]) => Promise<void> | void }
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('http://localhost/back-office/households/edit/h1') })
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
vi.mock('$lib/stores/auth.svelte', () => ({ authStore: { user: { name: 'tester' } } }));
vi.mock('./household-form.svelte', () => ({
	default: (_anchor: unknown, props: { onsubmit: (...a: unknown[]) => Promise<void> | void }) => {
		h.formProps = props;
	}
}));
vi.mock('../../index', () => {
	const old = { _id: 'household:h1', _rev: '3-abc', label: 'old', housing_type: 'owned_house' };
	const query = (data: unknown) => ({ data, isLoading: false });
	const mutation = (fn: unknown) => ({ mutateAsync: fn });
	return {
		useEvacuees: () => query([]),
		useHouseholds: () => query([old]),
		useCreateHousehold: () => mutation(vi.fn()),
		useUpdateHousehold: () => mutation(h.update),
		useUpdateEvacuee: () => mutation(vi.fn()),
		checkEvacueeHouseholdConflict: () => ({ conflicted: false })
	};
});

import HouseholdFormPage from './household-form-page.svelte';

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	h.formProps = null;
	h.update.mockClear();
});

async function submitEdit(patch: Record<string, unknown>) {
	instance = mount(HouseholdFormPage, {
		target: document.body,
		props: { id: 'household:h1', isEdit: true }
	});
	flushSync();
	await h.formProps!.onsubmit({ label: 'old', ...patch }, []);
}

describe('HouseholdFormPage edit (#1161)', () => {
	it('persists a changed housing_type and residence_landmark to the updated doc', async () => {
		await submitEdit({ housing_type: 'homeless', residence_landmark: 'ใกล้วัด' });
		expect(h.update).toHaveBeenCalledWith(
			expect.objectContaining({
				_id: 'household:h1',
				// Kept from the loaded doc so CouchDB accepts the update instead of a 409.
				_rev: '3-abc',
				housing_type: 'homeless',
				residence_landmark: 'ใกล้วัด'
			})
		);
	});

	it('clears them to null when the form sends nothing', async () => {
		await submitEdit({ housing_type: null, residence_landmark: '' });
		expect(h.update).toHaveBeenCalledWith(
			expect.objectContaining({ housing_type: null, residence_landmark: null })
		);
	});
});
