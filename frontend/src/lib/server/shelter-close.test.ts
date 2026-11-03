import { describe, it, expect, beforeEach } from 'vitest';
import type { CouchReq } from './ensure-public-writer';
import {
	chunkByHousehold,
	closeShelterPeople,
	countShelterClose,
	countStaleHouseholds,
	previewShelterClose,
	SHELTER_CLOSE_CHUNK_SIZE
} from './shelter-close';
import type { Evacuee, StayStatus } from '$lib/features/people/server';

/**
 * In-memory CouchDB for one shelter database: enough of `_all_docs`, single GET and
 * `_bulk_docs` (with `_rev` conflict checks) to exercise the close service.
 */
class FakeCouch {
	docs = new Map<string, Record<string, unknown> & { _id: string; _rev: string }>();
	bulkCalls: unknown[][] = [];
	/** Called before each bulk doc is written; return an error row to fail it. */
	beforeWrite: (doc: { _id: string }) => { error: string; reason?: string } | null = () => null;
	/**
	 * Fail a whole `_bulk_docs` request: 'before' writes nothing, 'after' commits the docs but
	 * loses the response (a timeout) — both answer HTTP 500.
	 */
	failBulk: (docs: { _id: string; type?: string }[]) => 'before' | 'after' | null = () => null;
	/** Fail a by-keys `_all_docs` read (HTTP 500) — e.g. the household re-read. */
	failKeysRead: (keys: string[]) => boolean = () => false;
	/** Status the occupancy view answers with when deployed (to simulate an error). */
	viewStatus = 200;
	/** Serve `_design/app/_view/occupancy?group=true` (the shelter dashboard view). */
	viewDeployed = false;
	viewReads = 0;
	scans = 0;
	private revSeq = 0;

	nextRev() {
		this.revSeq += 1;
		return `${this.revSeq}-x`;
	}

	put(doc: Record<string, unknown> & { _id: string }) {
		const saved = { ...doc, _rev: this.nextRev() };
		this.docs.set(doc._id, saved);
		return saved;
	}

	byType(type: string) {
		return [...this.docs.values()].filter((d) => d.type === type);
	}

	req: CouchReq = async (method, path, body) => {
		const url = new URL(`http://couch${path}`);
		const parts = url.pathname.split('/').filter(Boolean);
		if (parts[0] !== 'shelter_sh001') return { status: 404, data: { error: 'not_found' } };
		const op = parts[1];

		if (op === '_design') {
			if (!this.viewDeployed || parts[4] !== 'occupancy') return { status: 404, data: null };
			this.viewReads += 1;
			if (this.viewStatus !== 200) return { status: this.viewStatus, data: null };
			const counts = new Map<string, number>();
			for (const d of this.byType('evacuee')) {
				const status = (d.current_stay as { status: string }).status;
				counts.set(status, (counts.get(status) ?? 0) + 1);
			}
			return {
				status: 200,
				data: { rows: [...counts].map(([key, value]) => ({ key, value })) }
			};
		}

		if (op === '_all_docs' && method === 'GET') {
			this.scans += 1;
			const start = JSON.parse(url.searchParams.get('startkey') ?? '""') as string;
			const end = JSON.parse(url.searchParams.get('endkey') ?? '"￰"') as string;
			const limit = Number(url.searchParams.get('limit') ?? 1e9);
			const skip = Number(url.searchParams.get('skip') ?? 0);
			const rows = [...this.docs.keys()]
				.sort()
				.filter((id) => id >= start && id <= end)
				.slice(skip, skip + limit)
				.map((id) => ({ id, doc: structuredClone(this.docs.get(id)) }));
			return { status: 200, data: { rows } };
		}
		if (op === '_all_docs' && method === 'POST') {
			const keys = (body as { keys: string[] }).keys;
			if (this.failKeysRead(keys)) return { status: 500, data: { error: 'unknown_error' } };
			const rows = keys.map((id) => ({ id, doc: structuredClone(this.docs.get(id)) ?? null }));
			return { status: 200, data: { rows } };
		}
		if (op === '_bulk_docs') {
			const docs = (body as { docs: (Record<string, unknown> & { _id: string; _rev?: string })[] })
				.docs;
			this.bulkCalls.push(docs);
			const fail = this.failBulk(docs);
			if (fail === 'before') return { status: 500, data: { error: 'unknown_error' } };
			const rows = docs.map((doc) => {
				const injected = this.beforeWrite(doc);
				if (injected) return { id: doc._id, ...injected };
				const current = this.docs.get(doc._id);
				if ((current?._rev ?? undefined) !== (doc._rev ?? undefined)) {
					return { id: doc._id, error: 'conflict', reason: 'Document update conflict.' };
				}
				const saved = this.put(doc);
				return { id: doc._id, ok: true, rev: saved._rev };
			});
			if (fail === 'after') return { status: 500, data: { error: 'unknown_error' } };
			return { status: 201, data: rows };
		}
		if (method === 'GET') {
			const doc = this.docs.get(decodeURIComponent(op));
			return doc ? { status: 200, data: structuredClone(doc) } : { status: 404, data: null };
		}
		return { status: 400, data: { error: 'unsupported' } };
	};
}

