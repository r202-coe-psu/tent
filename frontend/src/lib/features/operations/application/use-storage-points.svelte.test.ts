import { beforeEach, describe, expect, it, vi } from 'vitest';

type ShelterDoc = { common_areas: { sub_storage: { id: string; name: string }[] } };

const query = vi.hoisted(() => ({
	data: undefined as unknown
}));

vi.mock('$lib/features/shelters', () => ({
	useShelter: () => ({
		get data() {
			return query.data;
		}
	}),
	listStoragePoints: (shelter: ShelterDoc | undefined) => shelter?.common_areas.sub_storage ?? [],
	subStorageTypeLabels: () => []
}));

import { useStoragePoints } from './use-storage-points.svelte';

const shelter: ShelterDoc = { common_areas: { sub_storage: [{ id: 'sp:1', name: ' คลังหลัก ' }] } };

describe('useStoragePoints.isLoaded', () => {
	beforeEach(() => {
		query.data = undefined;
	});

	it('is loaded whenever shelter data is present', () => {
		// TanStack keeps the last data while status is 'error'.
		query.data = shelter;
		const hook = useStoragePoints(() => 'SH001');
		expect(hook.isLoaded).toBe(true);
		expect(hook.points.map((p) => p.name)).toEqual(['คลังหลัก']);
	});

	it('is not loaded without shelter data (loading or failed)', () => {
		const hook = useStoragePoints(() => 'SH001');
		expect(hook.isLoaded).toBe(false);
	});
});
