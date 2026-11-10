/** CR-171 FR-13: the BFF refuses `_users` writes at the edge with this 403 message. */
export const EDGE_USERS_READONLY_MESSAGE = 'แก้ไขบัญชีได้เฉพาะที่ระบบกลาง';

/** True for that refusal — a real answer, not a permission/session problem. */
export function isEdgeUsersReadonlyError(err: unknown): boolean {
	return err instanceof Error && err.message.startsWith(EDGE_USERS_READONLY_MESSAGE);
}
