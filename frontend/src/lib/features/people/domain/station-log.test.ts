import { describe, expect, it } from 'vitest';
import {
	STATION_LOG_STALE_WINDOW_MS,
	compareStationActorRank,
	createStationLog,
	hasOpenStationStart,
	resolveKioskStartedAt,
	stationLogInputSchema,
	rankStationActors,
	summarizeStationTimes,
	type StationLogEvent
} from './station-log';

const CTX = { shelterCode: 'SH001', createdBy: 'user:u1' };
const MIN = 60 * 1000;
const T0 = Date.parse('2026-10-25T03:00:00.000Z'); // 10:00 Asia/Bangkok
const iso = (ms: number) => new Date(ms).toISOString();

function ev(
	evacuee_id: string,
	station: 1 | 2 | 3,
	action: 'start' | 'complete',
	ms: number,
	channel: 'kiosk' | 'staff' = 'staff'
): StationLogEvent {
	return { evacuee_id, station, channel, action, occurred_at: iso(ms) };
}

const row = (rows: ReturnType<typeof summarizeStationTimes>, station: number, channel: string) =>
	rows.find((r) => r.station === station && r.channel === channel)!;

describe('createStationLog', () => {
	it('stamps an append-only v1 envelope', () => {
		const doc = createStationLog(
			{ evacuee_id: 'evacuee:1', station: 1, action: 'start', channel: 'staff' },
			CTX
		);
		expect(doc._id).toMatch(/^station_log:/);
		expect(doc.type).toBe('station_log');
		expect(doc.schema_v).toBe(1);
		expect(doc.created_at).toBe(doc.updated_at);
		expect(doc.created_by).toBe('user:u1');
		expect(doc.device_id).toBeUndefined();
		expect(Date.parse(doc.occurred_at)).not.toBeNaN();
	});

	it('keeps device_id only for the kiosk channel', () => {
		const kiosk = createStationLog(
			{ evacuee_id: 'e', station: 1, action: 'complete', channel: 'kiosk', device_id: 'dev-1' },
			{ shelterCode: 'SH001', createdBy: 'kiosk:dev-1' }
		);
		expect(kiosk.device_id).toBe('dev-1');
		const staff = createStationLog(
			{ evacuee_id: 'e', station: 1, action: 'complete', channel: 'staff', device_id: 'dev-1' },
			CTX
		);
		expect(staff.device_id).toBeUndefined();
	});

	it('honours an explicit occurred_at', () => {
		const doc = createStationLog(
			{ evacuee_id: 'e', station: 3, action: 'complete', channel: 'staff', occurred_at: iso(T0) },
			CTX
		);
		expect(doc.occurred_at).toBe(iso(T0));
	});

	it('rejects a bad station, action or channel', () => {
		const base = { evacuee_id: 'e', station: 1, action: 'start', channel: 'staff' };
		expect(stationLogInputSchema.safeParse({ ...base, station: 4 }).success).toBe(false);
		expect(stationLogInputSchema.safeParse({ ...base, station: 0 }).success).toBe(false);
		expect(stationLogInputSchema.safeParse({ ...base, station: '1' }).success).toBe(false);
		expect(stationLogInputSchema.safeParse({ ...base, action: 'pause' }).success).toBe(false);
		expect(stationLogInputSchema.safeParse({ ...base, channel: 'web' }).success).toBe(false);
		expect(stationLogInputSchema.safeParse({ ...base, evacuee_id: '' }).success).toBe(false);
	});

	it('rejects the kiosk channel on station 2 and 3 only', () => {
		const base = { evacuee_id: 'e', action: 'start', channel: 'kiosk' };
		expect(stationLogInputSchema.safeParse({ ...base, station: 1 }).success).toBe(true);
		expect(stationLogInputSchema.safeParse({ ...base, station: 2 }).success).toBe(false);
		expect(stationLogInputSchema.safeParse({ ...base, station: 3 }).success).toBe(false);
	});
});

