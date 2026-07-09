/**
 * T-31.4 — persistence contract for the daily resource-calc engine.
 *
 * The application/UI layers depend on THIS interface, never on CouchDB or on the
 * peer feature internals. The concrete implementation reads all three calc inputs
 * (occupancy, effective SOP ratios, stock balance) through peer BARRELS only.
 */
import type { AuthorContext, BaseDoc } from '$lib/db/model';
import type { DailyCalcDoc } from '../domain/calc.schema';

/**
 * A persisted daily resource-calc snapshot: the pure `DailyCalcDoc` snapshot
 * (resource-calc/domain, T-31.2) wrapped in the shelter-DB `BaseDoc` envelope.
 *
 * `_id` is DETERMINISTIC — `daily_calc:{date}` (date = calendar day `YYYY-MM-DD`)
 * — so re-running a day's calc is IDEMPOTENT: exactly one doc per shelter per day.
 */
export interface DailyCalcRecord extends BaseDoc, DailyCalcDoc {
	type: 'daily_calc';
}

export const DAILY_CALC_ID_PREFIX = 'daily_calc';

/** `daily_calc:{date}` — the deterministic id for a calendar day (`YYYY-MM-DD`). */
export function dailyCalcDocId(date: string): string {
	return `${DAILY_CALC_ID_PREFIX}:${date}`;
}

/** Structural guard for a persisted daily-calc record. */
export const isDailyCalcRecord = (d: unknown): d is DailyCalcRecord =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'daily_calc';

export interface DailyCalcRepository {
	/** One day's persisted snapshot by date (`YYYY-MM-DD`), or `null` if not yet calculated. */
	get(date: string): Promise<DailyCalcRecord | null>;

	/**
	 * Compute + persist the snapshot for `date`, idempotent on `daily_calc:{date}`.
	 *
	 * Inputs are read through peer barrels (occupancy via `people`, effective ratios
	 * via `sop-ratios`, stock via `operations`) and fed to the pure engine. When a
	 * snapshot already exists it is OVERWRITTEN, but the losing revision is first
	 * preserved into an `audit:{action:retro_edit}` entry — persisted BEFORE the
	 * overwrite lands, so a retroactive recalculation is never silently lossy.
	 */
	runOnDemand(date: string, ctx: AuthorContext): Promise<DailyCalcRecord>;

	/**
	 * Snapshots for the inclusive date range `[from, to]` (`YYYY-MM-DD`), ascending
	 * by date. Implemented as a BOUNDED `startkey`/`endkey` scan over the deterministic
	 * ids — never a whole-collection read.
	 */
	listRange(from: string, to: string): Promise<DailyCalcRecord[]>;
}
