import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	assertHostConfirmed,
	classifyEvacuee,
	parseCliArgs,
	planCentralOpsCleanup,
	planShelterCleanup,
	runCleanup,
	runRestore,
	type CleanupOptions,
	type CouchDoc
} from './prod-readiness-cleanup';
import type { CouchReq } from './unseed-stock';

const NOW = '2026-11-11T00:00:00.000Z';
const ALL: CleanupOptions = {
	categories: ['people', 'stock', 'food', 'distribution', 'tickets', 'donations'],
	keepChannels: ['web', 'api'],
	now: NOW
};

function evacuee(
	id: string,
	via: string,
	status: string,
	extra: Record<string, unknown> = {}
): CouchDoc {
	return {
		_id: `evacuee:${id}`,
		_rev: '1-a',
		type: 'evacuee',
		registered_via: via,
		current_stay: { status, zone: 'Z1', since: '2026-10-01T00:00:00.000Z' },
		...extra
	};
}

const doc = (id: string, extra: Record<string, unknown> = {}): CouchDoc => ({
	_id: id,
	_rev: '1-a',
	type: id.slice(0, id.indexOf(':')),
	...extra
});

describe('classifyEvacuee', () => {
	const keep = ['web', 'api'];
	it.each([
		['web', 'active', 'reset'],
		['api', 'room_confirmed', 'reset'],
		['web', 'checked_out', 'reset'],
		['web', 'pre_registered', 'untouched'],
		['staff', 'pre_registered', 'untouched'],
		['kiosk', 'cancelled', 'untouched'],
		['staff', 'active', 'delete'],
		['kiosk', 'kiosk_registered', 'delete'],
		['backoffice', 'arriving', 'delete'],
		['import', 'temporary_leave', 'delete']
	])('%s/%s → %s', (via, status, expected) => {
		expect(classifyEvacuee(evacuee('X', via, status), keep)).toBe(expected);
	});

	it('honours a custom keep-channel list', () => {
		expect(classifyEvacuee(evacuee('X', 'staff', 'active'), ['staff'])).toBe('reset');
		expect(classifyEvacuee(evacuee('X', 'web', 'active'), ['api'])).toBe('delete');
	});
});

describe('planShelterCleanup — people', () => {
	const docs: CouchDoc[] = [
		// Household A: a walk-in head (deleted) + a web booker (reset) → stays, head moves.
		doc('household:A', {
			status: 'checked_in',
			head_evacuee_id: 'evacuee:A1',
			checkout_destination: null
		}),
		evacuee('A1', 'staff', 'active', { household_id: 'household:A', photo: 'image:P1' }),
		evacuee('A2', 'web', 'room_confirmed', { household_id: 'household:A' }),
		// Household B: walk-ins only → household and its pet photo go.
		doc('household:B', {
			status: 'checked_out',
			pets: [{ species: 'dog', image_url: 'image:PET' }]
		}),
		evacuee('B1', 'kiosk', 'checked_out', { household_id: 'household:B' }),
		// Household C: already pre-registered and consistent → untouched.
		doc('household:C', {
			status: 'pre_registered',
			head_evacuee_id: 'evacuee:C1',
			checkout_destination: null
		}),
		evacuee('C1', 'staff', 'pre_registered', { household_id: 'household:C' }),
		doc('medical:M1', { evacuee_id: 'evacuee:A1' }),
		doc('medical:M2', { evacuee_id: 'evacuee:A2' }),
		doc('movement:1', { evacuee_id: 'evacuee:A2' }),
		doc('screening:1', { evacuee_id: 'evacuee:A2' }),
		doc('station_log:1', { evacuee_id: 'evacuee:A1' }),
		doc('evacuee_qr:A2', { evacuee_id: 'evacuee:A2' }),
		doc('image:P1'),
		doc('image:PET'),
		doc('image:KEEP'),
		doc('volunteer:V1'),
		doc('audit:1'),
		{ _id: '_design/app', _rev: '1-a' }
	];
	const plan = planShelterCleanup('shelter_sh001', docs, ALL);
	const deleted = plan.deletes.map((d) => d.id);
	const updated = new Map(plan.updates.map((d) => [d._id, d]));

	it('deletes walk-ins with their medical doc, photo and every check-in history doc', () => {
		expect(deleted).toEqual(
			[
				'evacuee:A1',
				'evacuee:B1',
				'household:B',
				'image:P1',
				'image:PET',
				'medical:M1',
				'movement:1',
				'screening:1',
				'station_log:1',
				'evacuee_qr:A2'
			].sort()
		);
		expect(plan.evacueesDeleted).toEqual({ 'staff/active': 1, 'kiosk/checked_out': 1 });
	});

	it('resets pre-registration-channel evacuees to pre_registered with no zone', () => {
		expect(updated.get('evacuee:A2')).toMatchObject({
			_rev: '1-a',
			current_stay: { status: 'pre_registered', zone: null, since: NOW },
			updated_at: NOW
		});
		expect(plan.evacueesReset).toEqual({ 'web/room_confirmed': 1 });
		expect(plan.evacueesUntouched).toBe(1);
		expect(updated.has('evacuee:C1')).toBe(false);
	});

	it('re-derives a surviving household and moves the head to a kept member', () => {
		expect(updated.get('household:A')).toMatchObject({
			status: 'pre_registered',
			head_evacuee_id: 'evacuee:A2',
			checkout_destination: null
		});
		expect(updated.has('household:C')).toBe(false);
		expect(plan.householdsDeleted).toBe(1);
		expect(plan.householdsUpdated).toBe(1);
	});

	it('leaves design docs, volunteers, audits, kept medical and unrelated images alone', () => {
		for (const id of ['_design/app', 'volunteer:V1', 'audit:1', 'medical:M2', 'image:KEEP']) {
			expect(deleted).not.toContain(id);
		}
	});
});

