import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
// eslint-disable-next-line no-restricted-imports -- server-safe domain schema; feature barrel pulls client UI/query code
import {
	scannerDevicePersistedSchema,
	type PersistedScannerDevice,
	type ScannerBootstrapDevice
} from '$lib/features/scanners/domain/scanner.schema';

export const DEVICE_AUTH_FAILED = 'DEVICE_AUTH_FAILED' as const;
export const DEPENDENCY_UNAVAILABLE = 'DEPENDENCY_UNAVAILABLE' as const;

/** Errors intentionally carry no credential material or upstream response body. */
export class ScannerAuthError extends Error {
	readonly code = DEVICE_AUTH_FAILED;

	constructor() {
		super('Device authentication failed');
		this.name = 'ScannerAuthError';
	}
}

export class ScannerDependencyError extends Error {
	readonly code = DEPENDENCY_UNAVAILABLE;

	constructor(message = 'Scanner credential service unavailable') {
		super(message);
		this.name = 'ScannerDependencyError';
	}
}

export class ScannerMalformedDeviceError extends ScannerDependencyError {
	constructor() {
		super('Stored scanner device is malformed');
		this.name = 'ScannerMalformedDeviceError';
	}
}

export class ScannerConflictError extends Error {
	readonly code = 'CONFLICT' as const;

	constructor(message = 'Device ID already exists') {
		super(message);
		this.name = 'ScannerConflictError';
	}
}

export class ScannerValidationError extends Error {
	readonly code = 'VALIDATION' as const;

	constructor(message: string) {
		super(message);
		this.name = 'ScannerValidationError';
	}
}

export class ScannerShelterNotFoundError extends Error {
	readonly code = 'NOT_FOUND' as const;

	constructor() {
		super('Shelter not found');
		this.name = 'ScannerShelterNotFoundError';
	}
}

export interface ScannerDevicePrincipal {
	/** Internal registry id used only for server-side heartbeat updates. */
	readonly registry_id: string;
	readonly device_id: string;
	readonly name: string;
	readonly shelter_code: string;
	readonly station_name: string;
}

export interface ScannerDeviceLookup {
	getDeviceByDeviceId(deviceId: string): Promise<PersistedScannerDevice | null>;
}

export interface ScannerDeviceSummaryLike {
	device_id: string;
	name: string;
	shelter_code: string;
	station_name: string;
	status: 'active' | 'inactive';
	last_seen_at: string | null;
}

export function generateScannerSecret(): string {
	return `sk_scan_${randomBytes(32).toString('hex')}`;
}

export function hashScannerSecret(secret: string): string {
	return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function parsePersistedDevice(value: unknown): PersistedScannerDevice {
	const parsed = scannerDevicePersistedSchema.safeParse(value);
	if (!parsed.success) throw new ScannerMalformedDeviceError();
	return parsed.data;
}

function hasMatchingSecret(secret: string, persistedHash: string): boolean {
	const supplied = createHash('sha256').update(secret, 'utf8').digest();
	const stored = Buffer.from(persistedHash, 'hex');
	return stored.length === supplied.length && timingSafeEqual(supplied, stored);
}

/**
 * Resolve and authenticate a scanner without exposing the stored verifier.
 * Unknown, wrong, and inactive devices intentionally share ScannerAuthError.
 */
export async function authenticateScannerDevice(
	deviceId: string,
	secret: string,
	lookup: ScannerDeviceLookup
): Promise<ScannerDevicePrincipal> {
	if (!deviceId || !secret) throw new ScannerAuthError();

	const rawDevice = await lookup.getDeviceByDeviceId(deviceId);
	if (!rawDevice) throw new ScannerAuthError();

	const device = parsePersistedDevice(rawDevice);
	if (device.device_id !== deviceId || device.status !== 'active') {
		throw new ScannerAuthError();
	}
	if (!hasMatchingSecret(secret, device.secret_hash)) throw new ScannerAuthError();

	return {
		registry_id: device._id,
		device_id: device.device_id,
		name: device.name,
		shelter_code: device.shelter_code,
		station_name: device.station_name
	};
}

export function toBootstrapDevice(
	principal: ScannerDevicePrincipal,
	status: 'active' | 'inactive' = 'active',
	last_seen_at: string | null = null,
	shelterName = principal.shelter_code
): ScannerBootstrapDevice {
	return {
		device_id: principal.device_id,
		name: principal.name,
		shelter_code: principal.shelter_code,
		shelter_name: shelterName,
		station_name: principal.station_name,
		status,
		last_seen_at
	};
}
