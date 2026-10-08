import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/couch-admin', () => ({ adminRaw: vi.fn() }));

import { ScannerConflictError, ScannerDependencyError } from './device-credentials';
import {
	mergeCouchSecurity,
	SCANNER_SECRETS_SECURITY,
	StaffPinSecretStore,
	StaffPinUnavailableError
} from './staff-pin-store';

type Raw = (
	path: string,
	method: string,
	body?: unknown
) => Promise<{ status: number; data: unknown }>;

const secretDoc = {
	_id: 'staff_pin:kiosk-01',
	_rev: '1-s',
	type: 'scanner_staff_pin',
	schema_v: 1,
	device_id: 'kiosk-01',
	pin: '482913',
	is_default: true,
	updated_at: '2026-10-08T00:00:00Z',
	updated_by: 'sa'
};

const input = {
	device_id: 'kiosk-01',
	pin: '582047',
	is_default: false,
	updated_at: '2026-10-08T01:00:00Z',
	updated_by: 'sa'
};

/** Fake CouchDB: answers ensure calls; `docs` handles doc-level requests. */
function couch(
	docs: Raw,
	options: { createStatus?: number; security?: unknown; securityPutStatus?: number } = {}
) {
	return vi.fn<Raw>(async (path, method, body) => {
		if (path === '/scanner_secrets' && method === 'PUT') {
			return { status: options.createStatus ?? 201, data: { ok: true } };
		}
		if (path === '/scanner_secrets/_security' && method === 'GET') {
			return { status: 200, data: options.security ?? {} };
		}
		if (path === '/scanner_secrets/_security' && method === 'PUT') {
			return { status: options.securityPutStatus ?? 200, data: { ok: true } };
		}
		return docs(path, method, body);
	});
}

describe('mergeCouchSecurity', () => {
	it('adds the admin-only roles to an empty _security', () => {
		expect(mergeCouchSecurity({}, SCANNER_SECRETS_SECURITY)).toEqual({
			admins: { names: [], roles: ['_admin'] },
			members: { names: [], roles: ['_admin'] }
		});
	});

	it('is a no-op when already current and never drops existing entries', () => {
		expect(
			mergeCouchSecurity(
				{ admins: { roles: ['_admin'] }, members: { roles: ['_admin'] } },
				SCANNER_SECRETS_SECURITY
			)
		).toBeNull();
		expect(
			mergeCouchSecurity(
				{ admins: { names: ['ops'], roles: [] }, members: { roles: ['_admin'] } },
				SCANNER_SECRETS_SECURITY
			)
		).toEqual({
			admins: { names: ['ops'], roles: ['_admin'] },
			members: { names: [], roles: ['_admin'] }
		});
	});
});