let couch: FakeCouch;
let seq = 0;

function addHousehold(status = 'checked_in', extra: Record<string, unknown> = {}) {
	seq += 1;
	const id = `household:H${String(seq).padStart(5, '0')}`;
	couch.put({
		_id: id,
		type: 'household',
		schema_v: 5,
		shelter_code: 'SH001',
		status,
		checkout_destination: null,
		updated_at: '2026-10-01T00:00:00.000Z',
		...extra
	});
	return id;
}

function addEvacuee(status: StayStatus, householdId: string | null) {
	seq += 1;
	const id = `evacuee:E${String(seq).padStart(5, '0')}`;
	couch.put({
		_id: id,
		type: 'evacuee',
		schema_v: 5,
		shelter_code: 'SH001',
		household_id: householdId,
		first_name: 'ก',
		current_stay: { status, zone: 'Z1', since: '2026-10-01T00:00:00.000Z' },
		created_at: '2026-10-01T00:00:00.000Z',
		updated_at: '2026-10-01T00:00:00.000Z',
		created_by: 'staff'
	});
	return id;
}

const stay = (id: string) => (couch.docs.get(id)!.current_stay as { status: string }).status;
const opts = { createdBy: 'mgr1', now: () => '2026-11-01T08:00:00.000Z' };

beforeEach(() => {
	couch = new FakeCouch();
	seq = 0;
});

describe('previewShelterClose (FR-7)', () => {
	it('counts only affected stays, by status', async () => {
		const h = addHousehold();
		addEvacuee('active', h);
		addEvacuee('active', h);
		addEvacuee('pre_registered', h);
		addEvacuee('temporary_leave', null);
		addEvacuee('checked_out', h);
		addEvacuee('deceased', h);
		expect(await previewShelterClose(couch.req, 'SH001')).toEqual({
			by_status: { active: 2, pre_registered: 1, temporary_leave: 1 },
			total: 4
		});
	});

	it('reads the occupancy view instead of every evacuee when it is deployed', async () => {
		couch.viewDeployed = true;
		const h = addHousehold();
		addEvacuee('active', h);
		addEvacuee('arriving', h);
		addEvacuee('checked_out', h);
		addEvacuee('deceased', null);
		expect(await previewShelterClose(couch.req, 'SH001')).toEqual({
			by_status: { active: 1, arriving: 1 },
			total: 2
		});
		expect(couch.viewReads).toBe(1);
		expect(couch.scans).toBe(0);
	});

	it('the run re-counts through the view too (FR-13)', async () => {
		couch.viewDeployed = true;
		addEvacuee('active', null);
		const run = await closeShelterPeople(couch.req, 'SH001', opts);
		expect(run.remaining).toEqual({ by_status: {}, total: 0 });
		expect(couch.viewReads).toBe(1);
	});

	it('countShelterClose of nobody is total 0 with no statuses (FR-20)', () => {
		expect(countShelterClose([])).toEqual({ by_status: {}, total: 0 });
	});
});

