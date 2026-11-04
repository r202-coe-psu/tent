import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRequestEvent } from '$app/server';
import { fastapiServiceHeaders } from './fastapi';

vi.mock('$env/dynamic/private', () => ({
	env: { EXTERNAL_API_SECRET: 'test-external-secret' }
}));

vi.mock('$app/server', () => ({
	getRequestEvent: vi.fn()
}));

type RequestEvent = ReturnType<typeof getRequestEvent>;

describe('fastapiServiceHeaders', () => {
	beforeEach(() => {
		vi.mocked(getRequestEvent).mockReset();
	});

	it('forwards the browser IP so FastAPI rate-limits per user, not per BFF', () => {
		vi.mocked(getRequestEvent).mockReturnValue({
			getClientAddress: () => '203.0.113.7'
		} as unknown as RequestEvent);

		expect(fastapiServiceHeaders({ Accept: 'application/json' })).toEqual({
			Accept: 'application/json',
			Authorization: 'Bearer test-external-secret',
			'X-Real-IP': '203.0.113.7'
		});
	});

	it('omits X-Real-IP outside a request', () => {
		vi.mocked(getRequestEvent).mockImplementation(() => {
			throw new Error(
				'Can only read the current request event inside functions invoked during handle'
			);
		});

		expect(fastapiServiceHeaders()).toEqual({
			Authorization: 'Bearer test-external-secret'
		});
	});
});
