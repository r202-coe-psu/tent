/** Household members with the head (primary contact) first; the rest keep their order. */
export function headFirst<T extends { _id: string }>(
	members: readonly T[],
	headId: string | null
): T[] {
	const headIndex = headId === null ? -1 : members.findIndex((member) => member._id === headId);
	if (headIndex <= 0) return [...members];
	return [members[headIndex], ...members.filter((_, index) => index !== headIndex)];
}
