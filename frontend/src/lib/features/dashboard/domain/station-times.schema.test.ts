import { describe, expect, it } from 'vitest';
import {
	StationTimesPayloadSchema,
	StationTimesQuerySchema,
	formatServiceDuration,
	stationAverageSec,
	type StationTimeRow
} from './station-times.schema';

const row = (over: Partial<StationTimeRow>): StationTimeRow => ({
	station: 1,
	channel: 'staff',
	visits: 0,
	timed_visits: 0,
	avg_duration_sec: null,
	open_visits: 0,
	...over
});

describe('StationTimesQuerySchema', () => {
	it('accepts an optional range and rejects from after to', () => {
		expect(StationTimesQuerySchema.safeParse({}).success).toBe(true);
		expect(
			StationTimesQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-25' }).success
		).toBe(true);
		expect(
			StationTimesQuerySchema.safeParse({ from: '2026-10-26', to: '2026-10-25' }).success
		).toBe(false);
		expect(StationTimesQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
	});
});

describe('StationTimesPayloadSchema', () => {
	it('parses a payload and rejects an unknown station or channel', () => {
		const base = {
			shelter_code: 'SH001',
			range: { from: '2026-10-01', to: '2026-10-25' },
			stations: [row({ visits: 2, timed_visits: 2, avg_duration_sec: 61.5 })],
			actors: [
				{
					station: 1,
					actor_id: 'staff01',
					kind: 'staff',
					display_name: 'สมชาย',
					timed_visits: 2,
					avg_duration_sec: 61.5
				}
			]
		};
		expect(StationTimesPayloadSchema.safeParse(base).success).toBe(true);
		expect(StationTimesPayloadSchema.safeParse({ ...base, actors: undefined }).success).toBe(false);
		expect(
			StationTimesPayloadSchema.safeParse({
				...base,
				stations: [{ ...base.stations[0], station: 4 }]
			}).success
		).toBe(false);
		expect(
			StationTimesPayloadSchema.safeParse({
				...base,
				stations: [{ ...base.stations[0], channel: 'web' }]
			}).success
		).toBe(false);
	});
});

describe('stationAverageSec', () => {
	it('weights each channel by its timed visits', () => {
		const rows = [
			row({ station: 1, channel: 'staff', timed_visits: 3, avg_duration_sec: 400 }),
			row({ station: 1, channel: 'kiosk', timed_visits: 1, avg_duration_sec: 60 }),
			row({ station: 2, timed_visits: 1, avg_duration_sec: 100 })
		];
		expect(stationAverageSec(rows, 1)).toBe(315);
		expect(stationAverageSec(rows, 2)).toBe(100);
	});

	it('is null when nothing was timed', () => {
		expect(stationAverageSec([row({ visits: 4 })], 1)).toBeNull();
		expect(stationAverageSec([], 3)).toBeNull();
	});
});

describe('formatServiceDuration', () => {
	it('formats seconds, minutes and unknown', () => {
		expect(formatServiceDuration(null)).toBe('—');
		expect(formatServiceDuration(0)).toBe('0 วินาที');
		expect(formatServiceDuration(44.6)).toBe('45 วินาที');
		expect(formatServiceDuration(120)).toBe('2 นาที');
		expect(formatServiceDuration(390)).toBe('6 นาที 30 วินาที');
	});
});
