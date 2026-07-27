import { describe, expect, it } from 'vitest';
import { getShelterViewModule } from '../domain/view-modules';
import { hashViews, runViewLifecycle, type ViewLifecycleClient } from './view-lifecycle';

type StoredDesign = {
	_id: string;
	_rev: string;
	views?: Record<string, { map: string; reduce?: string }>;
	[key: string]: unknown;
};

function fakeCouch(
	initial: Record<string, StoredDesign> = {},
	options: {
		conflictOnce?: boolean;
		conflictCount?: number;
		warmFailureFor?: string;
		signatureByDesign?: Record<string, string>;
	} = {}
) {
	const designs = new Map(Object.entries(initial));
	const calls: { path: string; method: string }[] = [];
	let revision = 1;
	let conflictsRemaining = options.conflictCount ?? (options.conflictOnce ? 1 : 0);

	const client: ViewLifecycleClient = async (path, method, body) => {
		calls.push({ path, method });
		const dbMatch = path.match(/^\/?([^/]+)/);
		if (!dbMatch) return { status: 400, data: { reason: 'unexpected path' } };
		const db = decodeURIComponent(dbMatch[1]);

		if (method === 'GET' && path.includes('/_all_docs?')) {
			const query = new URL(path, 'http://couch.test').searchParams;
			const start = JSON.parse(query.get('startkey') ?? '""') as string;
			const end = JSON.parse(query.get('endkey') ?? '"\\uffff"') as string;
			const rows = [...designs.entries()]
				.map(([key, design]) => ({ id: key.slice(db.length + 1), doc: design }))
				.filter((row) => row.id >= start && row.id <= end);
			return { status: 200, data: { rows } };
		}

		const designMatch = path.match(/^\/?([^/]+)\/_design\/([^/?]+)(?:\/([^/?]+))?/);
		if (designMatch) {
			const designName = decodeURIComponent(designMatch[2]);
			const key = `${db}/_design/${designName}`;
			if (method === 'GET' && designMatch[3] === '_info') {
				const design = designs.get(key);
				return design
					? {
							status: 200,
							data: {
								view_index: {
									signature:
										options.signatureByDesign?.[designName] ?? hashViews(design.views ?? {})
								}
							}
						}
					: { status: 404, data: null };
			}
			if (method === 'GET' && designMatch[3] === '_view') {
				if (options.warmFailureFor === designName)
					return { status: 500, data: { reason: 'warm failed' } };
				return { status: 200, data: { rows: [] } };
			}
			if (method === 'GET') {
				const design = designs.get(key);
				return design ? { status: 200, data: design } : { status: 404, data: null };
			}
			if (method === 'PUT') {
				if (conflictsRemaining > 0) {
					conflictsRemaining--;
					return { status: 409, data: { reason: 'conflict' } };
				}
				const document = body as StoredDesign;
				const stored = { ...document, _rev: `1-${revision++}` };
				designs.set(key, stored);
				return { status: 201, data: stored };
			}
			if (method === 'DELETE') {
				designs.delete(key);
				return { status: 200, data: { ok: true } };
			}
		}

		const deleteMatch = path.match(/^\/?([^/]+)\/([^?]+)\?rev=/);
		if (method === 'DELETE' && deleteMatch) {
			designs.delete(`${db}/${decodeURIComponent(deleteMatch[2])}`);
			return { status: 200, data: { ok: true } };
		}
		return { status: 405, data: null };
	};

	return { client, designs, calls };
}

