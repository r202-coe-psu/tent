import { z } from 'zod';
import { adminRaw } from '$lib/server/couch-admin';
// eslint-disable-next-line no-restricted-imports -- server-safe domain schema; feature barrel pulls client UI/query code
import { staffPinSchema } from '$lib/features/scanners/domain/scanner.schema';
import { ScannerConflictError, ScannerDependencyError } from './device-credentials';

/**
 * Storage for scanner staff bypass PINs.
 *
 * PINs are kept in plaintext in their own CouchDB database whose `_security` admits only server
 * admins (`_admin` in both members and admins), so no staff user or scanner device can read it —
 * only this server, through the admin client. The registry `scanner_device` doc carries just the
 * non-secret metadata (set / default / who / when) the browser needs for badges.
 *
 * Never log a PIN from here.
 */

export const SCANNER_SECRETS_DB = 'scanner_secrets';
export const STAFF_PIN_SECRET_SCHEMA_V = 1 as const;

interface CouchSecurity {
	admins?: { names?: string[]; roles?: string[] };
	members?: { names?: string[]; roles?: string[] };
}

/** Admin-only: with `_admin` as the only member role, CouchDB refuses every non-admin reader. */
export const SCANNER_SECRETS_SECURITY = {
	admins: { roles: ['_admin'] },
	members: { roles: ['_admin'] }
} as const satisfies CouchSecurity;

/** The secrets store failed (CouchDB unreachable, unexpected status, malformed doc). → 503 */
export class StaffPinUnavailableError extends ScannerDependencyError {
	constructor(message = 'Staff PIN store unavailable') {
		super(message);
		this.name = 'StaffPinUnavailableError';
	}
}

export class StaffPinNotSetError extends Error {
	readonly code = 'STAFF_PIN_NOT_SET' as const;

	constructor() {
		super('Staff PIN is not set for this device');
		this.name = 'StaffPinNotSetError';
	}
}

export function staffPinSecretId(deviceId: string): string {
	return `staff_pin:${deviceId}`;
}

export const staffPinSecretSchema = z
	.object({
		_id: z.string().min(1),
		_rev: z.string().min(1),
		type: z.literal('scanner_staff_pin'),
		schema_v: z.literal(STAFF_PIN_SECRET_SCHEMA_V),
		device_id: z.string().min(1),
		pin: staffPinSchema,
		is_default: z.boolean(),
		updated_at: z.string().min(1),
		updated_by: z.string().min(1)
	})
	.strict();
export type StaffPinSecret = z.infer<typeof staffPinSecretSchema>;

export interface StaffPinSecretInput {
	device_id: string;
	pin: string;
	is_default: boolean;
	updated_at: string;
	updated_by: string;
}

/**
 * Union of the required entries into the current `_security` (same rule as
 * `scripts/sync-central-db.ts`): never drops an existing name/role. `null` = already current.
 */
export function mergeCouchSecurity(
	existing: CouchSecurity,
	required: CouchSecurity
): CouchSecurity | null {
	const missing = (have: readonly string[] = [], want: readonly string[] = []) =>
		want.some((entry) => !have.includes(entry));
	const current =
		!missing(existing.admins?.names, required.admins?.names) &&
		!missing(existing.admins?.roles, required.admins?.roles) &&
		!missing(existing.members?.names, required.members?.names) &&
		!missing(existing.members?.roles, required.members?.roles);
	if (current) return null;

	const merge = (a: readonly string[] = [], b: readonly string[] = []) =>
		Array.from(new Set([...a, ...b]));
	return {
		admins: {
			names: merge(existing.admins?.names, required.admins?.names),
			roles: merge(existing.admins?.roles, required.admins?.roles)
		},
		members: {
			names: merge(existing.members?.names, required.members?.names),
			roles: merge(existing.members?.roles, required.members?.roles)
		}
	};
}

type AdminRaw = typeof adminRaw;

export class StaffPinSecretStore {
	/** In-flight / settled "DB + _security ensured" check; cleared on failure so it retries. */
	private ensured: Promise<void> | null = null;

	constructor(
		private readonly raw: AdminRaw = adminRaw,
		private readonly db: string = SCANNER_SECRETS_DB
	) {}

	private docPath(deviceId: string): string {
		return `/${this.db}/${encodeURIComponent(staffPinSecretId(deviceId))}`;
	}

	private async call(
		path: string,
		method: string,
		body?: unknown
	): Promise<{ status: number; data: unknown }> {
		try {
			return await this.raw(path, method, body);
		} catch {
			throw new StaffPinUnavailableError();
		}
	}

