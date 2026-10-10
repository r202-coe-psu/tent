import { describe, expect, it } from 'vitest';
import {
	backfillStaffPins,
	devicesWithoutStaffPin,
	STAFF_PIN_BACKFILL_ACTOR
} from './staff-pin-backfill';
import type { CouchAdminCall } from './staff-pin-secret';

const NOW = '2026-10-10T03:00:00.000Z';

function deviceV1(deviceId: string): Record<string, unknown> {
	return {
		_id: `scanner_device:${deviceId}`,
		_rev: '1-r',
		type: 'scanner_device',
		schema_v: 1,
		created_at: '2026-10-01T00:00:00Z',
		updated_at: '2026-10-01T00:00:00Z',
		created_by: 'sa',
		device_id: deviceId,
		name: `Kiosk ${deviceId}`,
		shelter_code: 'SH001',
		station_name: 'ประตู 1',
		secret_hash: 'a'.repeat(64),
		secret_prefix: 'sk_scan_aaaaaaaa...',
		status: 'active',
		last_seen_at: null
	};
}

function secret(deviceId: string, pin: string): Record<string, unknown> {
	return {
		_id: `staff_pin:${deviceId}`,
		_rev: '1-s',
		type: 'scanner_staff_pin',
		schema_v: 1,
		device_id: deviceId,
		pin,
		is_default: false,
		updated_at: '2026-10-05T00:00:00Z',
		updated_by: 'sa'
	};
}

type Db = Map<string, Record<string, unknown>>;

/**
 * In-memory CouchDB with the `registry` and `scanner_secrets` databases: docs with `_rev` checks,
 * `_all_docs` ranges, `_security`, and an optional hook that fails a registry write.
 */
function fakeCouch(
	options: {
		registry?: Record<string, unknown>[];
		secrets?: Record<string, unknown>[] | null;
		security?: unknown;
		failRegistryPut?: (id: string) => number | null;
	} = {}
) {
	const dbs = new Map<string, Db>();
	dbs.set('registry', new Map((options.registry ?? []).map((d) => [String(d._id), d])));
	if (options.secrets !== null) {
		dbs.set('scanner_secrets', new Map((options.secrets ?? []).map((d) => [String(d._id), d])));
	}
	let security: unknown = options.security ?? {};
	let revs = 10;
	const writes: string[] = [];

	const call: CouchAdminCall = async (path, method, body) => {
		const url = new URL(path, 'http://couch');
		const [dbName, ...rest] = url.pathname.slice(1).split('/');
		const docId = decodeURIComponent(rest.join('/'));
		if (!docId) {
			if (method === 'PUT') {
				if (dbs.has(dbName)) return { status: 412, data: null };
				dbs.set(dbName, new Map());
				writes.push(`create ${dbName}`);
				return { status: 201, data: { ok: true } };
			}
			return { status: dbs.has(dbName) ? 200 : 404, data: null };
		}
		const db = dbs.get(dbName);
		if (!db) return { status: 404, data: { error: 'not_found' } };
		if (docId === '_security') {
			if (method === 'PUT') security = body;
			return { status: 200, data: security };
		}
		if (docId === '_all_docs') {
			const start = JSON.parse(url.searchParams.get('startkey') ?? '""') as string;
			const end = JSON.parse(url.searchParams.get('endkey') ?? '"\\ufff0"') as string;
			const rows = [...db.entries()]
				.filter(([id]) => id >= start && id <= end)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([id, doc]) => ({ id, key: id, value: { rev: doc._rev }, doc }));
			return { status: 200, data: { rows } };
		}
		const current = db.get(docId);
		if (method === 'GET')
			return current ? { status: 200, data: current } : { status: 404, data: null };
		if (method === 'PUT') {
			const failed = dbName === 'registry' ? options.failRegistryPut?.(docId) : null;
			if (failed) return { status: failed, data: null };
			const doc = body as Record<string, unknown>;
			if ((current?._rev ?? undefined) !== (doc._rev ?? undefined)) {
				return { status: 409, data: { error: 'conflict' } };
			}
			const rev = `${(revs += 1)}-w`;
			db.set(docId, { ...doc, _rev: rev });
			writes.push(`put ${dbName}/${docId}`);
			return { status: 201, data: { ok: true, rev } };
		}
		if (method === 'DELETE') {
			if (!current) return { status: 404, data: null };
			if (url.searchParams.get('rev') !== current._rev) return { status: 409, data: null };
			db.delete(docId);
			writes.push(`delete ${dbName}/${docId}`);
			return { status: 200, data: { ok: true } };
		}
		return { status: 405, data: null };
	};
	return { call, dbs, writes, security: () => security };
}

const deps = { now: () => NOW, generate: () => '582047' };

