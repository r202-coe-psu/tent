import { describe, it, expect } from 'vitest';
import { toZoneOccupancies, ZoneOccupancyPayloadSchema } from './zone-occupancy.schema';

const zone = (
	code: string,
	capacity: number,
	status: 'active' | 'closed' = 'active',
	name = `โซน ${code}`
) => ({ code, name, capacity, status });

describe('toZoneOccupancies (CR-226)', () => {
	it('counts only Present statuses: active, room_confirmed, temporary_leave', () => {
		const rows = [
			{ zone: 'A', status: 'active', count: 2 },
			{ zone: 'A', status: 'room_confirmed', count: 3 },
			{ zone: 'A', status: 'temporary_leave', count: 1 },
			{ zone: 'A', status: 'pre_registered', count: 4 },
			{ zone: 'A', status: 'checked_out', count: 9 },
			{ zone: 'A', status: 'transferred', count: 9 }
		];
		const [a] = toZoneOccupancies(rows, [zone('A', 100)]);
		expect(a.count).toBe(6);
	});

	it('returns one entry per zone in zones[] order, with zero for empty zones', () => {
		const result = toZoneOccupancies(
			[{ zone: 'B', status: 'active', count: 1 }],
			[zone('A', 10), zone('B', 10)]
		);
		expect(result.map((z) => [z.code, z.count])).toEqual([
			['A', 0],
			['B', 1]
		]);
		expect(result[0]).toMatchObject({ name: 'โซน A', capacity: 10, percent: 0, level: 'normal' });
	});

	it('drops rows whose zone is not in zones[]', () => {
		const result = toZoneOccupancies(
			[{ zone: 'GHOST', status: 'active', count: 5 }],
			[zone('A', 10)]
		);
		expect(result).toHaveLength(1);
		expect(result[0].count).toBe(0);
	});

	it('uses warning at 80% and full at 100% of capacity', () => {
		const at = (count: number) =>
			toZoneOccupancies([{ zone: 'A', status: 'active', count }], [zone('A', 10)])[0];
		expect(at(7).level).toBe('normal');
		expect(at(8).level).toBe('warning');
		expect(at(9).level).toBe('warning');
		expect(at(10).level).toBe('full');
	});

	it('does not clamp percent when a zone is over capacity', () => {
		const [a] = toZoneOccupancies([{ zone: 'A', status: 'active', count: 12 }], [zone('A', 10)]);
		expect(a.percent).toBe(120);
		expect(a.level).toBe('full');
	});

	it('rounds percent', () => {
		const [a] = toZoneOccupancies([{ zone: 'A', status: 'active', count: 1 }], [zone('A', 3)]);
		expect(a.percent).toBe(33);
	});

	it('falls back to percent 0 and level full when capacity <= 0', () => {
		const [a] = toZoneOccupancies([], [zone('A', 0)]);
		expect(a).toMatchObject({ percent: 0, level: 'full' });
	});

	it('marks closed zones', () => {
		const result = toZoneOccupancies([], [zone('A', 10, 'closed'), zone('B', 10)]);
		expect(result.map((z) => z.closed)).toEqual([true, false]);
	});
});

describe('ZoneOccupancyPayloadSchema', () => {
	it('accepts aggregate rows only', () => {
		const parsed = ZoneOccupancyPayloadSchema.parse({
			shelter_code: 'SH001',
			rows: [{ zone: 'A', status: 'active', count: 2, _id: 'evacuee:x' }]
		});
		expect(parsed.rows[0]).toEqual({ zone: 'A', status: 'active', count: 2 });
	});
});