describe('StaffPinSecretStore', () => {
	let docs: ReturnType<typeof vi.fn<Raw>>;

	beforeEach(() => {
		docs = vi.fn<Raw>(async () => ({ status: 201, data: { ok: true, rev: '2-s' } }));
	});

	it('reads a PIN doc by device id and returns null when missing', async () => {
		docs.mockResolvedValueOnce({ status: 200, data: secretDoc });
		const raw = couch(docs);
		const store = new StaffPinSecretStore(raw);

		expect(await store.get('kiosk-01')).toEqual(secretDoc);
		expect(raw).toHaveBeenCalledWith('/scanner_secrets/staff_pin%3Akiosk-01', 'GET', undefined);

		docs.mockResolvedValueOnce({ status: 404, data: { error: 'not_found' } });
		expect(await store.get('kiosk-01')).toBeNull();
	});

	it('maps an unreachable store, bad status, or malformed doc to StaffPinUnavailableError', async () => {
		const store = new StaffPinSecretStore(couch(docs));

		docs.mockRejectedValueOnce(new Error('ECONNREFUSED'));
		await expect(store.get('kiosk-01')).rejects.toBeInstanceOf(StaffPinUnavailableError);

		docs.mockResolvedValueOnce({ status: 500, data: null });
		await expect(store.get('kiosk-01')).rejects.toBeInstanceOf(StaffPinUnavailableError);

		docs.mockResolvedValueOnce({ status: 200, data: { ...secretDoc, pin: 'abc' } });
		await expect(store.get('kiosk-01')).rejects.toBeInstanceOf(StaffPinUnavailableError);

		docs.mockResolvedValueOnce({ status: 200, data: { ...secretDoc, device_id: 'kiosk-02' } });
		await expect(store.get('kiosk-01')).rejects.toBeInstanceOf(StaffPinUnavailableError);

		expect(new StaffPinUnavailableError()).toBeInstanceOf(ScannerDependencyError);
	});

	it('ensures the DB and admin-only _security once before the first write', async () => {
		const raw = couch(docs);
		const store = new StaffPinSecretStore(raw);

		const saved = await store.put(input, null);
		await store.put(input, '2-s');

		expect(saved._rev).toBe('2-s');
		const calls = raw.mock.calls.map(([path, method]) => `${method} ${path}`);
		expect(calls).toEqual([
			'PUT /scanner_secrets',
			'GET /scanner_secrets/_security',
			'PUT /scanner_secrets/_security',
			'PUT /scanner_secrets/staff_pin%3Akiosk-01',
			'PUT /scanner_secrets/staff_pin%3Akiosk-01'
		]);
		expect(raw.mock.calls[2]?.[2]).toEqual({
			admins: { names: [], roles: ['_admin'] },
			members: { names: [], roles: ['_admin'] }
		});
		const firstBody = raw.mock.calls[3]?.[2] as Record<string, unknown>;
		expect(firstBody).not.toHaveProperty('_rev');
		expect(firstBody).toMatchObject({
			_id: 'staff_pin:kiosk-01',
			type: 'scanner_staff_pin',
			schema_v: 1,
			pin: '582047'
		});
		expect((raw.mock.calls[4]?.[2] as Record<string, unknown>)._rev).toBe('2-s');
	});

	it('accepts an existing DB (412) and leaves current _security untouched', async () => {
		const raw = couch(docs, {
			createStatus: 412,
			security: { admins: { roles: ['_admin'] }, members: { roles: ['_admin'] } }
		});
		await new StaffPinSecretStore(raw).put(input, null);

		expect(raw.mock.calls.some(([p, m]) => p.endsWith('/_security') && m === 'PUT')).toBe(false);
	});

	it('retries the ensure step after a failure instead of caching it', async () => {
		const raw = couch(docs, { securityPutStatus: 500 });
		const store = new StaffPinSecretStore(raw);

		await expect(store.put(input, null)).rejects.toBeInstanceOf(StaffPinUnavailableError);
		expect(docs).not.toHaveBeenCalled();
		await expect(store.put(input, null)).rejects.toBeInstanceOf(StaffPinUnavailableError);
		expect(raw.mock.calls.filter(([p, m]) => p === '/scanner_secrets' && m === 'PUT')).toHaveLength(
			2
		);
	});

	it('maps a stale rev to a conflict', async () => {
		docs.mockResolvedValueOnce({ status: 409, data: { error: 'conflict' } });
		await expect(new StaffPinSecretStore(couch(docs)).put(input, null)).rejects.toBeInstanceOf(
			ScannerConflictError
		);
	});

	it('removes a PIN doc by current rev, or a given rev, and ignores a missing doc', async () => {
		const store = new StaffPinSecretStore(couch(docs));

		docs
			.mockResolvedValueOnce({ status: 200, data: secretDoc })
			.mockResolvedValueOnce({ status: 200, data: { ok: true } });
		await store.remove('kiosk-01');
		expect(docs.mock.calls[1]?.slice(0, 2)).toEqual([
			'/scanner_secrets/staff_pin%3Akiosk-01?rev=1-s',
			'DELETE'
		]);

		docs.mockResolvedValueOnce({ status: 200, data: { ok: true } });
		await store.remove('kiosk-01', '3-x');
		expect(docs.mock.calls[2]?.[0]).toBe('/scanner_secrets/staff_pin%3Akiosk-01?rev=3-x');

		docs.mockResolvedValueOnce({ status: 404, data: { error: 'not_found' } });
		await expect(store.remove('kiosk-01')).resolves.toBeUndefined();

		docs.mockResolvedValueOnce({ status: 409, data: { error: 'conflict' } });
		await expect(store.remove('kiosk-01', '3-x')).rejects.toBeInstanceOf(ScannerConflictError);
	});
});