describe('devicesWithoutStaffPin', () => {
	it('keeps only the devices that have no PIN doc, in order', () => {
		expect(devicesWithoutStaffPin(['a', 'b', 'c'], new Set(['b']))).toEqual(['a', 'c']);
		expect(devicesWithoutStaffPin([], new Set())).toEqual([]);
	});
});

describe('backfillStaffPins', () => {
	it('dry-run lists the devices that would get a PIN and writes nothing', async () => {
		const couch = fakeCouch({
			registry: [deviceV1('kiosk-01'), deviceV1('kiosk-02'), { _id: 'shelter:x', type: 'shelter' }],
			secrets: [secret('kiosk-02', '482913')]
		});

		const report = await backfillStaffPins(couch.call, { ...deps, dryRun: true });

		expect(report).toEqual({ pinned: ['kiosk-01'], conflicts: [] });
		expect(couch.writes).toEqual([]);
	});

	it('dry-run treats a missing scanner_secrets DB as no PINs at all', async () => {
		const couch = fakeCouch({ registry: [deviceV1('kiosk-01')], secrets: null });
		const report = await backfillStaffPins(couch.call, { ...deps, dryRun: true });
		expect(report.pinned).toEqual(['kiosk-01']);
		expect(couch.writes).toEqual([]);
	});

	it('gives a v1 device a default PIN and stamps the registry doc v2', async () => {
		const couch = fakeCouch({ registry: [deviceV1('kiosk-01')], secrets: null });

		const report = await backfillStaffPins(couch.call, { ...deps, dryRun: false });

		expect(report).toEqual({ pinned: ['kiosk-01'], conflicts: [] });
		expect(couch.dbs.get('scanner_secrets')?.get('staff_pin:kiosk-01')).toMatchObject({
			type: 'scanner_staff_pin',
			schema_v: 1,
			device_id: 'kiosk-01',
			pin: '582047',
			is_default: true,
			updated_at: NOW,
			updated_by: STAFF_PIN_BACKFILL_ACTOR
		});
		expect(couch.dbs.get('registry')?.get('scanner_device:kiosk-01')).toMatchObject({
			schema_v: 2,
			name: 'Kiosk kiosk-01',
			updated_at: NOW,
			staff_pin_set: true,
			staff_pin_is_default: true,
			staff_pin_updated_at: NOW,
			staff_pin_updated_by: STAFF_PIN_BACKFILL_ACTOR
		});
		expect(couch.security()).toEqual({
			admins: { names: [], roles: ['_admin'] },
			members: { names: [], roles: ['_admin'] }
		});
	});

	it('never touches a PIN that already exists, and a second run changes nothing', async () => {
		const couch = fakeCouch({
			registry: [deviceV1('kiosk-01'), deviceV1('kiosk-02')],
			secrets: [secret('kiosk-02', '482913')]
		});

		await backfillStaffPins(couch.call, { ...deps, dryRun: false });
		const afterFirst = [...couch.writes];
		const second = await backfillStaffPins(couch.call, { ...deps, dryRun: false });

		expect(couch.dbs.get('scanner_secrets')?.get('staff_pin:kiosk-02')?.pin).toBe('482913');
		expect(afterFirst.some((w) => w.includes('kiosk-02'))).toBe(false);
		expect(second).toEqual({ pinned: [], conflicts: [] });
		expect(couch.writes).toEqual(afterFirst);
	});

	it('removes the PIN it just wrote when the registry doc cannot be stamped', async () => {
		const couch = fakeCouch({
			registry: [deviceV1('kiosk-01')],
			secrets: [],
			failRegistryPut: () => 409
		});

		const report = await backfillStaffPins(couch.call, { ...deps, dryRun: false });

		expect(report).toEqual({ pinned: [], conflicts: ['kiosk-01'] });
		expect(couch.dbs.get('scanner_secrets')?.has('staff_pin:kiosk-01')).toBe(false);
		expect(couch.dbs.get('registry')?.get('scanner_device:kiosk-01')?.schema_v).toBe(1);
	});

	it('refuses to write any PIN while scanner_secrets admits non-admin members', async () => {
		const couch = fakeCouch({
			registry: [deviceV1('kiosk-01')],
			secrets: [],
			security: { members: { roles: ['registration_staff'] } }
		});

		await expect(backfillStaffPins(couch.call, { ...deps, dryRun: false })).rejects.toThrow();
		expect(couch.writes).toEqual([]);
	});

	it('never puts a PIN in its report', async () => {
		const couch = fakeCouch({ registry: [deviceV1('kiosk-01')], secrets: [] });
		const report = await backfillStaffPins(couch.call, { ...deps, dryRun: false });
		expect(JSON.stringify(report)).not.toContain('582047');
	});
});