describe('planShelterCleanup — supplies', () => {
	const docs: CouchDoc[] = [
		doc('stock_ledger:1'),
		doc('lot_counter:L-261111'),
		doc('item_master:LOCAL'),
		doc('meal_plan:1'),
		doc('daily_calc:2026-11-01'),
		doc('distribution_issue:1'),
		doc('distribution_issue_gate:abc'),
		doc('bulk_return_entry_move:E:1'),
		doc('requisition_ticket:1'),
		doc('donation:1'),
		doc('donation_campaign:1'),
		doc('image:DON', { purpose: 'donation' }),
		doc('donation_slot:dropoff:2026-11-12:09:00'),
		doc('sop_override:1'),
		doc('job:1')
	];

	it('deletes every supply/food/distribution/ticket/donation doc and keeps config docs', () => {
		const plan = planShelterCleanup('shelter_sh001', docs, ALL);
		expect(plan.deletes.map((d) => d.id)).toEqual(
			docs
				.map((d) => d._id)
				.filter((id) => !['donation_slot:', 'sop_override:', 'job:'].some((p) => id.startsWith(p)))
				.sort()
		);
	});

	it('only touches the categories passed in --only', () => {
		const plan = planShelterCleanup('shelter_sh001', docs, { ...ALL, categories: ['tickets'] });
		expect(plan.deletes.map((d) => d.id)).toEqual(['requisition_ticket:1']);
		expect(plan.updates).toEqual([]);
	});
});

describe('planCentralOpsCleanup', () => {
	const docs = [
		doc('referral:1'),
		doc('referral_close_lock:SH001'),
		doc('stock_transfer:1'),
		doc('search_audit:1'),
		doc('counter:shelter')
	];
	it('deletes referrals with people and transfers with stock only', () => {
		expect(planCentralOpsCleanup(docs, ['people', 'stock']).map((d) => d.id)).toEqual([
			'referral:1',
			'referral_close_lock:SH001',
			'stock_transfer:1'
		]);
		expect(planCentralOpsCleanup(docs, ['food'])).toEqual([]);
	});
});

describe('parseCliArgs / assertHostConfirmed', () => {
	it('defaults to a dry run over every shelter and category', () => {
		expect(parseCliArgs([])).toMatchObject({
			apply: false,
			shelter: 'all',
			categories: ['people', 'stock', 'food', 'distribution', 'tickets', 'donations'],
			keepChannels: ['web', 'api']
		});
	});

	it('parses flags and rejects unknown categories or contradictory modes', () => {
		expect(
			parseCliArgs(['--apply', '--shelter', 'SH001', '--only=stock,food', '--confirm-host=x'])
		).toMatchObject({
			apply: true,
			shelter: 'SH001',
			categories: ['stock', 'food'],
			confirmHost: 'x'
		});
		expect(() => parseCliArgs(['--only=parcels'])).toThrow(/Unknown --only/);
		expect(() => parseCliArgs(['--apply', '--dry-run'])).toThrow(/mutually exclusive/);
	});

	it('requires the exact hostname for a non-local CouchDB', () => {
		expect(() => assertHostConfirmed('http://a:b@localhost:5984', null)).not.toThrow();
		// Staging/production run inside the compose network, where Couch is `couchdb`.
		expect(() => assertHostConfirmed('http://a:b@couchdb:5984', null)).toThrow(
			/--confirm-host=couchdb/
		);
		expect(() => assertHostConfirmed('http://a:b@couch.prod.example:5984', null)).toThrow(
			/--confirm-host=couch.prod.example/
		);
		expect(() =>
			assertHostConfirmed('http://a:b@couch.prod.example:5984', 'couch.staging.example')
		).toThrow();
		expect(() =>
			assertHostConfirmed('http://a:b@couch.prod.example:5984', 'couch.prod.example')
		).not.toThrow();
	});
});