describe('shelter Map/Reduce lifecycle', () => {
	it('dry-run never sends a PUT request', async () => {
		const fake = fakeCouch();
		const result = await runViewLifecycle(
			'shelter_sh001',
			getShelterViewModule('dashboard'),
			fake.client,
			{ mode: 'dry-run' }
		);

		expect(result.status).toBe('dry-run');
		expect(result.targetDesignName).toBe('dashboard');
		expect(fake.calls.some((call) => call.method === 'PUT')).toBe(false);
	});

	it('initial deployment writes stable dashboard directly without a candidate', async () => {
		const fake = fakeCouch();
		const result = await runViewLifecycle(
			'shelter_sh001',
			getShelterViewModule('dashboard'),
			fake.client,
			{ mode: 'write' }
		);

		expect(result.message).toBe('initial_deploy');
		expect(fake.designs.has('shelter_sh001/_design/dashboard')).toBe(true);
		expect([...fake.designs.keys()].some((key) => key.includes('__next_'))).toBe(false);
	});

	it('stable dashboard upgrade warms candidate, verifies signature, and cleans candidate', async () => {
		const fake = fakeCouch({
			'shelter_sh001/_design/dashboard': {
				_id: '_design/dashboard',
				_rev: '1-old',
				language: 'javascript',
				views: { old_view: { map: 'function (doc) { emit(doc.type, 1); }' } }
			}
		});

		const result = await runViewLifecycle(
			'shelter_sh001',
			getShelterViewModule('dashboard'),
			fake.client,
			{ mode: 'write' }
		);

		expect(result.status).toBe('deployed');
		expect(fake.designs.get('shelter_sh001/_design/dashboard')?.views).toHaveProperty('occupancy');
		expect([...fake.designs.keys()].some((key) => key.includes('__next_'))).toBe(false);
		expect([...fake.designs.keys()].filter((key) => key.includes('__prev_')).length).toBe(1);
	});

	it('legacy app target preserves other module views and retries 409', async () => {
		const fake = fakeCouch(
			{
				'shelter_sh001/_design/app': {
					_id: '_design/app',
					_rev: '1-old',
					language: 'javascript',
					views: {
						other_module_view: {
							map: 'function (doc) { emit(doc.type, 1); }',
							reduce: '_count'
						}
					}
				}
			},
			{ conflictOnce: true }
		);

		const result = await runViewLifecycle(
			'shelter_sh001',
			getShelterViewModule('dashboard'),
			fake.client,
			{ mode: 'write', targetDesignName: 'app' }
		);

		const app = fake.designs.get('shelter_sh001/_design/app');
		expect(result.status).toBe('deployed');
		expect(app?.views).toHaveProperty('other_module_view');
		expect(app?.views).toHaveProperty('occupancy');
		expect(app).toHaveProperty('language', 'javascript');
		expect(fake.calls.filter((call) => call.method === 'PUT').length).toBeGreaterThan(3);
	});

	it('fails after bounded conflict retries are exhausted', async () => {
		const fake = fakeCouch({}, { conflictCount: 3 });

		await expect(
			runViewLifecycle('shelter_sh001', getShelterViewModule('dashboard'), fake.client, {
				mode: 'write'
			})
		).rejects.toThrow('PUT dashboard failed');
	});

	it('rolls stable back with rollback metadata when promoted warm fails', async () => {
		const oldViews = { old_view: { map: 'function (doc) { emit(doc.type, 1); }' } };
		const fake = fakeCouch(
			{
				'shelter_sh001/_design/dashboard': {
					_id: '_design/dashboard',
					_rev: '1-old',
					views: oldViews,
					tent_view: { module: 'dashboard', version: 1, hash: hashViews(oldViews) }
				}
			},
			{ warmFailureFor: 'dashboard' }
		);

		await expect(
			runViewLifecycle('shelter_sh001', getShelterViewModule('dashboard'), fake.client, {
				mode: 'write'
			})
		).rejects.toThrow('warm failed');
		const restored = fake.designs.get('shelter_sh001/_design/dashboard');
		expect(restored?.views).toEqual(oldViews);
		expect(restored?.tent_view).toMatchObject({ hash: hashViews(oldViews), version: 1 });
	});

	it('verify rejects a stale stable hash', async () => {
		const fake = fakeCouch({
			'shelter_sh001/_design/dashboard': {
				_id: '_design/dashboard',
				_rev: '1-old',
				views: { stale: { map: 'function () {}' } }
			}
		});

		await expect(
			runViewLifecycle('shelter_sh001', getShelterViewModule('dashboard'), fake.client, {
				mode: 'verify'
			})
		).rejects.toThrow('Hash mismatch');
	});

	it('rolls stable back when candidate and promoted view signatures differ', async () => {
		const oldViews = { old_view: { map: 'function (doc) { emit(doc.type, 1); }' } };
		const fake = fakeCouch(
			{
				'shelter_sh001/_design/dashboard': {
					_id: '_design/dashboard',
					_rev: '1-old',
					views: oldViews
				}
			},
			{ signatureByDesign: { dashboard: 'different-signature' } }
		);

		await expect(
			runViewLifecycle('shelter_sh001', getShelterViewModule('dashboard'), fake.client, {
				mode: 'write'
			})
		).rejects.toThrow('View index signature mismatch');
		expect(fake.designs.get('shelter_sh001/_design/dashboard')?.views).toEqual(oldViews);
	});

	it('hash is deterministic for the same View definitions', () => {
		const first = { b: { map: 'b' }, a: { map: 'a' } };
		const second = { a: { map: 'a' }, b: { map: 'b' } };
		expect(hashViews(first)).toBe(hashViews(second));
	});
});