	/** Create the DB and enforce admin-only `_security` once per process (idempotent). */
	ensureDatabase(): Promise<void> {
		this.ensured ??= this.ensureDatabaseOnce().catch((error: unknown) => {
			this.ensured = null;
			throw error;
		});
		return this.ensured;
	}

	private async ensureDatabaseOnce(): Promise<void> {
		const created = await this.call(`/${this.db}`, 'PUT');
		// 201/202 created, 412 already exists.
		if (![201, 202, 412].includes(created.status)) {
			throw new StaffPinUnavailableError('Cannot create staff PIN store');
		}
		const current = await this.call(`/${this.db}/_security`, 'GET');
		if (current.status !== 200) throw new StaffPinUnavailableError('Cannot read store security');
		const existing = (current.data ?? {}) as CouchSecurity;
		const extraMembers = [
			...(existing.members?.names ?? []),
			...(existing.members?.roles ?? []).filter((role) => role !== '_admin')
		];
		if (extraMembers.length > 0) {
			// Fail closed: never write a plaintext PIN into a DB that non-admins can read. Fixing the
			// `_security` is an operator decision, so it is left unchanged and reported.
			console.error(
				`[scanner-staff-pin] ${this.db} _security admits non-admin members (${extraMembers.join(', ')}); refusing to store PINs until it is admin-only`
			);
			throw new StaffPinUnavailableError('Staff PIN store is readable by non-admins');
		}
		const merged = mergeCouchSecurity(existing, SCANNER_SECRETS_SECURITY);
		if (!merged) return;
		const put = await this.call(`/${this.db}/_security`, 'PUT', merged);
		if (put.status < 200 || put.status >= 300) {
			throw new StaffPinUnavailableError('Cannot set store security');
		}
	}

	/** The device's PIN doc, or `null` when none exists (or the DB was never created). */
	async get(deviceId: string): Promise<StaffPinSecret | null> {
		const result = await this.call(this.docPath(deviceId), 'GET');
		if (result.status === 404) return null;
		if (result.status !== 200) throw new StaffPinUnavailableError();
		const parsed = staffPinSecretSchema.safeParse(result.data);
		if (!parsed.success || parsed.data.device_id !== deviceId) {
			throw new StaffPinUnavailableError('Stored staff PIN is malformed');
		}
		return parsed.data;
	}

	/**
	 * Write the device's PIN doc. `rev` must be the current `_rev` (or `null` to create); a stale or
	 * missing rev surfaces as {@link ScannerConflictError} instead of overwriting.
	 */
	async put(input: StaffPinSecretInput, rev: string | null): Promise<StaffPinSecret> {
		await this.ensureDatabase();
		const doc = {
			_id: staffPinSecretId(input.device_id),
			...(rev ? { _rev: rev } : {}),
			type: 'scanner_staff_pin' as const,
			schema_v: STAFF_PIN_SECRET_SCHEMA_V,
			device_id: input.device_id,
			pin: input.pin,
			is_default: input.is_default,
			updated_at: input.updated_at,
			updated_by: input.updated_by
		};
		const result = await this.call(this.docPath(input.device_id), 'PUT', doc);
		if (result.status === 409)
			throw new ScannerConflictError('Staff PIN was modified concurrently');
		const newRev = (result.data as { rev?: unknown } | null)?.rev;
		if (result.status < 200 || result.status >= 300 || typeof newRev !== 'string') {
			throw new StaffPinUnavailableError();
		}
		return { ...doc, _rev: newRev };
	}

	/**
	 * Delete the device's PIN doc. With `rev`, only that revision is deleted (a newer one written by
	 * someone else is left alone); without it, whatever is current. Missing doc = no-op.
	 */
	async remove(deviceId: string, rev?: string): Promise<void> {
		let currentRev = rev;
		if (!currentRev) {
			const current = await this.call(this.docPath(deviceId), 'GET');
			if (current.status === 404) return;
			const found = (current.data as { _rev?: unknown } | null)?._rev;
			if (current.status !== 200 || typeof found !== 'string') {
				throw new StaffPinUnavailableError();
			}
			currentRev = found;
		}
		const result = await this.call(
			`${this.docPath(deviceId)}?rev=${encodeURIComponent(currentRev)}`,
			'DELETE'
		);
		if (result.status === 404) return;
		if (result.status === 409)
			throw new ScannerConflictError('Staff PIN was modified concurrently');
		if (result.status < 200 || result.status >= 300) throw new StaffPinUnavailableError();
	}
}

export const staffPinSecretStore = new StaffPinSecretStore();