/** In-memory CouchDB: `_all_dbs`, paged `_all_docs`, `_all_docs` by keys, `_bulk_docs` with MVCC. */
function fakeCouch(initial: Record<string, CouchDoc[]>) {
	const dbs = new Map<string, Map<string, CouchDoc>>();
	for (const [db, docs] of Object.entries(initial)) {
		dbs.set(db, new Map(docs.map((d) => [d._id, structuredClone(d)])));
	}
	let revCounter = 1;
	const nextRev = (rev?: string) => `${Number(rev?.split('-')[0] ?? 0) + 1}-r${++revCounter}`;

	const req: CouchReq = async (method, path, body) => {
		if (path === '/_all_dbs') return { status: 200, data: [...dbs.keys()].sort() };
		const [dbPart, rest] = path.slice(1).split('/', 2);
		const store = dbs.get(decodeURIComponent(dbPart));
		if (!store) return { status: 404, data: { error: 'not_found' } };

		if (method === 'GET' && rest.startsWith('_all_docs')) {
			const q = new URLSearchParams(path.split('?')[1]);
			const limit = Number(q.get('limit') ?? 1e9);
			const start = q.has('startkey') ? (JSON.parse(q.get('startkey')!) as string) : null;
			const skip = Number(q.get('skip') ?? 0);
			const live = [...store.values()]
				.filter((d) => !d._deleted)
				.sort((a, b) => (a._id < b._id ? -1 : 1));
			const from = start === null ? 0 : live.findIndex((d) => d._id >= start) + skip;
			const rows = live
				.slice(from, from + limit)
				.map((d) => ({ id: d._id, value: { rev: d._rev }, doc: structuredClone(d) }));
			return { status: 200, data: { rows } };
		}
		if (method === 'POST' && rest === '_all_docs') {
			const rows = (body as { keys: string[] }).keys.map((key) => {
				const d = store.get(key);
				return d
					? { key, value: { rev: d._rev, deleted: d._deleted } }
					: { key, error: 'not_found' };
			});
			return { status: 200, data: { rows } };
		}
		if (method === 'POST' && rest === '_bulk_docs') {
			const results = (body as { docs: CouchDoc[] }).docs.map((d) => {
				const cur = store.get(d._id);
				// Like CouchDB: a tombstone is recreated without `_rev`; its own rev conflicts.
				const expected = cur && !cur._deleted ? cur._rev : undefined;
				if (d._rev !== expected) return { id: d._id, error: 'conflict' };
				const saved = { ...structuredClone(d), _rev: nextRev(cur?._rev) };
				store.set(d._id, saved);
				return { id: d._id, ok: true, rev: saved._rev };
			});
			return { status: 201, data: results };
		}
		return { status: 400, data: { error: 'unsupported' } };
	};
	const live = (db: string) =>
		[...(dbs.get(db)?.values() ?? [])]
			.filter((d) => !d._deleted)
			.map((d) => d._id)
			.sort();
	const get = (db: string, id: string) => dbs.get(db)?.get(id);
	return { req, live, get };
}

