import { describe, expect, it } from 'vitest';
import {
	LOT_RESERVATION_MAX_ATTEMPTS,
	LotReservationError,
	reserveLotNos,
	type LotCounterConnector,
	type LotCounterPutResult,
	type LotCounterRecord
} from './lot-reservation';

const when = new Date(2026, 10, 2); // 261102
const ctx = { shelterCode: 'SH001', createdBy: 'tester' };
const id = 'lot_counter:L-261102';

/** In-memory CouchDB stand-in: `_rev` compare-and-swap, 409 on stale/missing rev. */
function fakeConnector(
	init: {
		doc?: LotCounterRecord;
		seed?: number | Error;
		conflicts?: LotCounterRecord[];
		beforePut?: () => void;
	} = {}
) {
	let doc: LotCounterRecord | null = init.doc ?? null;
	let revN = doc ? 1 : 0;
	const calls = { get: 0, put: 0, seed: 0 };
	const connector: LotCounterConnector = {
		async get(_id, opts) {
			calls.get++;
			if (opts?.rev) return init.conflicts?.find((c) => c._rev === opts.rev) ?? null;
			return doc ? structuredClone(doc) : null;
		},
		async put(next): Promise<LotCounterPutResult> {
			calls.put++;
			init.beforePut?.();
			if ((doc?._rev ?? undefined) !== next._rev) return { ok: false, conflict: true };
			revN++;
			doc = { ...next, _rev: `${revN}-x` };
			return { ok: true };
		},
		async seedMax() {
			calls.seed++;
			if (init.seed instanceof Error) throw init.seed;
			return init.seed ?? 0;
		}
	};
	return {
		connector,
		calls,
		doc: () => doc,
		bump: (last: number) => {
			revN++;
			doc = { ...(doc as LotCounterRecord), last, _rev: `${revN}-x` };
		}
	};
}

const base = { when, ctx, sleep: async () => {}, random: () => 0 };
const rec = (
	last: number,
	rev: string,
	extra: Partial<LotCounterRecord> = {}
): LotCounterRecord => ({
	_id: id,
	_rev: rev,
	type: 'lot_counter',
	last,
	...extra
});

