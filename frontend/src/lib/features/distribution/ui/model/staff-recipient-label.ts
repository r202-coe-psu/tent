import { userNameFromStaffRecipientId } from '$lib/features/users';

export function staffRecipientLabel(
	recipientId: string,
	directory: readonly { name: string; display_name: string | null }[] | undefined
): string {
	const username = userNameFromStaffRecipientId(recipientId);
	if (!username) return recipientId;
	const displayName = directory?.find((entry) => entry.name === username)?.display_name;
	return displayName || username;
}
