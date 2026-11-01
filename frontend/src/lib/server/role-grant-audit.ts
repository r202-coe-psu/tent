import type { RoleGrant, RoleGrantAuditReason } from '$lib/auth/role-grants';
import { ulid } from '$lib/db/ulid';
import { adminRaw } from './couch-admin';
import { shelterDbName } from './shelter-access-design';

/**
 * `audit` doc for a change to a coordinator role grant (draft-coordinator-limited-access-grant
 * FR-14; schema.md §2.12, append-only). Lands in the `shelter_{code}` database of the shelter the
 * grant belongs to, so that shelter's staff can see who gave and took away access.
 */
export type RoleGrantAudit = {
	shelter_code: string;
	/** `_users` name the grant belongs to. */
	user_name: string;
	reason: RoleGrantAuditReason;
	/** Bare capability, e.g. `kitchen_staff`. */
	role: string;
	/** The grant's expiry after the change; for a revoke, the expiry it had. */
	expires_at: string | null;
	previous_expires_at?: string | null;
	/** The caller's user name, or `worker` for an expiry. */
	actor: string;
	/** On issue / renew / shorten: the verified profile and who verified it (FR-14). */
	verified_by?: RoleGrant['verified_by'];
};

export const AUDIT_WRITE_ATTEMPTS = 3;
const RETRY_DELAY_MS = 150;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Write the audit after the `_users` change succeeded. The permission change is never rolled
 * back: a failed write is retried, then logged with the same fields so it can be backfilled.
 * Returns whether the audit was stored.
 */
export async function recordRoleGrantAudit(input: RoleGrantAudit): Promise<boolean> {
	const now = new Date().toISOString();
	const context = {
		role: input.role,
		expires_at: input.expires_at,
		...(input.previous_expires_at !== undefined
			? { previous_expires_at: input.previous_expires_at }
			: {}),
		actor: input.actor,
		...(input.verified_by ? { verified_by: input.verified_by } : {})
	};
	// One `_id` for every attempt: a retry after a write that did land answers 409, not a second audit.
	const doc = {
		_id: `audit:${ulid()}`,
		type: 'audit',
		schema_v: 1,
		shelter_code: input.shelter_code,
		created_at: now,
		updated_at: now,
		created_by: input.actor,
		action: 'other',
		target_type: 'user',
		target_id: `org.couchdb.user:${input.user_name}`,
		reason: input.reason,
		context,
		occurred_at: now
	};
	const path = `/${shelterDbName(input.shelter_code)}/${encodeURIComponent(doc._id)}`;
	let lastError: unknown = null;
	for (let attempt = 1; attempt <= AUDIT_WRITE_ATTEMPTS; attempt++) {
		try {
			const res = await adminRaw(path, 'PUT', doc);
			if (res.status < 400 || res.status === 409) return true;
			lastError = `HTTP ${res.status}`;
		} catch (error) {
			lastError = error;
		}
		if (attempt < AUDIT_WRITE_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
	}
	console.error('[role-grant-audit] audit not written', {
		shelter_code: input.shelter_code,
		target_id: doc.target_id,
		reason: input.reason,
		context,
		occurred_at: now,
		error: lastError
	});
	return false;
}
