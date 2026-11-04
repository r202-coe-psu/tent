import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { readPublicAccessStatus } from '$lib/features/volunteers/server/public-access-status';
import { PublicScheduleError } from '$lib/features/volunteers/server/public-schedule-action';

type Handler = (event: { request: { json: () => Promise<unknown> } }) => Promise<Response>;

const accessStatus = POST as unknown as Handler;

vi.mock('$lib/features/volunteers/server/public-schedule-action', () => ({
	PublicScheduleError: class extends Error {
		constructor(
			readonly code: string,
			readonly httpStatus = 409
		) {
			super(code);
		}
	}
}));
vi.mock('$lib/features/volunteers/server/public-access-status', () => ({
	readPublicAccessStatus: vi.fn(async () => ({ success: true, access: [] }))
}));

const MINTED = 'TKT-VOL-0123456789ABCDEF0123456789ABCDEF';

const call = (json: () => Promise<unknown>) => accessStatus({ request: { json } });

describe('POST /api/public/v1/volunteer/access-status', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('answers a body that is not JSON with 422', async () => {
		const result = await call(() => Promise.reject(new SyntaxError('Unexpected token')));

		expect(result.status).toBe(422);
		expect(await result.json()).toEqual({ success: false, error: 'INVALID_INPUT' });
		expect(readPublicAccessStatus).not.toHaveBeenCalled();
	});

	it.each([
		['an empty object', {}],
		['a phone that is not a Thai mobile', { phone: '12345' }],
		['a token that is too short', { token: 'abc' }]
	])('rejects %s with 422 and reads nothing', async (_label, body) => {
		const result = await call(() => Promise.resolve(body));

		expect(result.status).toBe(422);
		expect(readPublicAccessStatus).not.toHaveBeenCalled();
	});

	it('reads the status for a phone, never cached', async () => {
		const result = await call(() => Promise.resolve({ phone: '0812345678' }));

		expect(result.status).toBe(200);
		expect(result.headers.get('Cache-Control')).toBe('no-store');
		expect(readPublicAccessStatus).toHaveBeenCalledWith({ phone: '0812345678' });
	});

	it('reads the status for a minted ticket token', async () => {
		const result = await call(() => Promise.resolve({ token: MINTED }));

		expect(result.status).toBe(200);
		expect(readPublicAccessStatus).toHaveBeenCalledWith({ token: MINTED });
	});

	it('passes a typed failure through with its own status', async () => {
		vi.mocked(readPublicAccessStatus).mockRejectedValueOnce(
			new PublicScheduleError('ACCESS_STATUS_UNAVAILABLE', 503)
		);
		const result = await call(() => Promise.resolve({ token: MINTED }));

		expect(result.status).toBe(503);
		expect(await result.json()).toEqual({ success: false, error: 'ACCESS_STATUS_UNAVAILABLE' });
	});

	it('answers an unexpected failure with 503 and no detail', async () => {
		vi.mocked(readPublicAccessStatus).mockRejectedValueOnce(new Error('couch said: secret@x.org'));
		const result = await call(() => Promise.resolve({ token: MINTED }));

		expect(result.status).toBe(503);
		expect(await result.json()).toEqual({ success: false, error: 'ACCESS_STATUS_UNAVAILABLE' });
	});
});