describe('resolveKioskStartedAt', () => {
	it('keeps a lookup time inside the window', () => {
		expect(resolveKioskStartedAt(iso(T0 - 5 * MIN), T0)).toBe(iso(T0 - 5 * MIN));
		expect(resolveKioskStartedAt(iso(T0), T0)).toBe(iso(T0));
		expect(resolveKioskStartedAt(iso(T0 - STATION_LOG_STALE_WINDOW_MS), T0)).toBe(
			iso(T0 - STATION_LOG_STALE_WINDOW_MS)
		);
	});

	it('falls back to server now for a future, too-old, missing or malformed value', () => {
		expect(resolveKioskStartedAt(iso(T0 + MIN), T0)).toBe(iso(T0));
		expect(resolveKioskStartedAt(iso(T0 - STATION_LOG_STALE_WINDOW_MS - MIN), T0)).toBe(iso(T0));
		expect(resolveKioskStartedAt(undefined, T0)).toBe(iso(T0));
		expect(resolveKioskStartedAt('not a date', T0)).toBe(iso(T0));
		expect(resolveKioskStartedAt(12345, T0)).toBe(iso(T0));
	});
});

describe('hasOpenStationStart', () => {
	const start = (ms: number) => ({ action: 'start' as const, occurred_at: iso(ms) });
	const complete = (ms: number) => ({ action: 'complete' as const, occurred_at: iso(ms) });

	it('is false with no events or only a complete', () => {
		expect(hasOpenStationStart([], T0)).toBe(false);
		expect(hasOpenStationStart([complete(T0)], T0)).toBe(false);
	});

	it('is true for a fresh start with no complete', () => {
		expect(hasOpenStationStart([start(T0 - 5 * MIN)], T0)).toBe(true);
	});

	it('is false once a complete follows the start', () => {
		expect(hasOpenStationStart([start(T0 - 10 * MIN), complete(T0 - 5 * MIN)], T0)).toBe(false);
	});

	it('is false for a start older than the stale window', () => {
		expect(hasOpenStationStart([start(T0 - STATION_LOG_STALE_WINDOW_MS - MIN)], T0)).toBe(false);
		expect(hasOpenStationStart([start(T0 - STATION_LOG_STALE_WINDOW_MS)], T0)).toBe(true);
	});

	it('uses the latest start', () => {
		const events = [start(T0 - 5 * 60 * MIN), complete(T0 - 4 * 60 * MIN), start(T0 - MIN)];
		expect(hasOpenStationStart(events, T0)).toBe(true);
	});
});

