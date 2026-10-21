import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import {
	volunteerTicketFindLimiter,
	volunteerTicketLimiter
} from '$lib/server/security/rate-limiter';
import { readPublicVolunteerSchedule } from '$lib/features/volunteers/server/public-schedule-action';

type Handler = (event: {
	request: { json: () => Promise<unknown> };
	getClientAddress: () => string;
}) => Promise<Response>;

const schedule = POST as unknown as Handler;

vi.mock('$lib/server/security/rate-limiter', () => ({
	volunteerTicketFindLimiter: { check: vi.fn(() => true) },
	volunteerTicketLimiter: { check: vi.fn(() => true) }
}));

vi.mock('$lib/features/volunteers/server/public-schedule-action', () => ({
	PublicScheduleError: class extends Error {},
	readPublicVolunteerSchedule: vi.fn(async () => ({ success: true, shifts: [] }))
}));

const MINTED = 'TKT-VOL-0123456789ABCDEF0123456789ABCDEF';

const call = (json: () => Promise<unknown>) =>
	schedule({ request: { json }, getClientAddress: () => '203.0.113.7' });

describe('POST /api/public/v1/volunteer/schedule — rate budget and input (CR-127 R-8/R-9)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(volunteerTicketFindLimiter.check).mockReturnValue(true);
		vi.mocked(volunteerTicketLimiter.check).mockReturnValue(true);
	});

	it('answers a body that is not JSON with 422, charged to the strict budget', async () => {
		const result = await call(() => Promise.reject(new SyntaxError('Unexpected token')));

		expect(result.status).toBe(422);
		expect(await result.json()).toEqual({ success: false, error: 'INVALID_INPUT' });
		expect(volunteerTicketFindLimiter.check).toHaveBeenCalledWith('203.0.113.7');
		expect(volunteerTicketLimiter.check).not.toHaveBeenCalled();
		expect(readPublicVolunteerSchedule).not.toHaveBeenCalled();
	});

	it('charges a minted token to the token budget', async () => {
		const result = await call(() => Promise.resolve({ token: MINTED }));

		expect(result.status).toBe(200);
		expect(volunteerTicketLimiter.check).toHaveBeenCalledWith('203.0.113.7');
		expect(volunteerTicketFindLimiter.check).not.toHaveBeenCalled();
	});

	it('keeps a phone on the strict budget even when a minted token rides along', async () => {
		await call(() => Promise.resolve({ phone: '0812345678', token: MINTED }));

		expect(volunteerTicketFindLimiter.check).toHaveBeenCalledWith('203.0.113.7');
		expect(volunteerTicketLimiter.check).not.toHaveBeenCalled();
	});

	it('refuses before reading the schedule once the budget is spent', async () => {
		vi.mocked(volunteerTicketFindLimiter.check).mockReturnValue(false);
		const result = await call(() => Promise.resolve({ phone: '0812345678' }));

		expect(result.status).toBe(429);
		expect(readPublicVolunteerSchedule).not.toHaveBeenCalled();
	});
});
