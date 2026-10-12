/** Keep the first 1–2 code points so staff can confirm identity without exposing the full surname. */
export function maskLastName(lastName: string | null | undefined): string {
	if (!lastName?.trim()) return '';
	const chars = Array.from(lastName.trim());
	if (chars.length <= 4) return `${chars[0]}****`;
	return `${chars[0]}${chars[1] ?? ''}****${chars[chars.length - 1] ?? ''}`;
}
