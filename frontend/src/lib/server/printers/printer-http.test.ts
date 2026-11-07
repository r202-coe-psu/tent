import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrintAuthError, PrintDependencyError } from './device-credentials';
import { errorResponse } from './printer-http';

describe('errorResponse', () => {
	let logged: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logged = vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('answers an auth failure with 401 and logs nothing', () => {
		expect(errorResponse(new PrintAuthError()).status).toBe(401);
		expect(logged).not.toHaveBeenCalled();
	});

	it('answers anything else with 503 and logs the cause for the operator', async () => {
		const response = errorResponse(
			new PrintDependencyError('COUCHDB_PRINTING_SERVICE_URL is invalid')
		);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Print service unavailable' }
		});
		expect(logged).toHaveBeenCalledWith(
			'[printing] pi request failed:',
			'COUCHDB_PRINTING_SERVICE_URL is invalid'
		);
	});

	it('logs a non-Error throw as is', () => {
		errorResponse('boom');
		expect(logged).toHaveBeenCalledWith('[printing] pi request failed:', 'boom');
	});
});
