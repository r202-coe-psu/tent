/** Whether `selectedId` — a shelter's `id` or its `code` — points at this shelter. */
export function isShelterSelected(
	shelter: { id: string; code?: string | null },
	selectedId: string | null
): boolean {
	return selectedId === shelter.id || Boolean(shelter.code && selectedId === shelter.code);
}
