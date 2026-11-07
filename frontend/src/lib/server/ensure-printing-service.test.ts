import { describe, expect, it, vi } from 'vitest';

import {
	buildPrintingServiceUserBody,
	ensurePrintingService,
	printingServiceUserPath
} from './ensure-printing-service';
import type { CouchReq } from './ensure-public-writer';

describe('printingServiceUserPath', () => {
	it('builds the CouchDB _users doc id path', () => {
		expect(printingServiceUserPath('printing_service')).toBe(
			'/_users/org.couchdb.user:printing_service'
		);
	});
});

describe('buildPrintingServiceUserBody', () => {
	it('creates a roleless user doc', () => {
		expect(buildPrintingServiceUserBody('printing_service', 'secret')).toEqual({
			name: 'printing_service',
			password: 'secret',
			display_name: 'Printing Service (BFF)',
			roles: [],
			type: 'user',
			shelter_id: null,
			affiliation_tags: []
		});
	});
});

describe('ensurePrintingService', () => {
	const serviceUrl = 'http://printing_service:secret@couchdb:5984';

	it('skips when the service URL is unset', async () => {
		const couchReq = vi.fn() as unknown as CouchReq;
		await expect(ensurePrintingService(couchReq, undefined)).resolves.toEqual({
			outcome: 'skipped'
		});
		expect(couchReq).not.toHaveBeenCalled();
	});

	it('returns invalid_format when the service URL is malformed', async () => {
		const couchReq = vi.fn() as unknown as CouchReq;
		await expect(
			ensurePrintingService(couchReq, 'http://printing_service:@couchdb:5984')
		).resolves.toEqual({ outcome: 'invalid_format' });
		expect(couchReq).not.toHaveBeenCalled();
	});

	it('creates the user when PUT returns 201', async () => {
		const couchReq = vi.fn(async () => ({ status: 201, data: { ok: true } })) as CouchReq;
		await expect(ensurePrintingService(couchReq, serviceUrl)).resolves.toEqual({
			outcome: 'created',
			username: 'printing_service'
		});
		expect(couchReq).toHaveBeenCalledWith(
			'PUT',
			'/_users/org.couchdb.user:printing_service',
			buildPrintingServiceUserBody('printing_service', 'secret')
		);
	});

	it('treats 409 as already exists', async () => {
		const couchReq = vi.fn(async () => ({ status: 409, data: { error: 'conflict' } })) as CouchReq;
		await expect(ensurePrintingService(couchReq, serviceUrl)).resolves.toEqual({
			outcome: 'already_exists',
			username: 'printing_service'
		});
	});

	it('throws on unexpected PUT status without leaking the password', async () => {
		const couchReq = vi.fn(async () => ({ status: 500, data: null })) as CouchReq;
		const failure = ensurePrintingService(couchReq, serviceUrl);
		await expect(failure).rejects.toThrow('PUT _users/printing_service failed (HTTP 500)');
		await expect(failure).rejects.not.toThrow(/secret/);
	});

	it('dry-run GET reports would_create when missing', async () => {
		const couchReq = vi.fn(async () => ({ status: 404, data: { error: 'not_found' } })) as CouchReq;
		await expect(ensurePrintingService(couchReq, serviceUrl, { dryRun: true })).resolves.toEqual({
			outcome: 'would_create',
			username: 'printing_service'
		});
		expect(couchReq).toHaveBeenCalledWith('GET', '/_users/org.couchdb.user:printing_service');
		expect(couchReq).toHaveBeenCalledTimes(1);
	});

	it('dry-run GET reports already_exists when present', async () => {
		const couchReq = vi.fn(async () => ({
			status: 200,
			data: { name: 'printing_service' }
		})) as CouchReq;
		await expect(ensurePrintingService(couchReq, serviceUrl, { dryRun: true })).resolves.toEqual({
			outcome: 'already_exists',
			username: 'printing_service'
		});
	});
});
