import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from './+server';
import { requireShelterScopeOrSA, adminRaw, ServiceError } from '$lib/server/couch-admin';
import { SHELTER_VIEW_MANIFEST } from '$lib/features/shelters/server';
import { findMasterByCode } from '$lib/server/shelters.admin';
import { getDisplayNames } from '$lib/server/user-service';
import type { ShelterMaster } from '$lib/features/shelters';
import type { RequestEvent } from './$types';

vi.mock('$lib/server/couch-admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/couch-admin')>();
	return {
		...actual,
		requireShelterScopeOrSA: vi.fn(),
		adminRaw: vi.fn()
	};
});

vi.mock('$lib/server/shelters.admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/shelters.admin')>();
	return { ...actual, findMasterByCode: vi.fn() };
});

vi.mock('$lib/server/user-service', () => ({ getDisplayNames: vi.fn() }));

function createMockEvent(
	code: string,
	searchParams: Record<string, string> = {},
	cookie: string | null = 'test_cookie'
): RequestEvent {
	const url = new URL('http://localhost/api');
	for (const [k, v] of Object.entries(searchParams)) {
		url.searchParams.set(k, v);
	}
	return {
		params: { code },
		request: {
			headers: {
				get: (key: string) => (key.toLowerCase() === 'cookie' ? cookie : null)
			}
		},
		url
	} as unknown as RequestEvent;
}

const SA = { name: 'tester', roles: [], isSA: true, shelterCode: null };
const viewDeployed = {
	status: 200,
	data: { tent_view: { version: SHELTER_VIEW_MANIFEST.version } }
};

/** A view row as emitted by `station_logs_by_station`. */
function logRow(
	evacuee: string,
	station: number,
	channel: 'kiosk' | 'staff',
	action: 'start' | 'complete',
	occurredAt: string,
	actor: string | null = null
) {
	const date = new Date(Date.parse(occurredAt) + 7 * 3600 * 1000).toISOString().slice(0, 10);
	return {
		key: [date, station, channel, evacuee],
		value: { action, occurred_at: occurredAt, actor }
	};
}

