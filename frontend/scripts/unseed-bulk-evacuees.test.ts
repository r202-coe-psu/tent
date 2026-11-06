import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unseedBulkEvacuees } from './unseed-bulk-evacuees';
import type { CouchReq } from './unseed-stock';

type Row = { id: string; rev: string };

/** In-memory stand-in for one shelter DB: `_all_docs` range reads and `_bulk_docs` deletes. */
function fakeCouch(ids: string[], failIds: string[] = []) {
	const rows = new Map<string, Row>(ids.map((id) => [id, { id, rev: '1-a' }]));
	const bulkCalls: Array<Array<{ _id: string; _deleted?: boolean }>> = [];

	const req: CouchReq = async (method, path, body) => {
		if (method === 'GET' && path.includes('/_all_docs')) {
			const q = new URLSearchParams(path.split('?')[1]);
			const start = JSON.parse(q.get('startkey') ?? '""') as string;
			const end = JSON.parse(q.get('endkey') ?? '""') as string;
			const matched = [...rows.values()]
				.filter((r) => r.id >= start && r.id < end)
				.sort((a, b) => (a.id < b.id ? -1 : 1))
				.map((r) => ({ id: r.id, value: { rev: r.rev } }));
			return { status: 200, data: { rows: matched } };
		}
		if (method === 'POST' && path.endsWith('/_bulk_docs')) {
			const docs = (body as { docs: Array<{ _id: string; _deleted?: boolean }> }).docs;
			bulkCalls.push(docs);
			const results = docs.map((d) => {
				if (failIds.includes(d._id)) return { id: d._id, error: 'conflict' };
				rows.delete(d._id);
				return { id: d._id, ok: true };
			});
			return { status: 201, data: results };
		}
		return { status: 404, data: {} };
	};
	return { req, bulkCalls, remaining: () => [...rows.keys()] };
}

const bulk = (kind: string, slug: string, n: number) =>
	Array.from({ length: n }, (_, i) => `${kind}:seed-bulk:${slug}:${String(i).padStart(6, '0')}`);

describe('unseedBulkEvacuees', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});
	afterEach(() => vi.restoreAllMocks());

	const keep = [
		...bulk('evacuee', 'sh002', 3), // other shelter's bulk volume
		'evacuee:seed-st:sh004:0001', // staging volume of the same shelter
		'household:seed-st:sh004:hh-0001',
		'shelter:sh004',
		'stock_ledger:abc'
	];
	const mine = [
		...bulk('evacuee', 'sh004', 4),
		...bulk('household', 'sh004', 2),
		...bulk('movement', 'sh004', 5)
	];

	it('dry-run counts only this shelter’s seed-bulk docs and deletes nothing', async () => {
		const couch = fakeCouch([...mine, ...keep]);

		const result = await unseedBulkEvacuees('SH004', { req: couch.req });

		expect(result.counts).toEqual({ evacuee: 4, household: 2, movement: 5 });
		expect(couch.bulkCalls).toHaveLength(0);
		expect(couch.remaining()).toHaveLength(mine.length + keep.length);
	});

	it('with confirm deletes exactly the selected docs and leaves everything else', async () => {
		const couch = fakeCouch([...mine, ...keep]);

		await unseedBulkEvacuees('SH004', { confirm: true, req: couch.req });

		expect(couch.remaining().sort()).toEqual([...keep].sort());
	});

	it('deletes in chunks of 500', async () => {
		const couch = fakeCouch(bulk('evacuee', 'sh004', 1100));

		await unseedBulkEvacuees('SH004', { confirm: true, req: couch.req });

		expect(couch.bulkCalls.map((c) => c.length)).toEqual([500, 500, 100]);
		expect(couch.bulkCalls.every((c) => c.every((d) => d._deleted))).toBe(true);
	});

	it('throws with the failure count when some docs cannot be deleted', async () => {
		const ids = bulk('evacuee', 'sh004', 5);
		const couch = fakeCouch(ids, [ids[1], ids[3]]);

		await expect(unseedBulkEvacuees('SH004', { confirm: true, req: couch.req })).rejects.toThrow(
			/^2 docs failed to delete/
		);
		expect(couch.remaining().sort()).toEqual([ids[1], ids[3]]);
	});

	it('does nothing on a second run once everything is gone', async () => {
		const couch = fakeCouch(mine);
		await unseedBulkEvacuees('SH004', { confirm: true, req: couch.req });
		couch.bulkCalls.length = 0;

		const result = await unseedBulkEvacuees('SH004', { confirm: true, req: couch.req });

		expect(result.counts).toEqual({ evacuee: 0, household: 0, movement: 0 });
		expect(couch.bulkCalls).toHaveLength(0);
	});
});
