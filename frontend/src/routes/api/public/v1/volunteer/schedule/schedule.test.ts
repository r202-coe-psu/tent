import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { readPublicVolunteerSchedule } from '$lib/features/volunteers/server/public-schedule-action';

type Handler = (event: {
	request: { json: () => Promise<unknown> };
	getClientAddress: () => string;
}) => Promise<Response>;

const schedule = POST as unknown as Handler;

vi.mock('$lib/features/volunteers/server/public-schedule-action', () => ({
	PublicScheduleError: class extends Error {},
	readPublicVolunteerSchedule: vi.fn(async () => ({ success: true, shifts: [] }))
}));

const MINTED = 'TKT-VOL-0123456789ABCDEF0123456789ABCDEF';

const call = (json: () => Promise<unknown>) =>
	schedule({ request: { json }, getClientAddress: () => '203.0.113.7' });

describe('POST /api/public/v1/volunteer/schedule — input', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('answers a body that is not JSON with 422', async () => {
		const result = await call(() => Promise.reject(new SyntaxError('Unexpected token')));

		expect(result.status).toBe(422);
		expect(await result.json()).toEqual({ success: false, error: 'INVALID_INPUT' });
		expect(readPublicVolunteerSchedule).not.toHaveBeenCalled();
	});

	it('reads the schedule for a minted token', async () => {
		const result = await call(() => Promise.resolve({ token: MINTED }));

		expect(result.status).toBe(200);
		expect(readPublicVolunteerSchedule).toHaveBeenCalledTimes(1);
	});
});