describe('reserveLotNos', () => {
	it('AC-2: count=3 at last=7 gives 008..010 and last=10', async () => {
		const f = fakeConnector({ doc: rec(7, '1-a') });
		const nos = await reserveLotNos({ ...base, connector: f.connector, count: 3 });
		expect(nos).toEqual(['L-261102-008', 'L-261102-009', 'L-261102-010']);
		expect(f.doc()?.last).toBe(10);
		expect(f.calls.seed).toBe(0);
	});

	it('returns [] for count 0 without touching CouchDB', async () => {
		const f = fakeConnector();
		expect(await reserveLotNos({ ...base, connector: f.connector, count: 0 })).toEqual([]);
		expect(f.calls.get).toBe(0);
	});

	it('AC-4: first reservation of the day creates the counter seeded from the ledger max (no _rev)', async () => {
		const f = fakeConnector({ seed: 4 });
		const nos = await reserveLotNos({ ...base, connector: f.connector, count: 2 });
		expect(nos).toEqual(['L-261102-005', 'L-261102-006']);
		expect(f.doc()).toMatchObject({
			_id: id,
			type: 'lot_counter',
			schema_v: 1,
			shelter_code: 'SH001',
			created_by: 'tester',
			last: 6
		});
		expect(f.calls.seed).toBe(1);
	});

	it('starts at 001 only when the seed lookup succeeded with 0', async () => {
		const f = fakeConnector({ seed: 0 });
		expect(await reserveLotNos({ ...base, connector: f.connector, count: 1 })).toEqual([
			'L-261102-001'
		]);
	});

	it('AC-3: a failed seed lookup throws and never assumes 0', async () => {
		const f = fakeConnector({ seed: new Error('find 500') });
		await expect(reserveLotNos({ ...base, connector: f.connector, count: 1 })).rejects.toThrow(
			LotReservationError
		);
		expect(f.doc()).toBeNull();
		expect(f.calls.put).toBe(0);
	});

	it('AC-3: an unreachable CouchDB (get throws) throws; nothing is written', async () => {
		const f = fakeConnector();
		f.connector.get = async () => {
			throw new Error('ECONNREFUSED');
		};
		await expect(reserveLotNos({ ...base, connector: f.connector, count: 1 })).rejects.toThrow(
			'ออกเลขล็อตไม่สำเร็จ'
		);
		expect(f.calls.put).toBe(0);
	});

	it('a non-409 put failure throws without retrying', async () => {
		const f = fakeConnector({ doc: rec(1, '1-a') });
		f.connector.put = async () => {
			throw new Error('500');
		};
		await expect(reserveLotNos({ ...base, connector: f.connector, count: 1 })).rejects.toThrow(
			LotReservationError
		);
	});

	it('FR-5: 409 waits a random 50-200 ms, re-reads and retries', async () => {
		const waits: number[] = [];
		let raced = false;
		const f = fakeConnector({
			doc: rec(7, '1-a'),
			beforePut: () => {
				if (!raced) {
					raced = true;
					f.bump(9); // someone else reserved 8..9 first
				}
			}
		});
		const nos = await reserveLotNos({
			...base,
			connector: f.connector,
			count: 1,
			random: () => 0.5,
			sleep: async (ms) => void waits.push(ms)
		});
		expect(nos).toEqual(['L-261102-010']);
		expect(waits).toHaveLength(1);
		expect(waits[0]).toBeGreaterThanOrEqual(50);
		expect(waits[0]).toBeLessThanOrEqual(200);
		expect(f.calls.put).toBe(2);
	});

	it('wait bounds: random 0 -> 50 ms, random ~1 -> 200 ms', async () => {
		const waits: number[] = [];
		for (const random of [() => 0, () => 0.999999]) {
			let raced = false;
			const f = fakeConnector({
				doc: rec(1, '1-a'),
				beforePut: () => {
					if (!raced) {
						raced = true;
						f.bump(2);
					}
				}
			});
			await reserveLotNos({
				...base,
				connector: f.connector,
				count: 1,
				random,
				sleep: async (ms) => void waits.push(ms)
			});
		}
		expect(waits).toEqual([50, 200]);
	});

	it('AC-1: two concurrent reservations get non-overlapping ranges', async () => {
		const f = fakeConnector({ doc: rec(0, '1-a') });
		const [a, b] = await Promise.all([
			reserveLotNos({ ...base, connector: f.connector, count: 3 }),
			reserveLotNos({ ...base, connector: f.connector, count: 2 })
		]);
		const all = [...a, ...b];
		expect(new Set(all).size).toBe(5);
		expect(f.doc()?.last).toBe(5);
		expect(f.calls.put).toBeGreaterThan(2); // at least one 409 retry happened
	});

	it('AC-1: two concurrent first-of-day creates collide on 409 and one re-reads', async () => {
		const f = fakeConnector({ seed: 3 });
		const [a, b] = await Promise.all([
			reserveLotNos({ ...base, connector: f.connector, count: 1 }),
			reserveLotNos({ ...base, connector: f.connector, count: 1 })
		]);
		expect(new Set([...a, ...b]).size).toBe(2);
		expect(f.doc()?.last).toBe(5);
	});

	it('gives up after 5 attempts of 409 with a thrown error', async () => {
		const f = fakeConnector({ doc: rec(1, '1-a') });
		f.connector.put = async () => {
			f.calls.put++;
			return { ok: false, conflict: true };
		};
		await expect(reserveLotNos({ ...base, connector: f.connector, count: 1 })).rejects.toThrow(
			LotReservationError
		);
		expect(f.calls.put).toBe(LOT_RESERVATION_MAX_ATTEMPTS);
		expect(LOT_RESERVATION_MAX_ATTEMPTS).toBe(5);
	});

	it('AC-9 / FR-17: conflicting revisions (last=7 vs 12) use max(last) as the base', async () => {
		const f = fakeConnector({
			doc: rec(7, '3-win', { _conflicts: ['2-lose'] }),
			conflicts: [rec(12, '2-lose')]
		});
		const nos = await reserveLotNos({ ...base, connector: f.connector, count: 1 });
		expect(nos).toEqual(['L-261102-013']);
		expect(f.doc()?.last).toBe(13);
		expect(f.doc()?._conflicts).toBeUndefined();
	});

	it('rejects a corrupt counter value as non-retryable (status 500, no guessing)', async () => {
		const f = fakeConnector({ doc: rec(-1, '1-a') });
		const err = await reserveLotNos({ ...base, connector: f.connector, count: 1 }).catch((e) => e);
		expect(err).toBeInstanceOf(LotReservationError);
		expect(err.status).toBe(500);
		expect(err.message).toContain('ตัวนับเลขล็อตมีค่าไม่ถูกต้อง');
	});

	it('transient failures are retryable (status 503)', async () => {
		const f = fakeConnector({ seed: new Error('find 500') });
		const err = await reserveLotNos({ ...base, connector: f.connector, count: 1 }).catch((e) => e);
		expect(err.status).toBe(503);
		const busy = fakeConnector({ doc: rec(1, '1-a') });
		busy.connector.put = async () => ({ ok: false, conflict: true });
		const exhausted = await reserveLotNos({ ...base, connector: busy.connector, count: 1 }).catch(
			(e) => e
		);
		expect(exhausted.status).toBe(503);
	});
});