describe('summarizeStationTimes', () => {
	it('returns zero-filled rows for the four station/channel combinations', () => {
		const rows = summarizeStationTimes([], { nowMs: T0 });
		expect(rows.map((r) => `${r.station}:${r.channel}`)).toEqual([
			'1:staff',
			'1:kiosk',
			'2:staff',
			'3:staff'
		]);
		for (const r of rows) {
			expect(r).toMatchObject({
				visits: 0,
				timed_visits: 0,
				avg_duration_sec: null,
				open_visits: 0
			});
		}
	});

	it('averages normal visits per station and channel', () => {
		const events = [
			ev('a', 1, 'start', T0, 'staff'),
			ev('a', 1, 'complete', T0 + 6 * MIN, 'staff'),
			ev('b', 1, 'start', T0, 'staff'),
			ev('b', 1, 'complete', T0 + 8 * MIN, 'staff'),
			ev('c', 1, 'start', T0, 'kiosk'),
			ev('c', 1, 'complete', T0 + 1 * MIN, 'kiosk'),
			ev('a', 2, 'start', T0 + 7 * MIN),
			ev('a', 2, 'complete', T0 + 10 * MIN)
		];
		const rows = summarizeStationTimes(events, { nowMs: T0 + 60 * MIN });
		expect(row(rows, 1, 'staff')).toMatchObject({
			visits: 2,
			timed_visits: 2,
			avg_duration_sec: 420
		});
		expect(row(rows, 1, 'kiosk')).toMatchObject({
			visits: 1,
			timed_visits: 1,
			avg_duration_sec: 60
		});
		expect(row(rows, 2, 'staff')).toMatchObject({ visits: 1, avg_duration_sec: 180 });
		expect(row(rows, 3, 'staff')).toMatchObject({ visits: 0, avg_duration_sec: null });
	});

	it('counts a recent start with no complete as open, not in the average', () => {
		const rows = summarizeStationTimes(
			[
				ev('a', 1, 'start', T0 - 30 * MIN),
				ev('b', 1, 'start', T0 - 20 * MIN),
				ev('b', 1, 'complete', T0 - 10 * MIN)
			],
			{ nowMs: T0 }
		);
		expect(row(rows, 1, 'staff')).toMatchObject({
			visits: 1,
			timed_visits: 1,
			avg_duration_sec: 600,
			open_visits: 1
		});
	});

	it('drops an abandoned start (older than the stale window) from every count', () => {
		const rows = summarizeStationTimes([ev('a', 1, 'start', T0 - 3 * 60 * MIN)], { nowMs: T0 });
		expect(row(rows, 1, 'staff')).toMatchObject({
			visits: 0,
			open_visits: 0,
			avg_duration_sec: null
		});
	});

	it('does not pair a complete with a start older than the stale window', () => {
		const stale = T0 - 3 * 60 * MIN;
		const rows = summarizeStationTimes(
			[ev('a', 3, 'start', stale), ev('a', 3, 'start', T0), ev('a', 3, 'complete', T0 + 4 * MIN)],
			{ nowMs: T0 + 5 * MIN }
		);
		// New start pairs (4 min); the old one is abandoned and neither open nor averaged.
		expect(row(rows, 3, 'staff')).toMatchObject({
			visits: 1,
			timed_visits: 1,
			avg_duration_sec: 240,
			open_visits: 0
		});
	});

	it('treats a complete past the stale window as throughput only', () => {
		const rows = summarizeStationTimes(
			[ev('a', 2, 'start', T0), ev('a', 2, 'complete', T0 + STATION_LOG_STALE_WINDOW_MS + MIN)],
			{ nowMs: T0 + 4 * 60 * MIN }
		);
		expect(row(rows, 2, 'staff')).toMatchObject({
			visits: 1,
			timed_visits: 0,
			avg_duration_sec: null,
			open_visits: 0
		});
	});

	it('counts a complete without a start as throughput, not in the average', () => {
		const rows = summarizeStationTimes(
			[ev('a', 3, 'complete', T0), ev('b', 3, 'start', T0), ev('b', 3, 'complete', T0 + 2 * MIN)],
			{ nowMs: T0 + 10 * MIN }
		);
		expect(row(rows, 3, 'staff')).toMatchObject({
			visits: 2,
			timed_visits: 1,
			avg_duration_sec: 120
		});
	});

	it('does not let one complete close two starts', () => {
		const rows = summarizeStationTimes(
			[
				ev('a', 1, 'start', T0),
				ev('a', 1, 'start', T0 + 5 * MIN),
				ev('a', 1, 'complete', T0 + 6 * MIN)
			],
			{ nowMs: T0 + 60 * MIN }
		);
		// The first start is superseded (abandoned); the complete pairs with the second.
		expect(row(rows, 1, 'staff')).toMatchObject({
			visits: 1,
			timed_visits: 1,
			avg_duration_sec: 60,
			open_visits: 0
		});
	});

	it('pairs a complete that crosses midnight and anchors it on the start date', () => {
		// 23:55 Asia/Bangkok on 25 Oct → complete at 00:03 on 26 Oct.
		const start = Date.parse('2026-10-25T16:55:00.000Z');
		const events = [ev('a', 1, 'start', start), ev('a', 1, 'complete', start + 8 * MIN)];
		const day25 = summarizeStationTimes(events, {
			nowMs: start + 60 * MIN,
			from: '2026-10-25',
			to: '2026-10-25'
		});
		expect(row(day25, 1, 'staff')).toMatchObject({
			visits: 1,
			timed_visits: 1,
			avg_duration_sec: 480
		});
		const day26 = summarizeStationTimes(events, {
			nowMs: start + 60 * MIN,
			from: '2026-10-26',
			to: '2026-10-26'
		});
		expect(row(day26, 1, 'staff')).toMatchObject({ visits: 0, timed_visits: 0 });
	});

	it('keeps the start channel for a visit and ignores the complete channel', () => {
		const rows = summarizeStationTimes(
			[ev('a', 1, 'start', T0, 'kiosk'), ev('a', 1, 'complete', T0 + MIN, 'staff')],
			{ nowMs: T0 + 10 * MIN }
		);
		expect(row(rows, 1, 'kiosk')).toMatchObject({
			visits: 1,
			timed_visits: 1,
			avg_duration_sec: 60
		});
		expect(row(rows, 1, 'staff').visits).toBe(0);
	});

	it('pairs per evacuee and station independently', () => {
		const rows = summarizeStationTimes(
			[
				ev('a', 1, 'start', T0),
				ev('b', 1, 'complete', T0 + MIN), // other evacuee: must not close a's start
				ev('a', 2, 'complete', T0 + 2 * MIN) // other station: must not close a's S1 start
			],
			{ nowMs: T0 + 10 * MIN }
		);
		expect(row(rows, 1, 'staff')).toMatchObject({ visits: 1, timed_visits: 0, open_visits: 1 });
		expect(row(rows, 2, 'staff')).toMatchObject({ visits: 1, timed_visits: 0 });
	});

	it('pairs a zero-length visit when start and complete share a timestamp', () => {
		const rows = summarizeStationTimes(
			[ev('a', 1, 'complete', T0, 'kiosk'), ev('a', 1, 'start', T0, 'kiosk')],
			{ nowMs: T0 + MIN }
		);
		expect(row(rows, 1, 'kiosk')).toMatchObject({
			visits: 1,
			timed_visits: 1,
			avg_duration_sec: 0
		});
	});

	it('ignores events with an unparseable timestamp', () => {
		const rows = summarizeStationTimes(
			[{ evacuee_id: 'a', station: 1, channel: 'staff', action: 'start', occurred_at: 'nope' }],
			{ nowMs: T0 }
		);
		expect(row(rows, 1, 'staff').open_visits).toBe(0);
	});
});

