import { beforeEach, describe, expect, it, vi } from 'vitest';

type ShelterDoc = { common_areas: { sub_storage: { id: string; name: string }[] } };

const query = vi.hoisted(() => ({
	data: undefined as unknown,
	isSuccess: false,
	isLoading: false
}));

vi.mock('$lib/features/shelters', () => ({
	useShelter: () => ({
		get data() {
			return query.data;
		},
		get isSuccess() {
			return query.isSuccess;
		},
		get isLoading() {
			return query.isLoading;
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
		query.isSuccess = false;
		query.isLoading = false;
	});

	it('is true when the query succeeded with data', () => {
		query.data = shelter;
		query.isSuccess = true;
		const hook = useStoragePoints(() => 'SH001');
		expect(hook.isLoaded).toBe(true);
		expect(hook.points.map((p) => p.name)).toEqual(['คลังหลัก']);
	});

	it('stays true when a background refetch failed but data is kept (status error)', () => {
		query.data = shelter;
		query.isSuccess = false;
		const hook = useStoragePoints(() => 'SH001');
		expect(hook.isLoaded).toBe(true);
	});

	it('is false while there is no data yet', () => {
		query.isLoading = true;
		const hook = useStoragePoints(() => 'SH001');
		expect(hook.isLoaded).toBe(false);
	});

	it('is false when the query failed with no data', () => {
		const hook = useStoragePoints(() => 'SH001');
		expect(hook.isLoaded).toBe(false);
	});
});
