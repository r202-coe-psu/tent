import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';

type Handler = (event: {
	request: { json: () => Promise<unknown> };
	fetch: typeof globalThis.fetch;
	getClientAddress: () => string;
}) => Promise<Response>;

const resolve = POST as unknown as Handler;

vi.mock('$env/dynamic/private', () => ({
	env: {
		FASTAPI_INTERNAL_URL: 'http://localhost:9000',
		EXTERNAL_API_SECRET: 'test-external-secret'
	}
}));

const MINTED = 'TKT-VOL-0123456789ABCDEF0123456789ABCDEF';

function call(body: unknown) {
	const fetch = vi.fn().mockResolvedValue({
		ok: true,
		status: 200,
		json: async () => ({ profile: { portal_id: 'P-1' } })
	});
	return {
		response: resolve({
			request: { json: () => Promise.resolve(body) },
			fetch: fetch as unknown as typeof globalThis.fetch,
			getClientAddress: () => '203.0.113.7'
		}),
		fetch
	};
}

describe('POST /api/public/v1/volunteer/access/resolve', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('resolves a minted token', async () => {
		const result = await call({ token: MINTED }).response;

		expect(result.status).toBe(200);
	});

	it('answers 422 for a body that is not JSON instead of failing the upstream call', async () => {
		const result = await resolve({
			request: { json: () => Promise.reject(new SyntaxError('bad json')) },
			fetch: vi.fn() as unknown as typeof globalThis.fetch,
			getClientAddress: () => '203.0.113.7'
		});

		expect(result.status).toBe(422);
	});
});