describe('summarizeStationTimes pairing edge cases (CR-192 FR-STL-22)', () => {
	const STALE = STATION_LOG_STALE_WINDOW_MS;

	it('pairs a complete exactly at the stale-window boundary', () => {
		const rows = summarizeStationTimes(
			[ev('a', 1, 'start', T0), ev('a', 1, 'complete', T0 + STALE)],
			{
				nowMs: T0 + STALE + MIN
			}
		);
		expect(row(rows, 1, 'staff')).toMatchObject({
			visits: 1,
			timed_visits: 1,
			avg_duration_sec: STALE / 1000,
			open_visits: 0
		});
	});

	it('does not pair a complete one millisecond past the stale window', () => {
		const rows = summarizeStationTimes(
			[ev('a', 1, 'start', T0), ev('a', 1, 'complete', T0 + STALE + 1)],
			{ nowMs: T0 + 3 * STALE }
		);
		// The start is abandoned; the late complete is throughput only.
		expect(row(rows, 1, 'staff')).toMatchObject({
			visits: 1,
			timed_visits: 0,
			avg_duration_sec: null,
			open_visits: 0
		});
	});

	it('counts a second complete after one start as throughput, not a second timed visit', () => {
		const rows = summarizeStationTimes(
			[
				ev('a', 2, 'start', T0),
				ev('a', 2, 'complete', T0 + MIN),
				ev('a', 2, 'complete', T0 + 2 * MIN)
			],
			{ nowMs: T0 + 10 * MIN }
		);
		expect(row(rows, 2, 'staff')).toMatchObject({
			visits: 2,
			timed_visits: 1,
			avg_duration_sec: 60,
			open_visits: 0
		});
	});

	it('treats a complete before its start as throughput and leaves the later start open', () => {
		const rows = summarizeStationTimes(
			[ev('a', 3, 'complete', T0 - MIN), ev('a', 3, 'start', T0)],
			{
				nowMs: T0 + 10 * MIN
			}
		);
		expect(row(rows, 3, 'staff')).toMatchObject({
			visits: 1,
			timed_visits: 0,
			avg_duration_sec: null,
			open_visits: 1
		});
	});

	it('counts a start open exactly at the stale window and drops it one millisecond later', () => {
		const atEdge = summarizeStationTimes([ev('a', 1, 'start', T0)], { nowMs: T0 + STALE });
		expect(row(atEdge, 1, 'staff').open_visits).toBe(1);
		const past = summarizeStationTimes([ev('a', 1, 'start', T0)], { nowMs: T0 + STALE + 1 });
		expect(row(past, 1, 'staff').open_visits).toBe(0);
	});

	it('keeps only the latest unresolved start open when two starts have no complete', () => {
		const rows = summarizeStationTimes(
			[ev('a', 1, 'start', T0), ev('a', 1, 'start', T0 + 20 * MIN)],
			{ nowMs: T0 + 30 * MIN }
		);
		// The earlier start was superseded by a later start: abandoned, not a second open visit.
		expect(row(rows, 1, 'staff')).toMatchObject({ visits: 0, open_visits: 1 });
	});
});

