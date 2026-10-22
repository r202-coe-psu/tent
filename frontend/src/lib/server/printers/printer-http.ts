import { json } from '@sveltejs/kit';
import { z } from 'zod';
import {
	authenticatePrintDeviceDoc,
	DEPENDENCY_UNAVAILABLE,
	DEVICE_AUTH_FAILED,
	PrintAuthError,
	toPrintDevicePrincipal,
	type PrintDeviceDoc,
	type PrintDeviceLookup,
	type PrintDevicePrincipal
} from './device-credentials';

/** HTTP plumbing shared by the Pi routes under `/api/v1/printer/*` (plan §4.1). */
export const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

export function failedAuth(): Response {
	return json(
		{ error: { code: DEVICE_AUTH_FAILED, message: 'Device authentication failed' } },
		{ status: 401, headers: noStoreHeaders }
	);
}

export function unavailable(): Response {
	return json(
		{ error: { code: DEPENDENCY_UNAVAILABLE, message: 'Print service unavailable' } },
		{ status: 503, headers: noStoreHeaders }
	);
}

export function validationFailed(): Response {
	return json(
		{ error: { code: 'VALIDATION', message: 'Invalid request body' } },
		{ status: 422, headers: noStoreHeaders }
	);
}

export function jobConflict(): Response {
	return json(
		{ error: { code: 'JOB_CONFLICT', message: 'Print job is not a printing job of this printer' } },
		{ status: 409, headers: noStoreHeaders }
	);
}

/** PrintAuthError -> 401, anything else -> 503 (details are never echoed to the device). */
export function errorResponse(error: unknown): Response {
	return error instanceof PrintAuthError ? failedAuth() : unavailable();
}

export async function authenticateRequest(
	request: Request,
	lookup: PrintDeviceLookup
): Promise<{ principal: PrintDevicePrincipal; device: PrintDeviceDoc }> {
	const device = await authenticatePrintDeviceDoc(
		request.headers.get('x-device-id') ?? '',
		request.headers.get('x-device-secret') ?? '',
		lookup
	);
	return { principal: toPrintDevicePrincipal(device), device };
}

/** Body of an agent poll; a missing or malformed body is the agent's problem, not an error. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
	try {
		const body: unknown = await request.json();
		return typeof body === 'object' && body !== null && !Array.isArray(body)
			? (body as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

const QUEUE_STATES: readonly PrintDeviceDoc['queue_state'][] = [
	'ready',
	'disabled',
	'missing',
	'unknown'
];

export function parseQueueState(value: unknown): PrintDeviceDoc['queue_state'] {
	return QUEUE_STATES.find((state) => state === value) ?? 'unknown';
}

const ipSchema = z.union([z.ipv4(), z.ipv6()]);
const MAX_LOCAL_IPS = 8;

/** The agent's reported LAN IPs, keeping only real IP addresses; `undefined` if none were sent. */
export function parseLocalIps(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.filter((ip) => ipSchema.safeParse(ip).success).slice(0, MAX_LOCAL_IPS);
}