describe('GET /api/back-office/shelter/[code]/dashboard/station-times', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		// 2026-10-25 12:00 Asia/Bangkok — decides open vs abandoned starts.
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-10-25T05:00:00.000Z'));
		vi.mocked(getDisplayNames).mockResolvedValue(new Map());
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns 403 when requireShelterScopeOrSA throws', async () => {
		vi.mocked(requireShelterScopeOrSA).mockRejectedValue(
			new ServiceError('FORBIDDEN', 'Access denied')
		);

		const res = (await GET(createMockEvent('SH001'))) as Response;

		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe('FORBIDDEN');
	});

	it('returns 500 when the deployed view version is older than this build expects', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(SA);
		vi.mocked(adminRaw).mockResolvedValue({
			status: 200,
			data: { tent_view: { version: SHELTER_VIEW_MANIFEST.version - 1 } }
		});

		const res = (await GET(createMockEvent('SH001'))) as Response;

		expect(res.status).toBe(500);
		expect((await res.json()).error.message).toContain('older version');
	});

	it('returns 500 when the station_logs_by_station view is not deployed', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(SA);
		vi.mocked(adminRaw)
			.mockResolvedValueOnce(viewDeployed)
			.mockResolvedValueOnce({ status: 404, data: null });

		const res = (await GET(createMockEvent('SH001', { from: '2026-10-25' }))) as Response;

		expect(res.status).toBe(500);
		expect((await res.json()).error.message).toContain('not deployed');
	});

	it('returns 500 on a CouchDB view error', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(SA);
		vi.mocked(adminRaw)
			.mockResolvedValueOnce(viewDeployed)
			.mockResolvedValueOnce({ status: 500, data: { reason: 'db error' } });

		const res = (await GET(createMockEvent('SH001', { from: '2026-10-25' }))) as Response;

		expect(res.status).toBe(500);
		expect((await res.json()).error.message).toContain('station_logs_by_station view error');
	});

	it('returns 422 when `from` is after `to`', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(SA);

		const res = (await GET(
			createMockEvent('SH001', { from: '2026-10-26', to: '2026-10-25' })
		)) as Response;

		expect(res.status).toBe(422);
		expect((await res.json()).error.code).toBe('VALIDATION');
	});

	it('returns 422 for a malformed `from` or `to` without touching CouchDB', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(SA);

		const malformed: Record<string, string>[] = [
			{ from: '25/10/2026' },
			{ to: '2026-10-25T00:00:00Z' }
		];
		for (const query of malformed) {
			const res = (await GET(createMockEvent('SH001', query))) as Response;
			expect(res.status).toBe(422);
			expect((await res.json()).error.code).toBe('VALIDATION');
		}
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('summarises a fixture of normal, open, abandoned, start-less and midnight visits by channel', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(SA);
		vi.mocked(adminRaw)
			.mockResolvedValueOnce(viewDeployed)
			.mockResolvedValueOnce({
				status: 200,
				data: {
					rows: [
						// Midnight visit: starts 23:55 on 24 Oct (+07), completes 00:03 on 25 Oct.
						logRow('m1', 1, 'staff', 'start', '2026-10-24T16:55:00.000Z'),
						logRow('m1', 1, 'staff', 'complete', '2026-10-24T17:03:00.000Z'),
						// Normal staff visits on 25 Oct: 6 min and 8 min.
						logRow('a', 1, 'staff', 'start', '2026-10-25T01:00:00.000Z'),
						logRow('a', 1, 'staff', 'complete', '2026-10-25T01:06:00.000Z'),
						logRow('b', 1, 'staff', 'start', '2026-10-25T01:10:00.000Z'),
						logRow('b', 1, 'staff', 'complete', '2026-10-25T01:18:00.000Z'),
						// Kiosk visit: 1 min.
						logRow('k', 1, 'kiosk', 'start', '2026-10-25T02:00:00.000Z'),
						logRow('k', 1, 'kiosk', 'complete', '2026-10-25T02:01:00.000Z'),
						// Open start (30 min old) and abandoned start (4 h old) at station 2.
						logRow('o', 2, 'staff', 'start', '2026-10-25T04:30:00.000Z'),
						logRow('x', 2, 'staff', 'start', '2026-10-25T01:00:00.000Z'),
						// Station 3: complete with no start (bulk zoning) + one timed visit of 2 min.
						logRow('z1', 3, 'staff', 'complete', '2026-10-25T03:00:00.000Z'),
						logRow('z2', 3, 'staff', 'start', '2026-10-25T03:10:00.000Z'),
						logRow('z2', 3, 'staff', 'complete', '2026-10-25T03:12:00.000Z')
					]
				}
			});

		const res = (await GET(
			createMockEvent('SH001', { from: '2026-10-25', to: '2026-10-25' })
		)) as Response;

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.shelter_code).toBe('SH001');
		expect(data.range).toEqual({ from: '2026-10-25', to: '2026-10-25' });

		const find = (station: number, channel: string) =>
			data.stations.find(
				(r: { station: number; channel: string }) => r.station === station && r.channel === channel
			);
		// The midnight visit started on 24 Oct, so it is outside the 25 Oct range.
		expect(find(1, 'staff')).toMatchObject({
			visits: 2,
			timed_visits: 2,
			avg_duration_sec: 420,
			open_visits: 0
		});
		expect(find(1, 'kiosk')).toMatchObject({ visits: 1, timed_visits: 1, avg_duration_sec: 60 });
		expect(find(2, 'staff')).toMatchObject({
			visits: 0,
			timed_visits: 0,
			avg_duration_sec: null,
			open_visits: 1
		});
		expect(find(3, 'staff')).toMatchObject({
			visits: 2,
			timed_visits: 1,
			avg_duration_sec: 120,
			open_visits: 0
		});
	});

	it('ranks actors per station by display name, fastest first (Amendment 2)', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(SA);
		vi.mocked(getDisplayNames).mockResolvedValue(new Map([['staff01', 'สมชาย ประจำการ']]));
		vi.mocked(adminRaw)
			.mockResolvedValueOnce(viewDeployed)
			.mockResolvedValueOnce({
				status: 200,
				data: {
					rows: [
						logRow('a', 1, 'staff', 'start', '2026-10-25T01:00:00.000Z', 'staff01'),
						logRow('a', 1, 'staff', 'complete', '2026-10-25T01:06:00.000Z', 'staff01'),
						logRow('b', 1, 'staff', 'start', '2026-10-25T01:00:00.000Z', 'staff02'),
						logRow('b', 1, 'staff', 'complete', '2026-10-25T01:03:00.000Z', 'staff02'),
						logRow('k', 1, 'kiosk', 'start', '2026-10-25T02:00:00.000Z', 'KIOSK-01'),
						logRow('k', 1, 'kiosk', 'complete', '2026-10-25T02:01:00.000Z', 'KIOSK-01'),
						// Hand-off at station 2: counts for the station, not for an actor.
						logRow('h', 2, 'staff', 'start', '2026-10-25T03:00:00.000Z', 'staff01'),
						logRow('h', 2, 'staff', 'complete', '2026-10-25T03:05:00.000Z', 'staff02')
					]
				}
			});

		const res = (await GET(
			createMockEvent('SH001', { from: '2026-10-25', to: '2026-10-25' })
		)) as Response;
		const data = await res.json();

		expect(res.status).toBe(200);
		expect(data.actors).toEqual([
			{
				station: 1,
				actor_id: 'KIOSK-01',
				kind: 'kiosk',
				display_name: 'ตู้ KIOSK-01',
				timed_visits: 1,
				avg_duration_sec: 60
			},
			{
				station: 1,
				actor_id: 'staff02',
				kind: 'staff',
				display_name: 'staff02',
				timed_visits: 1,
				avg_duration_sec: 180
			},
			{
				station: 1,
				actor_id: 'staff01',
				kind: 'staff',
				display_name: 'สมชาย ประจำการ',
				timed_visits: 1,
				avg_duration_sec: 360
			}
		]);
		expect(getDisplayNames).toHaveBeenCalledWith(expect.arrayContaining(['staff01', 'staff02']));
		expect(vi.mocked(getDisplayNames).mock.calls[0][0]).not.toContain('KIOSK-01');
		const s2 = data.stations.find((r: { station: number }) => r.station === 2);
		expect(s2.timed_visits).toBe(1);
	});

	it('pairs a complete that crosses midnight and counts the visit on the start date', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(SA);
		const rows = [
			logRow('m1', 1, 'staff', 'start', '2026-10-24T16:55:00.000Z'), // 23:55 on 24 Oct
			logRow('m1', 1, 'staff', 'complete', '2026-10-24T17:03:00.000Z') // 00:03 on 25 Oct
		];
		vi.mocked(adminRaw)
			.mockResolvedValueOnce(viewDeployed)
			.mockResolvedValueOnce({ status: 200, data: { rows } });

		const res = (await GET(
			createMockEvent('SH001', { from: '2026-10-24', to: '2026-10-24' })
		)) as Response;
		const data = await res.json();

		expect(data.stations[0]).toMatchObject({
			station: 1,
			channel: 'staff',
			visits: 1,
			timed_visits: 1,
			avg_duration_sec: 480
		});

		// Read window: one day before `from` and one day past `to`.
		const [path, method] = vi.mocked(adminRaw).mock.calls[1];
		expect(method).toBe('GET');
		expect(path).toContain('/shelter_sh001/_design/app/_view/station_logs_by_station?reduce=false');
		expect(decodeURIComponent(path)).toContain('startkey=["2026-10-23"]');
		expect(decodeURIComponent(path)).toContain('endkey=["2026-10-25￰","￰"]');
	});

	it('ignores view rows that do not have the emitted shape', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(SA);
		vi.mocked(adminRaw)
			.mockResolvedValueOnce(viewDeployed)
			.mockResolvedValueOnce({
				status: 200,
				data: {
					rows: [
						{ key: ['2026-10-25', 9, 'staff', 'e'], value: { action: 'start', occurred_at: 'x' } },
						{ key: ['2026-10-25', 1, 'web', 'e'], value: { action: 'start', occurred_at: 'x' } },
						{ key: '2026-10-25', value: 1 }
					]
				}
			});

		const res = (await GET(createMockEvent('SH001', { from: '2026-10-25' }))) as Response;

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.stations).toHaveLength(4);
		expect(data.stations.every((r: { visits: number }) => r.visits === 0)).toBe(true);
	});

	describe('without `from`', () => {
		beforeEach(() => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue(SA);
		});

		it('starts the range on the day the shelter was created and reads from the first key', async () => {
			vi.mocked(findMasterByCode).mockResolvedValue({
				created_at: '2026-10-20T05:00:00.000Z'
			} as ShelterMaster);
			vi.mocked(adminRaw)
				.mockResolvedValueOnce(viewDeployed)
				.mockResolvedValueOnce({ status: 200, data: { rows: [] } });

			const res = (await GET(createMockEvent('SH001', { to: '2026-10-25' }))) as Response;
			const data = await res.json();

			expect(data.range).toEqual({ from: '2026-10-20', to: '2026-10-25' });
			const [path] = vi.mocked(adminRaw).mock.calls[1];
			expect(path).not.toContain('startkey');
			expect(findMasterByCode).toHaveBeenCalledWith('SH001');
		});

		it('does not look the shelter up when `from` is given', async () => {
			vi.mocked(adminRaw)
				.mockResolvedValueOnce(viewDeployed)
				.mockResolvedValueOnce({ status: 200, data: { rows: [] } });

			await GET(createMockEvent('SH001', { from: '2026-10-01', to: '2026-10-16' }));

			expect(findMasterByCode).not.toHaveBeenCalled();
		});
	});
});
