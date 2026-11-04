import { z } from 'zod';
import { type AuthorContext, type BaseDoc, type Timestamp, makeDoc, now } from '$lib/db/model';

/**
 * station_log domain (CR-192, schema.md §1.8) — per-station service time.
 *
 * Append-only: one doc per `start` / `complete` event of an evacuee at a station of the
 * intake pipeline (ADR-0001). Duration is never persisted; it is derived by
 * {@link summarizeStationTimes} when the dashboard summary is built.
 *
 * Pure: no I/O, no Svelte. Safe to import from server routes via `people/server.ts`.
 */

// ---------------------------------------------------------------- enums
export const STATION_NUMBERS = [1, 2, 3] as const;
export type StationNumber = (typeof STATION_NUMBERS)[number];
export const stationNumberSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const stationLogActionSchema = z.enum(['start', 'complete']);
export type StationLogAction = z.infer<typeof stationLogActionSchema>;

export const stationLogChannelSchema = z.enum(['kiosk', 'staff']);
export type StationLogChannel = z.infer<typeof stationLogChannelSchema>;

/** A `start` without a `complete` older than this is abandoned (CR-192 "Stale window"). */
export const STATION_LOG_STALE_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Warning shown when a station log write fails but the station action succeeded (FR-STL-04). */
export const STATION_LOG_WRITE_WARNING = 'บันทึกข้อมูลสำเร็จ แต่ระบบบันทึกเวลาการให้บริการขัดข้อง';

// ---------------------------------------------------------------- doc
export interface StationLog extends BaseDoc {
	type: 'station_log';
	evacuee_id: string;
	station: StationNumber;
	action: StationLogAction;
	channel: StationLogChannel;
	/** Scanner device — only when `channel = 'kiosk'`. */
	device_id?: string;
	/** Real event time (not sync time). */
	occurred_at: Timestamp;
}

// ---------------------------------------------------------------- input schema
export const stationLogInputSchema = z
	.object({
		evacuee_id: z.string().min(1),
		station: stationNumberSchema,
		action: stationLogActionSchema,
		channel: stationLogChannelSchema,
		device_id: z.string().trim().min(1).optional(),
		occurred_at: z.string().optional() // defaults to now() in the factory
	})
	.superRefine((v, ctx) => {
		// Station 2 and 3 are staff-only (FR-STL-02); only Station 1 has a kiosk channel.
		if (v.station !== 1 && v.channel !== 'staff') {
			ctx.addIssue({
				code: 'custom',
				path: ['channel'],
				message: 'Station 2 และ 3 ต้องเป็นช่องทาง staff เท่านั้น'
			});
		}
	});
export type StationLogInput = z.input<typeof stationLogInputSchema>;

export function createStationLog(
	input: StationLogInput,
	ctx: AuthorContext,
	id?: string
): StationLog {
	const d = stationLogInputSchema.parse(input);
	return makeDoc(
		'station_log',
		1,
		{
			evacuee_id: d.evacuee_id,
			station: d.station,
			action: d.action,
			channel: d.channel,
			...(d.channel === 'kiosk' && d.device_id ? { device_id: d.device_id } : {}),
			occurred_at: d.occurred_at ?? now()
		},
		ctx,
		id
	);
}

// ---------------------------------------------------------------- kiosk start time (O7/O8)
/**
 * Station 1 kiosk `start` time. The kiosk browser carries the time it looked the visitor up (or
 * read the card, for a walk-in); the server trusts it only within `[now − stale window, now]`
 * and otherwise uses its own clock — a stray or hostile value can never backdate a visit.
 */
export function resolveKioskStartedAt(raw: unknown, nowMs: number = Date.now()): string {
	const parsed = typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
	if (Number.isFinite(parsed) && parsed <= nowMs && parsed >= nowMs - STATION_LOG_STALE_WINDOW_MS) {
		return new Date(parsed).toISOString();
	}
	return new Date(nowMs).toISOString();
}

// ---------------------------------------------------------------- start idempotency (FR-STL-13)
/** The slice of a `station_log` that {@link hasOpenStationStart} needs. */
export interface StationLogEventLike {
	action: StationLogAction;
	occurred_at: string;
}

/**
 * True when the evacuee already has a live `start` at this station: the latest `start` has no
 * later `complete` and is not older than the stale window. Staff `start` writes are skipped in
 * that case so re-opening / refreshing the page does not add a duplicate (FR-STL-13).
 *
 * @param events - the `(evacuee_id, station)` log events, any order
 */
