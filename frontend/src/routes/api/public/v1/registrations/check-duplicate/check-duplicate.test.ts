import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { registerLookupIpLimiter } from '$lib/server/security/rate-limiter';
import { listShelterMasters } from '$lib/server/shelters.admin';
import { findConflictingHold } from '$lib/features/public-register/booking-gate.server';
import { unassignedRegistrationRemote } from '$lib/features/unassigned-registration';
import type { ShelterMaster } from '$lib/features/shelters/server';

type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/shelters.admin', () => ({
	listShelterMasters: vi.fn()
}));

vi.mock('$lib/features/public-register/booking-gate.server', () => ({
	findConflictingHold: vi.fn()
}));

vi.mock('$lib/features/unassigned-registration', () => ({
	unassignedRegistrationRemote: {
		searchOpen: vi.fn()
	}
}));

vi.mock('$lib/server/security/rate-limiter', () => ({
	registerLookupIpLimiter: { check: vi.fn(() => true) }
}));

function event(body: unknown, ip = '203.0.113.10'): PostEvent {
	return {
		request: new Request('http://localhost/api/public/v1/registrations/check-duplicate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		getClientAddress: () => ip
	} as unknown as PostEvent;
}

describe('POST /api/public/v1/registrations/check-duplicate', () => {
	beforeEach(() => {
		vi.mocked(listShelterMasters).mockReset();
		vi.mocked(findConflictingHold).mockReset();
		vi.mocked(unassignedRegistrationRemote.searchOpen).mockReset();
		vi.mocked(registerLookupIpLimiter.check).mockReturnValue(true);

		vi.mocked(listShelterMasters).mockResolvedValue([
			{ code: 'SH001', name: 'Shelter 1' } as unknown as ShelterMaster
		]);
		vi.mocked(findConflictingHold).mockResolvedValue(null);
		vi.mocked(unassignedRegistrationRemote.searchOpen).mockResolvedValue({
			results: []
		});
	});

	it('returns 429 when rate limited', async () => {
		vi.mocked(registerLookupIpLimiter.check).mockReturnValue(false);
		const res = await POST(event({ national_id: '1234567890123' }));
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body.error).toBe('RATE_LIMITED');
	});

	it('returns 422 when neither national_id nor phone is provided', async () => {
		const res = await POST(event({}));
		expect(res.status).toBe(422);
	});

	it('returns duplicate: false when no conflict exists', async () => {
		const res = await POST(event({ national_id: '1234567890123' }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ success: true, duplicate: false, field: null });
	});

	it('detects duplicate national_id in shelter active holds', async () => {
		vi.mocked(findConflictingHold).mockResolvedValue({
			current_stay: { status: 'admitted' },
			person_id: { number: '1234567890123' }
		});

		const res = await POST(event({ national_id: '1-2345-67890-12-3' }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.duplicate).toBe(true);
		expect(body.field).toBe('national_id');
		// Must NEVER leak PII
		expect(body.name).toBeUndefined();
		expect(body.evacuee).toBeUndefined();
	});

	it('detects duplicate phone in shelter active holds', async () => {
		vi.mocked(findConflictingHold).mockResolvedValue({
			current_stay: { status: 'pre_registered' },
			phone: '0812345678'
		});

		const res = await POST(event({ phone: '081-234-5678' }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.duplicate).toBe(true);
		expect(body.field).toBe('phone');
		expect(body.name).toBeUndefined();
	});

	it('detects duplicate in central unassigned pool', async () => {
		vi.mocked(unassignedRegistrationRemote.searchOpen).mockResolvedValue({
			results: [
				{
					id: 'ticket-1',
					code: 'T-100',
					status: 'open',
					created_at: '2026-10-09T00:00:00Z',
					open_members: []
				} as unknown as Awaited<
					ReturnType<typeof unassignedRegistrationRemote.searchOpen>
				>['results'][number]
			]
		});

		const res = await POST(event({ national_id: '1234567890123' }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.duplicate).toBe(true);
		expect(body.field).toBe('national_id');
	});
});
