import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const DEVICE_AUTH_FAILED = 'DEVICE_AUTH_FAILED' as const;
export const DEPENDENCY_UNAVAILABLE = 'DEPENDENCY_UNAVAILABLE' as const;

/** Errors intentionally carry no credential material or upstream response body. */
export class PrintAuthError extends Error {
	readonly code = DEVICE_AUTH_FAILED;

	constructor() {
		super('Device authentication failed');
		this.name = 'PrintAuthError';
	}
}

export class PrintDependencyError extends Error {
	readonly code = DEPENDENCY_UNAVAILABLE;

	constructor(message = 'Print service unavailable') {
		super(message);
		this.name = 'PrintDependencyError';
	}
}

/** `print_device:{device_id}` doc in DB `printing` (print-server-implementation-plan §3.2). */
export interface PrintDeviceDoc {
	_id: string;
	_rev?: string;
	type: 'print_device';
	schema_v: 1;
	device_id: string;
	name: string;
	shelter_code: string;
	station: string | null;
	host_kind: 'standalone' | 'kiosk';
	secret_hash: string;
	secret_prefix: string;
	status: 'active' | 'inactive';
	last_seen_at: string | null;
	queue_state: 'ready' | 'disabled' | 'missing' | 'unknown';
	agent_version: string | null;
	created_at: string;
	updated_at: string;
	created_by: string;
}

export interface PrintDeviceLookup {
	getDeviceByDeviceId(deviceId: string): Promise<PrintDeviceDoc | null>;
}

export interface PrintDevicePrincipal {
	/** Doc `_id` (`print_device:{device_id}`) — also the `printer_id` of its jobs. */
	readonly registry_id: string;
	readonly device_id: string;
	readonly name: string;
	readonly shelter_code: string;
}

export function generatePrintSecret(): string {
	return `sk_print_${randomBytes(32).toString('hex')}`;
}

export function hashPrintSecret(secret: string): string {
	return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function hasMatchingSecret(secret: string, persistedHash: string): boolean {
	const supplied = createHash('sha256').update(secret, 'utf8').digest();
	const stored = Buffer.from(persistedHash, 'hex');
	return stored.length === supplied.length && timingSafeEqual(supplied, stored);
}

/** Unknown, wrong, and inactive devices intentionally share PrintAuthError. */
export async function authenticatePrintDeviceDoc(
	deviceId: string,
	secret: string,
	lookup: PrintDeviceLookup
): Promise<PrintDeviceDoc> {
	if (!deviceId || !secret) throw new PrintAuthError();

	const device = await lookup.getDeviceByDeviceId(deviceId);
	if (!device || device.device_id !== deviceId || device.status !== 'active') {
		throw new PrintAuthError();
	}
	if (!hasMatchingSecret(secret, device.secret_hash)) throw new PrintAuthError();
	return device;
}

export function toPrintDevicePrincipal(device: PrintDeviceDoc): PrintDevicePrincipal {
	return {
		registry_id: device._id,
		device_id: device.device_id,
		name: device.name,
		shelter_code: device.shelter_code
	};
}

export async function authenticatePrintDevice(
	deviceId: string,
	secret: string,
	lookup: PrintDeviceLookup
): Promise<PrintDevicePrincipal> {
	return toPrintDevicePrincipal(await authenticatePrintDeviceDoc(deviceId, secret, lookup));
}
