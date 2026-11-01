import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {} as Record<string, string | undefined>,
	dev: true,
	adminRaw: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));
vi.mock('$app/environment', () => ({
	get dev() {
		return mocks.dev;
	}
}));
vi.mock('$lib/server/couch-admin', () => ({ adminRaw: mocks.adminRaw }));

import { PrintDependencyError } from '$lib/server/printers/device-credentials';
import { printingRaw, printingServiceName } from './couch-printing-service';

const SERVICE_URL = 'http://printing_service:s3cret@couchdb:5984';
const EXPECTED_BASIC = `Basic ${Buffer.from('printing_service:s3cret').toString('base64')}`;

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('printingRaw', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		mocks.adminRaw.mockReset();
		mocks.env.COUCHDB_PRINTING_SERVICE_URL = undefined;
		mocks.dev = true;
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('calls the printing_service base with its own basic-auth and returns status + data', async () => {
		mocks.env.COUCHDB_PRINTING_SERVICE_URL = SERVICE_URL;
		fetchMock.mockResolvedValue(jsonResponse(201, { ok: true, id: 'job:1' }));

		const res = await printingRaw('/printing/job%3A1', 'PUT', { type: 'print_job' });

		expect(res).toEqual({ status: 201, data: { ok: true, id: 'job:1' } });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('http://couchdb:5984/printing/job%3A1');
		expect(init.method).toBe('PUT');
		expect(init.headers.Authorization).toBe(EXPECTED_BASIC);
		expect(init.body).toBe('{"type":"print_job"}');
		expect(mocks.adminRaw).not.toHaveBeenCalled();
	});

	it('returns data null for a non-JSON body and sends no body when none is given', async () => {
		mocks.env.COUCHDB_PRINTING_SERVICE_URL = SERVICE_URL;
		fetchMock.mockResolvedValue(new Response('boom', { status: 502 }));

		const res = await printingRaw('/printing/_all_docs', 'GET');

		expect(res).toEqual({ status: 502, data: null });
		expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
	});

	it('forwards the abort signal for long-poll _changes', async () => {
		mocks.env.COUCHDB_PRINTING_SERVICE_URL = SERVICE_URL;
		fetchMock.mockResolvedValue(jsonResponse(200, { results: [] }));
		const controller = new AbortController();

		await printingRaw('/printing/_changes?feed=longpoll', 'GET', undefined, controller.signal);

		expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
	});

	it('in dev without the env var falls back to adminRaw and warns once', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mocks.adminRaw.mockResolvedValue({ status: 200, data: { from: 'admin' } });

		const first = await printingRaw('/printing/doc', 'GET');
		await printingRaw('/printing/doc', 'GET');

		expect(first).toEqual({ status: 200, data: { from: 'admin' } });
		expect(mocks.adminRaw).toHaveBeenCalledWith('/printing/doc', 'GET', undefined, undefined);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('outside dev without the env var fails closed with a 503-mapped error and never uses admin', async () => {
		mocks.dev = false;

		await expect(printingRaw('/printing/doc', 'GET')).rejects.toBeInstanceOf(PrintDependencyError);

		expect(mocks.adminRaw).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('fails closed on a malformed env var even in dev', async () => {
		mocks.env.COUCHDB_PRINTING_SERVICE_URL = 'http://printing_service:@couchdb:5984';

		await expect(printingRaw('/printing/doc', 'GET')).rejects.toBeInstanceOf(PrintDependencyError);

		expect(mocks.adminRaw).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('printingServiceName', () => {
	it('is the username from the env URL, or null when unset', () => {
		mocks.env.COUCHDB_PRINTING_SERVICE_URL = SERVICE_URL;
		expect(printingServiceName()).toBe('printing_service');
		mocks.env.COUCHDB_PRINTING_SERVICE_URL = undefined;
		expect(printingServiceName()).toBeNull();
	});
});
