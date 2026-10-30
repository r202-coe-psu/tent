/**
 * Test-only reactive backing for the mocked `useStoragePoints`. A plain object is not reactive,
 * so tests that move storage points from loading to loaded after mount mutate this `$state`
 * object instead.
 */
export const storagePointsMock = $state({
	points: [] as { id: string; name: string }[],
	loaded: true
});

export function resetStoragePointsMock() {
	storagePointsMock.points = [];
	storagePointsMock.loaded = true;
}