describe('hasOpenStationStart edge cases (FR-STL-13)', () => {
	it('treats a complete at the same instant as the start as closing it', () => {
		const at = new Date(T0).toISOString();
		expect(
			hasOpenStationStart(
				[
					{ action: 'start', occurred_at: at },
					{ action: 'complete', occurred_at: at }
				],
				T0
			)
		).toBe(false);
	});
});

describe('rankStationActors (CR-192 Amendment 2)', () => {
	const by = (e: StationLogEvent, actor: string): StationLogEvent => ({ ...e, actor });
	const opts = { nowMs: T0 + 60 * MIN };

	it('averages the visits an actor both started and completed, per station', () => {
		const events = [
			by(ev('a', 2, 'start', T0), 'staff01'),
			by(ev('a', 2, 'complete', T0 + 4 * MIN), 'staff01'),
			by(ev('b', 2, 'start', T0), 'staff01'),
			by(ev('b', 2, 'complete', T0 + 8 * MIN), 'staff01'),
			by(ev('a', 3, 'start', T0 + 10 * MIN), 'staff01'),
			by(ev('a', 3, 'complete', T0 + 12 * MIN), 'staff01')
		];
		expect(rankStationActors(events, opts)).toEqual(
			expect.arrayContaining([
				{ station: 2, actor_id: 'staff01', kind: 'staff', timed_visits: 2, avg_duration_sec: 360 },
				{ station: 3, actor_id: 'staff01', kind: 'staff', timed_visits: 1, avg_duration_sec: 120 }
			])
		);
	});

	it('leaves out hand-offs, start-less completes and open visits', () => {
		const events = [
			by(ev('a', 2, 'start', T0), 'staff01'),
			by(ev('a', 2, 'complete', T0 + 4 * MIN), 'staff02'),
			by(ev('b', 3, 'complete', T0 + 5 * MIN), 'staff01'),
			by(ev('c', 2, 'start', T0 + 30 * MIN), 'staff01')
		];
		expect(rankStationActors(events, opts)).toEqual([]);
		// The hand-off still counts as a station visit.
		expect(row(summarizeStationTimes(events, opts), 2, 'staff').timed_visits).toBe(1);
	});

	it('ranks each kiosk device as its own actor', () => {
		const events = [
			by(ev('a', 1, 'start', T0, 'kiosk'), 'KIOSK-01'),
			by(ev('a', 1, 'complete', T0 + MIN, 'kiosk'), 'KIOSK-01'),
			by(ev('b', 1, 'start', T0, 'kiosk'), 'KIOSK-02'),
			by(ev('b', 1, 'complete', T0 + 3 * MIN, 'kiosk'), 'KIOSK-02')
		];
		const ids = rankStationActors(events, opts).map((r) => [r.actor_id, r.kind]);
		expect(ids).toEqual(
			expect.arrayContaining([
				['KIOSK-01', 'kiosk'],
				['KIOSK-02', 'kiosk']
			])
		);
	});

	it('ignores events with no actor and visits that started outside the range', () => {
		const events = [
			ev('a', 2, 'start', T0),
			ev('a', 2, 'complete', T0 + MIN),
			by(ev('b', 2, 'start', T0 - 24 * 60 * MIN), 'staff01'),
			by(ev('b', 2, 'complete', T0 - 24 * 60 * MIN + MIN), 'staff01')
		];
		expect(rankStationActors(events, { ...opts, from: '2026-10-25', to: '2026-10-25' })).toEqual(
			[]
		);
	});
});

describe('compareStationActorRank', () => {
	it('orders fastest first, then more visits, then name', () => {
		const rows = [
			{ display_name: 'ข', avg_duration_sec: 120, timed_visits: 3 },
			{ display_name: 'ก', avg_duration_sec: 120, timed_visits: 3 },
			{ display_name: 'ค', avg_duration_sec: 120, timed_visits: 9 },
			{ display_name: 'ง', avg_duration_sec: 60, timed_visits: 1 }
		];
		expect(rows.sort(compareStationActorRank).map((r) => r.display_name)).toEqual([
			'ง',
			'ค',
			'ก',
			'ข'
		]);
	});
});
