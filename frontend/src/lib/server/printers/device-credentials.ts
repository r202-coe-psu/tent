import {
	generateDeviceSecret,
	hashDeviceSecret,
	verifyDeviceSecret
} from '$lib/server/device-auth/secret';

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

/**
 * `printing_{code}` does not exist (never provisioned, or dropped by `close-shelter-printing` in
 * another process). Still a 503 for callers that do not recover from it.
 */
export class PrintShelterDbMissingError extends PrintDependencyError {
	constructor() {
		super();
		this.name = 'PrintShelterDbMissingError';
	}
}

/** `print_device:{device_id}` doc in DB `printing_devices` (CR-222). */
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
	/** Scanner device (`device_id`) the printer is built into; absent on docs from before the link. */
	kiosk_device_id?: string | null;
	secret_hash: string;
	secret_prefix: string;
	status: 'active' | 'inactive';
	last_seen_at: string | null;
	queue_state: 'ready' | 'disabled' | 'missing' | 'unknown';
	agent_version: string | null;
	/** LAN IPv4/IPv6 addresses the agent reported on hello; absent until it first does. */
	local_ips?: string[];
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
	return generateDeviceSecret('sk_print_');
}

export function hashPrintSecret(secret: string): string {
	return hashDeviceSecret(secret);
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
	if (!verifyDeviceSecret(secret, device.secret_hash)) throw new PrintAuthError();
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