export function hasOpenStationStart(
	events: readonly StationLogEventLike[],
	nowMs: number = Date.now()
): boolean {
	let latestStart: number | null = null;
	for (const e of events) {
		if (e.action !== 'start') continue;
		const t = Date.parse(e.occurred_at);
		if (Number.isFinite(t) && (latestStart === null || t > latestStart)) latestStart = t;
	}
	if (latestStart === null) return false;
	for (const e of events) {
		if (e.action !== 'complete') continue;
		const t = Date.parse(e.occurred_at);
		if (Number.isFinite(t) && t >= latestStart) return false;
	}
	return nowMs - latestStart <= STATION_LOG_STALE_WINDOW_MS;
}

// ---------------------------------------------------------------- pairing + summary (FR-STL-22)
/** One log event as read from the `station_logs_by_station` view. */
export interface StationLogEvent {
	evacuee_id: string;
	station: StationNumber;
	channel: StationLogChannel;
	action: StationLogAction;
	occurred_at: string;
	/** Who wrote the event (FR-STL-30): `created_by` for staff, `device_id` for a kiosk. */
	actor?: string;
}

/** The (station, channel) combinations that exist: Station 1 is hybrid, 2 and 3 staff only. */
export const STATION_CHANNEL_COMBOS: readonly {
	station: StationNumber;
	channel: StationLogChannel;
}[] = [
	{ station: 1, channel: 'staff' },
	{ station: 1, channel: 'kiosk' },
	{ station: 2, channel: 'staff' },
	{ station: 3, channel: 'staff' }
];

export interface StationTimeRow {
	station: StationNumber;
	channel: StationLogChannel;
	/**
	 * Completed visits: timed visits plus `complete` events with no matching `start`
	 * (e.g. bulk zoning) — throughput. Visits are counted on the date of their `start`
	 * (a start-less complete counts on its own date).
	 */
	visits: number;
	/** Visits that have both a `start` and a `complete`; the denominator of the average. */
	timed_visits: number;
	/** Mean `complete − start` in seconds over timed visits; `null` when there are none. */
	avg_duration_sec: number | null;
	/** `start` with no `complete` yet and not older than the stale window. */
	open_visits: number;
}

