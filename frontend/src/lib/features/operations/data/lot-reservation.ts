import type { AuthorContext } from '$lib/db/model';
import { buildLotNos, lotCounterId, lotDateStamp, nextCounterLast } from '../domain/operations';

/**
 * Lot-number reservation loop (CR-244 FR-4…FR-8, FR-17) — the ONE implementation shared by the
 * BFF donation intake, kitchen receipt and stock page. Each caller injects a
 * {@link LotCounterConnector} over its own CouchDB access path.
 *
 * Pure of I/O itself: no fetch, no Svelte — safe to import from server code.
 */

/** A `lot_counter` doc as read from CouchDB (`conflicts=true` adds `_conflicts`). */
export interface LotCounterRecord {
	_id: string;
	_rev?: string;
	type?: string;
	last: number;
	_conflicts?: string[];
	[field: string]: unknown;
}

export type LotCounterPutResult = { ok: true } | { ok: false; conflict: true };

export interface LotCounterConnector {
	/**
	 * Read one counter doc **with `conflicts=true`**; `opts.rev` reads that specific revision
	 * (used to fetch the losing revisions of a conflict, FR-17). `null` when absent.
	 */
	get(id: string, opts?: { rev?: string }): Promise<LotCounterRecord | null>;
	/** `PUT` the doc. Report a `409` as `{ ok: false, conflict: true }`; throw on anything else. */
	put(doc: LotCounterRecord): Promise<LotCounterPutResult>;
	/** Highest `lot_no` sequence of that day (`YYMMDD`) already on `stock_ledger`, 0 if none. Throws on failure. */
	seedMax(stamp: string): Promise<number>;
}

export interface ReserveLotNosOptions {
	connector: LotCounterConnector;
	/** Stamps the envelope of a counter doc created on first reservation of the day. */
	ctx: AuthorContext;
	count: number;
	when?: Date;
	/** Test seams. */
	sleep?: (ms: number) => Promise<void>;
	random?: () => number;
}

export const LOT_RESERVATION_MAX_ATTEMPTS = 5;
export const LOT_RESERVATION_WAIT_MS = { min: 50, max: 200 } as const;
export const LOT_COUNTER_SCHEMA_V = 1;

/** Thrown when numbers cannot be reserved — callers surface it; there is no fallback to `001` (FR-8). */
export class LotReservationError extends Error {
	/**
	 * HTTP status a route answers with (`routeErrorResponse` reads it): 503 when retrying may help,
	 * 500 when the stored counter is corrupt and an admin must look at it.
	 */
	readonly status: number;

	constructor(
		message = 'ออกเลขล็อตไม่สำเร็จ กรุณาลองอีกครั้ง',
		options?: { cause?: unknown; retryable?: boolean }
	) {
		super(message, options?.cause === undefined ? undefined : { cause: options.cause });
		this.name = 'LotReservationError';
		this.status = options?.retryable === false ? 500 : 503;
	}
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function assertCounterLast(last: unknown): number {
	if (typeof last !== 'number' || !Number.isInteger(last) || last < 0) {
		throw new LotReservationError(
			'ออกเลขล็อตไม่สำเร็จ: ตัวนับเลขล็อตมีค่าไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ',
			{ retryable: false }
		);
	}
	return last;
}

/**
 * Reserve `count` consecutive lot numbers `L-YYMMDD-XXX` for the day of `when`.
 * Throws {@link LotReservationError} on any failure — never returns a guessed sequence.
 */
export async function reserveLotNos(options: ReserveLotNosOptions): Promise<string[]> {
	const {
		connector,
		ctx,
		count,
		when = new Date(),
		sleep = defaultSleep,
		random = Math.random
	} = options;
	if (count <= 0) return [];

	const stamp = lotDateStamp(when);
	const id = lotCounterId(stamp);

	for (let attempt = 1; attempt <= LOT_RESERVATION_MAX_ATTEMPTS; attempt++) {
		let base: number;
		let doc: LotCounterRecord;
		try {
			const current = await connector.get(id);
			if (current === null) {
				// First reservation of the day: seed from rows issued before the counter existed.
				base = assertCounterLast(await connector.seedMax(stamp));
				const ts = new Date().toISOString();
				doc = {
					_id: id,
					type: 'lot_counter',
					schema_v: LOT_COUNTER_SCHEMA_V,
					shelter_code: ctx.shelterCode,
					created_at: ts,
					updated_at: ts,
					created_by: ctx.createdBy,
					last: nextCounterLast(base, count)
				};
			} else {
				base = assertCounterLast(current.last);
				// FR-17: replication left conflicting revisions — the winner is picked by history
				// length, not by `last`, so take the max across every revision as the base.
				for (const rev of current._conflicts ?? []) {
					const other = await connector.get(id, { rev });
					if (other) base = Math.max(base, assertCounterLast(other.last));
				}
				doc = {
					...current,
					last: nextCounterLast(base, count),
					updated_at: new Date().toISOString()
				};
				delete doc._conflicts;
			}
			const res = await connector.put(doc);
			if (res.ok) return buildLotNos(when, base + 1, count);
		} catch (cause) {
			if (cause instanceof LotReservationError) throw cause;
			throw new LotReservationError(undefined, { cause });
		}
		// 409: someone else reserved first. Random wait so two colliding callers desynchronise.
		if (attempt < LOT_RESERVATION_MAX_ATTEMPTS) {
			const { min, max } = LOT_RESERVATION_WAIT_MS;
			await sleep(min + Math.floor(random() * (max - min + 1)));
		}
	}
	throw new LotReservationError(
		'ออกเลขล็อตไม่สำเร็จ: มีการรับของพร้อมกันหลายรายการ กรุณาลองอีกครั้ง'
	);
}
