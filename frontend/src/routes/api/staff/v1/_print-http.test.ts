import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrintDependencyError } from '$lib/server/printers/device-credentials';
import { printErrorResponse } from './_print-http';

const UNAVAILABLE = {
	error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Print service unavailable' }
};

describe('printErrorResponse: dependency failures (FR-25, FR-27)', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('hides the env var name of a misconfigured printing service from staff', async () => {
		const response = printErrorResponse(
			new PrintDependencyError('COUCHDB_PRINTING_SERVICE_URL is missing')
		);

		expect(response.status).toBe(503);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual(UNAVAILABLE);
	});

	it('logs the detail server-side', () => {
		printErrorResponse(new PrintDependencyError('COUCHDB_PRINTING_SERVICE_URL is missing'));

		expect(console.error).toHaveBeenCalledWith(
			'[printing] dependency unavailable:',
			'COUCHDB_PRINTING_SERVICE_URL is missing'
		);
	});

	it('answers CouchDB being unreachable with the 503 envelope instead of rethrowing', async () => {
		const down = new TypeError('fetch failed', {
			cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
		});

		const response = printErrorResponse(down);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual(UNAVAILABLE);
	});

	it('still rethrows an unknown error', () => {
		expect(() => printErrorResponse(new Error('bug'))).toThrow('bug');
	});
});