/** `YYYY-MM-DD` of an instant in Asia/Bangkok (UTC+7, no DST). */
export function bangkokDateOf(ms: number): string {
	return new Date(ms + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

interface Acc {
	visits: number;
	timed: number;
	durationMs: number;
	open: number;
}

/**
 * Pair `start` / `complete` events per `(evacuee_id, station)` and aggregate per
 * `(station, channel)`.
 *
 * Rules (CR-192 "Visit"):
 * - A visit is a `start` plus the first `complete` with `occurred_at ≥ start`, before the next
 *   `start` of the same key, and within the stale window of the `start`.
 * - A visit's channel is the channel of its `start` (O9); the `complete` only closes it.
 * - `start` with no `complete`: open when it is the latest `start` of its key and not older
 *   than the stale window; otherwise abandoned and counted nowhere. A `start` superseded by a
 *   later `start` is abandoned (the person began again), never open.
 * - `complete` with no `start`: counted in `visits` only, on its own channel.
 * - A visit is anchored on the Asia/Bangkok date of its `start`; with `from` / `to`
 *   (inclusive `YYYY-MM-DD`) only visits anchored inside the range are counted. Events outside
 *   the range may still be passed in so a visit that straddles midnight pairs correctly.
 *
 * Always returns one row per {@link STATION_CHANNEL_COMBOS} entry, zero-filled.
 */
export function summarizeStationTimes(
	events: readonly StationLogEvent[],
	opts: { nowMs?: number; from?: string; to?: string } = {}
): StationTimeRow[] {
	const inRange = rangeFilter(opts);
	const acc = new Map<string, Acc>();
	const bucket = (station: StationNumber, channel: StationLogChannel): Acc => {
		const k = `${station}:${channel}`;
		let a = acc.get(k);
		if (!a) acc.set(k, (a = { visits: 0, timed: 0, durationMs: 0, open: 0 }));
		return a;
	};

	for (const visit of pairStationVisits(events, opts.nowMs ?? Date.now())) {
		if (visit.kind === 'timed') {
			if (!inRange(visit.start.t)) continue;
			const a = bucket(visit.start.ev.station, visit.start.ev.channel);
			a.visits += 1;
			a.timed += 1;
			a.durationMs += visit.complete.t - visit.start.t;
		} else if (visit.kind === 'orphan') {
			if (inRange(visit.complete.t))
				bucket(visit.complete.ev.station, visit.complete.ev.channel).visits += 1;
		} else if (inRange(visit.start.t)) {
			bucket(visit.start.ev.station, visit.start.ev.channel).open += 1;
		}
	}

	return STATION_CHANNEL_COMBOS.map(({ station, channel }) => {
		const a = acc.get(`${station}:${channel}`);
		return {
			station,
			channel,
			visits: a?.visits ?? 0,
			timed_visits: a?.timed ?? 0,
			avg_duration_sec: a && a.timed > 0 ? a.durationMs / a.timed / 1000 : null,
			open_visits: a?.open ?? 0
		};
	});
}

// ---------------------------------------------------------------- per-actor rank (Amendment 2)
/** Average service time of one staff member (or one kiosk device) at one station. */
export interface StationActorRow {
	station: StationNumber;
	/** `created_by` for staff, `device_id` for a kiosk (FR-STL-30). */
	actor_id: string;
	kind: StationLogChannel;
	timed_visits: number;
	avg_duration_sec: number;
}

/**
 * Per-actor average service time per station (CR-192 Amendment 2, FR-STL-31). A visit counts
 * for an actor only when the same actor wrote its `start` and its `complete`; hand-offs,
 * start-less completes and open visits are left out (they still count per station).
 * Same pairing and date-anchoring rules as {@link summarizeStationTimes}. Unsorted — order with
 * {@link compareStationActorRank} once display names are known.
 */
export function rankStationActors(
	events: readonly StationLogEvent[],
	opts: { nowMs?: number; from?: string; to?: string } = {}
): StationActorRow[] {
	const inRange = rangeFilter(opts);
	const acc = new Map<string, StationActorRow & { durationMs: number }>();
	for (const visit of pairStationVisits(events, opts.nowMs ?? Date.now())) {
		if (visit.kind !== 'timed' || !inRange(visit.start.t)) continue;
		const { ev } = visit.start;
		const actor = ev.actor;
		if (!actor || actor !== visit.complete.ev.actor || ev.channel !== visit.complete.ev.channel) {
			continue;
		}
		const k = `${ev.station}\u0000${ev.channel}\u0000${actor}`;
		let a = acc.get(k);
		if (!a) {
			a = {
				station: ev.station,
				actor_id: actor,
				kind: ev.channel,
				timed_visits: 0,
				avg_duration_sec: 0,
				durationMs: 0
			};
			acc.set(k, a);
		}
		a.timed_visits += 1;
		a.durationMs += visit.complete.t - visit.start.t;
	}
	return [...acc.values()].map(({ durationMs, ...row }) => ({
		...row,
		avg_duration_sec: durationMs / row.timed_visits / 1000
	}));
}

/** Rank order (FR-STL-35): fastest first, then more visits, then display name. */
export function compareStationActorRank(
	a: { avg_duration_sec: number; timed_visits: number; display_name: string },
	b: { avg_duration_sec: number; timed_visits: number; display_name: string }
): number {
	return (
		a.avg_duration_sec - b.avg_duration_sec ||
		b.timed_visits - a.timed_visits ||
		a.display_name.localeCompare(b.display_name, 'th')
	);
}

// ---------------------------------------------------------------- shared pairing
type TimedEvent = { t: number; ev: StationLogEvent };
type PairedVisit =
	| { kind: 'timed'; start: TimedEvent; complete: TimedEvent }
	| { kind: 'orphan'; complete: TimedEvent }
	| { kind: 'open'; start: TimedEvent };

function rangeFilter(opts: { from?: string; to?: string }): (ms: number) => boolean {
	return (ms) => {
		const date = bangkokDateOf(ms);
		return (!opts.from || date >= opts.from) && (!opts.to || date <= opts.to);
	};
}

/**
 * The visit rules of {@link summarizeStationTimes}, applied per `(evacuee_id, station)`:
 * yields each timed visit, each start-less `complete` (orphan) and each open `start`.
 * Abandoned starts (superseded, or older than the stale window) yield nothing.
 */
function* pairStationVisits(
	events: readonly StationLogEvent[],
	nowMs: number
): Generator<PairedVisit> {
	const byKey = new Map<string, TimedEvent[]>();
	for (const ev of events) {
		const t = Date.parse(ev.occurred_at);
		if (!Number.isFinite(t)) continue;
		const k = `${ev.evacuee_id}\u0000${ev.station}`;
		const list = byKey.get(k);
		if (list) list.push({ t, ev });
		else byKey.set(k, [{ t, ev }]);
	}

	for (const list of byKey.values()) {
		// Chronological; on a tie the `start` goes first so a zero-length visit still pairs.
		list.sort(
			(a, b) => a.t - b.t || (a.ev.action === b.ev.action ? 0 : a.ev.action === 'start' ? -1 : 1)
		);
		let pending: TimedEvent | null = null;
		for (const item of list) {
			if (item.ev.action === 'start') {
				pending = item; // a previous unresolved start is superseded → abandoned
				continue;
			}
			if (pending && item.t - pending.t <= STATION_LOG_STALE_WINDOW_MS) {
				yield { kind: 'timed', start: pending, complete: item };
			} else {
				yield { kind: 'orphan', complete: item }; // throughput only
			}
			pending = null;
		}
		if (pending && nowMs - pending.t <= STATION_LOG_STALE_WINDOW_MS) {
			yield { kind: 'open', start: pending };
		}
	}
}
