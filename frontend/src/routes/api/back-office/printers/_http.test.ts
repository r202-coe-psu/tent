import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrintDependencyError } from '$lib/server/printers/device-credentials';
import { PrintShelterClosedError } from '$lib/server/printers/printer-admin.server';
import { printerAdminError } from './_http';

const UNAVAILABLE = {
	error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Print service unavailable' }
};

describe('printerAdminError: dependency failures (FR-25, FR-27)', () => {
	let logged: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logged = vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('answers 503 without leaking the detail (printing service misconfigured)', async () => {
		const response = printerAdminError(
			new PrintDependencyError('COUCHDB_PRINTING_SERVICE_URL is invalid')
		);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual(UNAVAILABLE);
	});

	it('answers CouchDB being unreachable with the 503 envelope, not a 500', async () => {
		const down = new TypeError('fetch failed', {
			cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
		});

		const response = printerAdminError(down);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual(UNAVAILABLE);
	});

	it('keeps 500 INTERNAL for an unknown error', async () => {
		const response = printerAdminError(new Error('bug'));

		expect(response.status).toBe(500);
		expect((await response.json()).error.code).toBe('INTERNAL');
	});

	it('logs the cause of an unknown error for the operator', () => {
		printerAdminError(new Error('bug'));

		expect(logged).toHaveBeenCalledWith('[printing] admin request failed:', 'bug');
	});
});

describe('printerAdminError: closed shelter (O-11)', () => {
	it('answers 422 SHELTER_CLOSED', async () => {
		const response = printerAdminError(new PrintShelterClosedError());

		expect(response.status).toBe(422);
		expect((await response.json()).error.code).toBe('SHELTER_CLOSED');
	});
});
