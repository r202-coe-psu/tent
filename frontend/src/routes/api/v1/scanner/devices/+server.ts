import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeUserWrite, serviceError, ServiceError } from '$lib/server/couch-admin';
import {
	ScannerConflictError,
	ScannerDependencyError,
	ScannerShelterNotFoundError
} from '$lib/server/scanners/device-credentials';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';
// eslint-disable-next-line no-restricted-imports -- server-safe domain schema; feature barrel pulls client UI/query code
import {
	scannerDeviceInputSchema,
	toScannerDeviceSummary
} from '$lib/features/scanners/domain/scanner.schema';

export const prerender = false;

function noStoreHeaders(): HeadersInit {
	return { 'cache-control': 'no-store', pragma: 'no-cache' };
}

function scannerError(error: unknown): Response | null {
	if (error instanceof ScannerConflictError) {
		return json(
			{ error: { code: 'CONFLICT', message: 'Device ID already exists' } },
			{ status: 409, headers: noStoreHeaders() }
		);
	}
	if (error instanceof ScannerShelterNotFoundError) {
		return json(
			{ error: { code: 'NOT_FOUND', message: 'Shelter not found' } },
			{ status: 404, headers: noStoreHeaders() }
		);
	}
	if (error instanceof ScannerDependencyError) {
		return json(
			{
				error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Scanner credential service unavailable' }
			},
			{ status: 503, headers: noStoreHeaders() }
		);
	}
	return null;
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const caller = await authorizeUserWrite(request.headers.get('cookie'));
		if (!caller.isSA) throw new ServiceError('FORBIDDEN', 'Requires system_admin');

		const body: unknown = await request.json().catch(() => ({}));
		const parsed = scannerDeviceInputSchema.safeParse(body);
		if (!parsed.success) {
			throw new ServiceError(
				'VALIDATION',
				parsed.error.issues[0]?.message ?? 'Invalid scanner device'
			);
		}

		const created = await scannerDeviceRepository.createDevice(parsed.data, caller.name);
		return json(
			{
				device: toScannerDeviceSummary(created.device),
				plaintext_secret: created.plaintext_secret
			},
			{ status: 201, headers: noStoreHeaders() }
		);
	} catch (error) {
		const mapped = scannerError(error);
		if (mapped) return mapped;
		return serviceError(error);
	}
};
