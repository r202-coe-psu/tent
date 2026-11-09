import { env } from '$env/dynamic/private';
import { ServiceError } from '$lib/server/couch-admin';

/** CR-171 FR-13: `EDGE_MODE=true` marks this frontend as an edge replica (central leaves it unset). */
export function isEdgeMode(): boolean {
	return env.EDGE_MODE === 'true';
}

/**
 * `_users` flows central → edge only (`users_<code>_pull`), so a write at the edge conflicts with the
 * next pulled revision. Call as the FIRST line of every BFF writer of `_users`.
 */
export function assertUsersWritable(): void {
	if (isEdgeMode()) {
		throw new ServiceError('FORBIDDEN', 'แก้ไขบัญชีได้เฉพาะที่ระบบกลาง');
	}
}