describe('runCleanup / runRestore against a fake CouchDB', () => {
	let dir: string;
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		dir = mkdtempSync(join(tmpdir(), 'prod-cleanup-'));
	});
	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(dir, { recursive: true, force: true });
	});

	const seed = () =>
		fakeCouch({
			shelter_sh001: [
				evacuee('W', 'web', 'active', { household_id: 'household:H' }),
				evacuee('S', 'staff', 'active', { household_id: 'household:H' }),
				doc('household:H', { status: 'checked_in', head_evacuee_id: 'evacuee:S' }),
				doc('movement:1'),
				doc('stock_ledger:1'),
				doc('requisition_ticket:1'),
				doc('volunteer:V'),
				{ _id: '_design/app', _rev: '1-a', views: {} }
			],
			shelter_sh002: [doc('meal_plan:1')],
			shelter_import_queue: [doc('stock_ledger:Q')],
			central_ops: [doc('referral:1'), doc('search_audit:1')],
			registry: [doc('shelter:SH001')]
		});
	const deps = (req: CouchReq, couchUrl = 'http://admin:pw@localhost:5984') => ({
		req,
		couchUrl,
		now: NOW,
		displayUrl: 'test'
	});

	it('dry-run reports the plan and writes nothing', async () => {
		const couch = seed();
		const result = await runCleanup(parseCliArgs([]), deps(couch.req));
		expect(result.backupDir).toBeNull();
		expect(result.shelters.map((p) => p.db)).toEqual(['shelter_sh001', 'shelter_sh002']);
		expect(result.shelters.map((p) => p.deletes.length)).toEqual([4, 1]);
		expect(couch.live('shelter_sh001')).toContain('stock_ledger:1');
		expect(couch.get('shelter_sh001', 'evacuee:W')?._rev).toBe('1-a');
	});

	it('refuses to apply to a non-local host without --confirm-host, before reading anything', async () => {
		const couch = seed();
		const spy = vi.fn(couch.req);
		await expect(
			runCleanup(parseCliArgs(['--apply']), deps(spy, 'http://a:b@couch.prod.example:5984'))
		).rejects.toThrow(/--confirm-host/);
		expect(spy).not.toHaveBeenCalled();
	});

	it('apply backs up first, cleans every DB, is idempotent and can be restored', async () => {
		const couch = seed();
		const backupDir = join(dir, 'backup');
		const result = await runCleanup(
			parseCliArgs(['--apply', `--backup-dir=${backupDir}`]),
			deps(couch.req)
		);

		const backup = JSON.parse(readFileSync(join(backupDir, 'shelter_sh001.json'), 'utf-8'));
		expect(backup.docs.map((d: CouchDoc) => d._id)).toContain('stock_ledger:1');
		expect(result.backupDir).toBe(backupDir);

		expect(couch.live('shelter_sh001')).toEqual([
			'_design/app',
			'evacuee:W',
			'household:H',
			'volunteer:V'
		]);
		expect(couch.get('shelter_sh001', 'evacuee:W')).toMatchObject({
			current_stay: { status: 'pre_registered', zone: null, since: NOW }
		});
		expect(couch.get('shelter_sh001', 'household:H')).toMatchObject({
			status: 'pre_registered',
			head_evacuee_id: 'evacuee:W'
		});
		expect(couch.live('shelter_sh002')).toEqual([]);
		expect(couch.live('central_ops')).toEqual(['search_audit:1']);
		expect(couch.live('registry')).toEqual(['shelter:SH001']);

		const again = await runCleanup(parseCliArgs([]), deps(couch.req));
		expect(again.shelters.every((p) => p.deletes.length === 0 && p.updates.length === 0)).toBe(
			true
		);
		expect(again.centralOps).toEqual([]);

		const dryRestore = await runRestore(parseCliArgs([`--restore=${backupDir}`]), deps(couch.req));
		expect(dryRestore.shelter_sh001).toBe(6);
		expect(couch.live('shelter_sh001')).not.toContain('stock_ledger:1');

		await runRestore(parseCliArgs([`--restore=${backupDir}`, '--apply']), deps(couch.req));
		expect(couch.live('shelter_sh001')).toContain('stock_ledger:1');
		expect(couch.live('central_ops')).toEqual(['referral:1', 'search_audit:1']);
		expect(couch.get('shelter_sh001', 'evacuee:W')).toMatchObject({
			current_stay: { status: 'active', zone: 'Z1' }
		});
	});

	it('--shelter scopes the run to one DB and skips central_ops', async () => {
		const couch = seed();
		const result = await runCleanup(
			parseCliArgs(['--apply', '--shelter=SH002', `--backup-dir=${join(dir, 'b')}`]),
			deps(couch.req)
		);
		expect(result.shelters.map((p) => p.db)).toEqual(['shelter_sh002']);
		expect(couch.live('shelter_sh002')).toEqual([]);
		expect(couch.live('shelter_sh001')).toContain('stock_ledger:1');
		expect(couch.live('central_ops')).toContain('referral:1');
	});
});
