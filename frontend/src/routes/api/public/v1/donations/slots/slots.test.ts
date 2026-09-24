import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { adminRaw } from '$lib/server/couch-admin';

type GetEvent = Parameters<typeof GET>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn()
}));

function event(query: string): GetEvent {
	return { url: new URL(`http://localhost/api/public/v1/donations/slots${query}`) } as GetEvent;
}

function rows(docs: unknown[]) {
	return Promise.resolve({ status: 200, data: { rows: docs.map((doc) => ({ doc })) } });
}

describe('GET /api/public/v1/donations/slots', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('returns the configured windows of one queue with their remaining capacity', async () => {
		vi.mocked(adminRaw).mockImplementation((path: string) => {
			if (path.includes('donation_slot')) {
				return rows([
					{
						_id: 'donation_slot:pickup:2026-09-22:09:00',
						type: 'donation_slot',
						mode: 'pickup',
						date: '2026-09-22',
						from: '09:00',
						to: '10:00',
						capacity: 1,
						status: 'open'
					},
					{
						_id: 'donation_slot:pickup:2026-09-22:13:00',
						type: 'donation_slot',
						mode: 'pickup',
						date: '2026-09-22',
						from: '13:00',
						to: '14:00',
						capacity: 2,
						status: 'open'
					},
					// Same hour, other queue — must not show up in the pickup board.
					{
						_id: 'donation_slot:dropoff:2026-09-22:09:00',
						type: 'donation_slot',
						mode: 'dropoff',
						date: '2026-09-22',
						from: '09:00',
						to: '10:00',
						capacity: null,
						status: 'open'
					}
				]);
			}
			return rows([
				{
					_id: 'donation:d1',
					type: 'donation',
					status: 'pending_review',
					logistics: { slot: { date: '2026-09-22', from: '09:00', to: '10:00' } }
				}
			]);
		});

		const res = await GET(event('?shelter_code=sh001&date=2026-09-22&mode=pickup'));
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.slots).toEqual([
			{
				label: '09:00 - 10:00',
				from: '09:00',
				to: '10:00',
				capacity: 1,
				booked: 1,
				status: 'full'
			},
			{
				label: '13:00 - 14:00',
				from: '13:00',
				to: '14:00',
				capacity: 2,
				booked: 0,
				status: 'available'
			}
		]);
	});

	it('offers the default drop-off windows when the shelter configured no slot', async () => {
		vi.mocked(adminRaw).mockImplementation(() => rows([]));

		const res = await GET(event('?shelter_code=SH002&date=2026-09-22'));
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.mode).toBe('dropoff');
		expect(body.slots.every((s: { status: string }) => s.status === 'available')).toBe(true);
	});

	it('offers nothing for pickup when no vehicle schedule is published', async () => {
		vi.mocked(adminRaw).mockImplementation(() => rows([]));

		const res = await GET(event('?shelter_code=SH002&date=2026-09-22&mode=pickup'));
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.slots).toEqual([]);
	});

	it('rejects a malformed shelter code or date before touching CouchDB', async () => {
		const bad = await GET(event('?shelter_code=../_users&date=2026-09-22'));
		expect(bad.status).toBe(422);

		const badDate = await GET(event('?shelter_code=SH001&date=22-09-2026'));
		expect(badDate.status).toBe(422);

		const badMode = await GET(event('?shelter_code=SH001&date=2026-09-22&mode=truck'));
		expect(badMode.status).toBe(422);

		expect(adminRaw).not.toHaveBeenCalled();
	});
});