describe('closeShelterPeople', () => {
	it('checks out / cancels every affected stay and writes one movement per check-out', async () => {
		const h = addHousehold();
		const ids = (
			['active', 'room_confirmed', 'temporary_leave', 'arriving', 'kiosk_registered'] as const
		).map((s) => addEvacuee(s, h));
		const pre = addEvacuee('pre_registered', h);
		const gone = addEvacuee('transferred', h);

		const run = await closeShelterPeople(couch.req, 'SH001', opts);

		expect(run).toMatchObject({ checked_out: 5, cancelled: 1, failed: [] });
		expect(run.remaining.total).toBe(0);
		for (const id of ids) expect(stay(id)).toBe('checked_out');
		expect(stay(pre)).toBe('cancelled');
		expect(stay(gone)).toBe('transferred');

		const movements = couch.byType('movement');
		expect(movements).toHaveLength(5);
		expect(movements.map((m) => m.evacuee_id).sort()).toEqual([...ids].sort());
		for (const m of movements) {
			expect(m).toMatchObject({
				action: 'check_out',
				reason: 'shelter_closed',
				zone: null,
				created_by: 'mgr1',
				occurred_at: '2026-11-01T08:00:00.000Z'
			});
		}
	});

	it('writes evacuees before their movements before households (FR-10 order)', async () => {
		const h = addHousehold();
		addEvacuee('active', h);
		await closeShelterPeople(couch.req, 'SH001', opts);
		const types = couch.bulkCalls.map((docs) => (docs[0] as { type: string }).type);
		expect(types).toEqual(['evacuee', 'movement', 'household']);
	});

	it('derives households: checked_out gets a shelter_closed destination (FR-5)', async () => {
		const h = addHousehold();
		addEvacuee('active', h);
		addEvacuee('room_confirmed', h);
		await closeShelterPeople(couch.req, 'SH001', opts);
		expect(couch.docs.get(h)).toMatchObject({
			status: 'checked_out',
			checkout_destination: { type: 'shelter_closed' }
		});
	});

	it('keeps an existing checkout_destination (FR-5)', async () => {
		const h = addHousehold('checked_in', { checkout_destination: { type: 'returned_home' } });
		addEvacuee('active', h);
		await closeShelterPeople(couch.req, 'SH001', opts);
		expect(couch.docs.get(h)!.checkout_destination).toEqual({ type: 'returned_home' });
	});

	it('all pre_registered → household cancelled, no movement, one audit (FR-6, FR-6a)', async () => {
		const h = addHousehold('pre_registered');
		const a = addEvacuee('pre_registered', h);
		const b = addEvacuee('pre_registered', h);
		await closeShelterPeople(couch.req, 'SH001', opts);

		expect(couch.docs.get(h)).toMatchObject({ status: 'cancelled', checkout_destination: null });
		expect(couch.byType('movement')).toHaveLength(0);
		const audits = couch.byType('audit');
		expect(audits).toHaveLength(1);
		expect(audits[0]).toMatchObject({
			action: 'other',
			target_type: 'household',
			target_id: h,
			reason: 'shelter_closed',
			context: { cancelled_member_count: 2, evacuee_ids: [a, b] }
		});
	});

	it('mixed household → checked_out with shelter_closed destination (FR-6b)', async () => {
		const h = addHousehold();
		addEvacuee('pre_registered', h);
		addEvacuee('active', h);
		await closeShelterPeople(couch.req, 'SH001', opts);
		expect(couch.docs.get(h)).toMatchObject({
			status: 'checked_out',
			checkout_destination: { type: 'shelter_closed' }
		});
		expect(couch.byType('audit')).toHaveLength(1);
	});

	it('is idempotent: a re-run writes no second movement (FR-12)', async () => {
		const h = addHousehold();
		addEvacuee('active', h);
		addEvacuee('pre_registered', h);
		await closeShelterPeople(couch.req, 'SH001', opts);
		const before = couch.docs.size;

		const again = await closeShelterPeople(couch.req, 'SH001', opts);
		expect(again).toMatchObject({
			checked_out: 0,
			cancelled: 0,
			households_repaired: 0,
			failed: []
		});
		expect(couch.docs.size).toBe(before);
		expect(couch.byType('movement')).toHaveLength(1);
	});

	describe('re-run after a run that stopped before its household writes (FR-12)', () => {
		it('re-derives a household whose members were already checked out', async () => {
			const h = addHousehold('checked_in');
			addEvacuee('checked_out', h);
			addEvacuee('checked_out', h);
			expect(await countStaleHouseholds(couch.req, 'SH001')).toBe(1);
			const run = await closeShelterPeople(couch.req, 'SH001', opts);
			expect(run).toMatchObject({
				checked_out: 0,
				cancelled: 0,
				households_repaired: 1,
				failed: []
			});
			expect(run.remaining.total).toBe(0);
			expect(await countStaleHouseholds(couch.req, 'SH001')).toBe(0);
			expect(couch.docs.get(h)).toMatchObject({
				status: 'checked_out',
				checkout_destination: { type: 'shelter_closed' }
			});
			expect(couch.byType('movement')).toHaveLength(0);
		});

		it('repairs the household a failed first run left behind, then the re-run is clean', async () => {
			const h = addHousehold('checked_in');
			addEvacuee('active', h);
			addEvacuee('room_confirmed', h);
			couch.beforeWrite = (doc) =>
				doc._id === h ? { error: 'forbidden', reason: 'household write refused' } : null;
			const first = await closeShelterPeople(couch.req, 'SH001', opts);
			expect(first.failed).toHaveLength(1);
			expect(couch.docs.get(h)!.status).toBe('checked_in');

			couch.beforeWrite = () => null;
			const again = await closeShelterPeople(couch.req, 'SH001', opts);
			expect(again).toMatchObject({ checked_out: 0, households_repaired: 1, failed: [] });
			expect(couch.docs.get(h)).toMatchObject({
				status: 'checked_out',
				checkout_destination: { type: 'shelter_closed' }
			});
			expect(couch.byType('movement')).toHaveLength(2);
		});

		it('counts only households whose members are all closed out already', async () => {
			const settled = addHousehold('checked_in');
			addEvacuee('checked_out', settled);
			const pending = addHousehold('pre_registered');
			addEvacuee('checked_out', pending);
			addEvacuee('active', pending); // the main run derives this one, not the repair
			expect(await countStaleHouseholds(couch.req, 'SH001')).toBe(1);
			const run = await closeShelterPeople(couch.req, 'SH001', opts);
			expect(run.households_repaired).toBe(1);
			expect(couch.docs.get(pending)!.status).toBe('checked_out');
		});

		it('reports a stale household it cannot write, so the shelter stays open', async () => {
			const h = addHousehold('checked_in');
			const id = addEvacuee('checked_out', h);
			couch.beforeWrite = (doc) => (doc._id === h ? { error: 'forbidden' } : null);
			const run = await closeShelterPeople(couch.req, 'SH001', opts);
			expect(run.failed).toEqual([{ evacuee_id: id, error: `household ${h}: forbidden` }]);
		});

		it('leaves a household checked out by hand without a destination alone', async () => {
			const h = addHousehold('checked_out');
			addEvacuee('checked_out', h);
			const rev = couch.docs.get(h)!._rev;
			expect(await countStaleHouseholds(couch.req, 'SH001')).toBe(0);
			const run = await closeShelterPeople(couch.req, 'SH001', opts);
			expect(run.households_repaired).toBe(0);
			expect(couch.docs.get(h)).toMatchObject({ _rev: rev, checkout_destination: null });
		});
	});

	it('retries a 409 after re-fetching the doc (FR-11)', async () => {
		const h = addHousehold();
		const id = addEvacuee('active', h);
		let bumped = false;
		couch.beforeWrite = (doc) => {
			if (doc._id === id && !bumped) {
				bumped = true;
				// Someone else saved the evacuee (still active) between our read and write.
				couch.put({ ...couch.docs.get(id)!, first_name: 'แก้ไข' });
			}
			return null;
		};
		const run = await closeShelterPeople(couch.req, 'SH001', opts);
		expect(run).toMatchObject({ checked_out: 1, failed: [] });
		expect(couch.docs.get(id)).toMatchObject({ first_name: 'แก้ไข' });
		expect(stay(id)).toBe('checked_out');
		expect(couch.byType('movement')).toHaveLength(1);
	});

	it('drops a conflicting doc that someone else already checked out', async () => {
		const id = addEvacuee('active', null);
		let bumped = false;
		couch.beforeWrite = (doc) => {
			if (doc._id === id && !bumped) {
				bumped = true;
				couch.put({
					...couch.docs.get(id)!,
					current_stay: { status: 'checked_out', zone: null, since: 'x' }
				});
			}
			return null;
		};
		const run = await closeShelterPeople(couch.req, 'SH001', opts);
		expect(run).toMatchObject({ checked_out: 0, failed: [] });
		expect(couch.byType('movement')).toHaveLength(0);
	});

	it('reports a doc as failed after 3 conflicting retries, and leaves it unclosed (FR-11, FR-13)', async () => {
		const ok = addEvacuee('active', null);
		const stuck = addEvacuee('active', null);
		couch.beforeWrite = (doc) =>
			doc._id === stuck ? { error: 'conflict', reason: 'Document update conflict.' } : null;

		const run = await closeShelterPeople(couch.req, 'SH001', opts);
		expect(run.checked_out).toBe(1);
		expect(run.failed).toEqual([
			{ evacuee_id: stuck, error: 'conflict: Document update conflict.' }
		]);
		expect(run.remaining).toEqual({ by_status: { active: 1 }, total: 1 });
		expect(stay(ok)).toBe('checked_out');

		// FR-12: a re-run once the conflict clears finishes the job, no duplicate movement.
		couch.beforeWrite = () => null;
		const again = await closeShelterPeople(couch.req, 'SH001', opts);
		expect(again).toMatchObject({ checked_out: 1, failed: [] });
		expect(again.remaining.total).toBe(0);
		expect(couch.byType('movement')).toHaveLength(2);
	});

	it('rolls a check-out back when its movement cannot be written, so a re-run fixes it', async () => {
		const h = addHousehold();
		const ok = addEvacuee('active', h);
		const lost = addEvacuee('temporary_leave', h);
		couch.beforeWrite = (doc) =>
			(doc as { type?: string; evacuee_id?: string }).type === 'movement' &&
			(doc as { evacuee_id?: string }).evacuee_id === lost
				? { error: 'internal_server_error', reason: 'boom' }
				: null;

		const run = await closeShelterPeople(couch.req, 'SH001', opts);
		expect(run.checked_out).toBe(1);
		expect(run.failed).toEqual([
			{
				evacuee_id: lost,
				error: 'movement: internal_server_error: boom — stay restored, close again to retry'
			}
		]);
		expect(run.remaining).toEqual({ by_status: { temporary_leave: 1 }, total: 1 });
		expect(stay(lost)).toBe('temporary_leave');
		// The household still has someone on a stay, so it is not checked out yet.
		expect(couch.docs.get(h)!.status).toBe('checked_in');

		couch.beforeWrite = () => null;
		const again = await closeShelterPeople(couch.req, 'SH001', opts);
		expect(again).toMatchObject({ checked_out: 1, failed: [] });
		expect(again.remaining.total).toBe(0);
		const movements = couch.byType('movement');
		expect(movements.map((m) => m.evacuee_id).sort()).toEqual([ok, lost].sort());
		expect(couch.docs.get(h)).toMatchObject({
			status: 'checked_out',
			checkout_destination: { type: 'shelter_closed' }
		});
	});

	it('says so when the rollback itself fails', async () => {
		const id = addEvacuee('active', null);
		let evacueeWrites = 0;
		couch.beforeWrite = (doc) => {
			const type = (doc as { type?: string }).type;
			if (type === 'movement') return { error: 'internal_server_error', reason: 'boom' };
			if (type === 'evacuee' && ++evacueeWrites > 1) return { error: 'forbidden', reason: 'no' };
			return null;
		};
		const run = await closeShelterPeople(couch.req, 'SH001', opts);
		expect(run.failed).toEqual([
			{
				evacuee_id: id,
				error:
					'movement: internal_server_error: boom — stay NOT restored: checked out without a movement'
			}
		]);
		expect(stay(id)).toBe('checked_out');
	});

	it('derives a household from its members as they are now, not as the run first read them', async () => {
		const h = addHousehold();
		addEvacuee('active', h);
		const back = addEvacuee('transferred', h); // not in scope, so not written by the close
		let touched = false;
		couch.beforeWrite = (doc) => {
			if (!touched && (doc as { type?: string }).type === 'movement') {
				touched = true;
				// Meanwhile staff checked `back` in again.
				couch.put({
					...couch.docs.get(back)!,
					current_stay: { status: 'active', zone: 'Z2', since: 'later' }
				});
			}
			return null;
		};
		const run = await closeShelterPeople(couch.req, 'SH001', opts);
		expect(run.checked_out).toBe(1);
		expect(couch.docs.get(h)).toMatchObject({ status: 'checked_in', checkout_destination: null });
		expect(run.remaining).toEqual({ by_status: { active: 1 }, total: 1 });
	});

	describe('a whole _bulk_docs request failing', () => {
		const firstOf = (type: string) => {
			let done = false;
			return (mode: 'before' | 'after') => (docs: { type?: string }[]) => {
				if (done || docs[0]?.type !== type) return null;
				done = true;
				return mode;
			};
		};

		it('retries movements that were not written', async () => {
			const id = addEvacuee('active', null);
			couch.failBulk = firstOf('movement')('before');
			const run = await closeShelterPeople(couch.req, 'SH001', opts);
			expect(run).toMatchObject({ checked_out: 1, failed: [] });
			expect(couch.byType('movement').map((m) => m.evacuee_id)).toEqual([id]);
		});

		it('counts movements that were written before the response was lost — no duplicate', async () => {
			addEvacuee('active', null);
			couch.failBulk = firstOf('movement')('after');
			const run = await closeShelterPeople(couch.req, 'SH001', opts);
			expect(run).toMatchObject({ checked_out: 1, failed: [] });
			expect(couch.byType('movement')).toHaveLength(1);
		});

		it('still writes movements for evacuees committed before the response was lost', async () => {
			const h = addHousehold();
			const a = addEvacuee('active', h);
			const b = addEvacuee('pre_registered', h);
			couch.failBulk = firstOf('evacuee')('after');
			const run = await closeShelterPeople(couch.req, 'SH001', opts);
			expect(run).toMatchObject({ checked_out: 1, cancelled: 1, failed: [] });
			expect(run.remaining.total).toBe(0);
			expect(couch.byType('movement').map((m) => m.evacuee_id)).toEqual([a]);
			expect(stay(b)).toBe('cancelled');
			expect(couch.byType('audit')).toHaveLength(1);
		});

		it('reports evacuees whose request keeps failing, without throwing or writing movements', async () => {
			const id = addEvacuee('active', null);
			couch.failBulk = (docs) => (docs[0]?.type === 'evacuee' ? 'before' : null);
			const run = await closeShelterPeople(couch.req, 'SH001', opts);
			expect(run.checked_out).toBe(0);
			expect(run.failed).toEqual([
				{ evacuee_id: id, error: 'request_failed: _bulk_docs failed on shelter_sh001 (500)' }
			]);
			expect(run.remaining.total).toBe(1);
			expect(couch.byType('movement')).toHaveLength(0);
		});

		it('rolls a check-out back when its movement request keeps failing', async () => {
			const id = addEvacuee('room_confirmed', null);
			couch.failBulk = (docs) => (docs[0]?.type === 'movement' ? 'before' : null);
			const run = await closeShelterPeople(couch.req, 'SH001', opts);
			expect(run.failed).toHaveLength(1);
			expect(run.failed[0].error).toMatch(/stay restored/);
			expect(stay(id)).toBe('room_confirmed');
		});

		it('retries the household + audit request', async () => {
			const h = addHousehold('pre_registered');
			addEvacuee('pre_registered', h);
			couch.failBulk = firstOf('household')('before');
			const run = await closeShelterPeople(couch.req, 'SH001', opts);
			expect(run.failed).toEqual([]);
			expect(couch.docs.get(h)!.status).toBe('cancelled');
			expect(couch.byType('audit')).toHaveLength(1);
		});

		it('does not duplicate the audit when the household request committed but lost its response', async () => {
			const h = addHousehold('pre_registered');
			addEvacuee('pre_registered', h);
			couch.failBulk = firstOf('household')('after');
			const run = await closeShelterPeople(couch.req, 'SH001', opts);
			expect(run.failed).toEqual([]);
			expect(couch.byType('audit')).toHaveLength(1);
		});
	});

	describe('reading the households failing', () => {
		const isHouseholdRead = (keys: string[]) => keys.some((k) => k.startsWith('household:'));

		it('retries the read and still derives the household', async () => {
			const h = addHousehold('pre_registered');
			addEvacuee('pre_registered', h);
			let failures = 1;
			couch.failKeysRead = (keys) => isHouseholdRead(keys) && failures-- > 0;
			const run = await closeShelterPeople(couch.req, 'SH001', opts);
			expect(run.failed).toEqual([]);
			expect(couch.docs.get(h)!.status).toBe('cancelled');
			expect(couch.byType('audit')).toHaveLength(1);
		});

		it('writes the cancel audit even when the household cannot be read, and reports it', async () => {
			const h = addHousehold('pre_registered');
			const id = addEvacuee('pre_registered', h);
			couch.failKeysRead = isHouseholdRead;
			const run = await closeShelterPeople(couch.req, 'SH001', opts);
			// FR-6a: the member is cancelled, so the audit must exist — a re-run will not come back.
			expect(stay(id)).toBe('cancelled');
			expect(couch.byType('audit')).toHaveLength(1);
			expect(run.failed).toEqual([
				{
					evacuee_id: id,
					error: `household ${h}: Could not read docs of shelter_sh001 (500)`
				}
			]);
			expect(couch.docs.get(h)!.status).toBe('pre_registered');
		});
	});

	it('raises an occupancy view error instead of hiding it behind a scan', async () => {
		couch.viewDeployed = true;
		couch.viewStatus = 500;
		await expect(previewShelterClose(couch.req, 'SH001')).rejects.toThrow(/occupancy/);
		expect(couch.scans).toBe(0);
	});

	it('reports a non-conflict write error without retrying', async () => {
		const id = addEvacuee('active', null);
		couch.beforeWrite = (doc) => (doc._id === id ? { error: 'forbidden', reason: 'nope' } : null);
		const run = await closeShelterPeople(couch.req, 'SH001', opts);
		expect(run.failed).toEqual([{ evacuee_id: id, error: 'forbidden: nope' }]);
		expect(couch.bulkCalls).toHaveLength(1);
	});

	it('closes a ~500-person shelter in ≤200-doc bulk calls (FR-10, FR-14)', async () => {
		for (let i = 0; i < 125; i += 1) {
			const h = addHousehold();
			addEvacuee('active', h);
			addEvacuee('room_confirmed', h);
			addEvacuee('temporary_leave', h);
			addEvacuee(i % 5 === 0 ? 'pre_registered' : 'arriving', h);
		}
		const run = await closeShelterPeople(couch.req, 'SH001', opts);
		expect(run.checked_out + run.cancelled).toBe(500);
		expect(run.cancelled).toBe(25);
		expect(run.failed).toEqual([]);
		expect(run.remaining.total).toBe(0);
		for (const docs of couch.bulkCalls) {
			expect(docs.length).toBeLessThanOrEqual(SHELTER_CLOSE_CHUNK_SIZE);
		}
		expect(couch.byType('movement')).toHaveLength(475);
		expect(couch.byType('household').every((h) => h.status === 'checked_out')).toBe(true);
	});

	it('pages through more than 1000 evacuees', async () => {
		for (let i = 0; i < 1001; i += 1) addEvacuee('active', null);
		const preview = await previewShelterClose(couch.req, 'SH001');
		expect(preview.total).toBe(1001);
	});
});

describe('chunkByHousehold', () => {
	const ev = (id: string, hh: string | null) => ({ _id: id, household_id: hh }) as Evacuee;

	it('never splits a household across chunks when it fits', () => {
		const list = [ev('a', 'h1'), ev('b', 'h1'), ev('c', 'h2'), ev('d', 'h2'), ev('e', 'h2')];
		expect(chunkByHousehold(list, 4).map((c) => c.map((e) => e._id))).toEqual([
			['a', 'b'],
			['c', 'd', 'e']
		]);
	});

	it('splits a household bigger than the chunk size', () => {
		const list = [ev('a', 'h1'), ev('b', 'h1'), ev('c', 'h1')];
		expect(chunkByHousehold(list, 2).map((c) => c.length)).toEqual([2, 1]);
	});
});
