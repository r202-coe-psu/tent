import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as READ } from './+server';
import { POST as UPDATE } from './update/+server';
import {
	volunteerProfileUpdateLimiter,
	volunteerTicketFindLimiter
} from '$lib/server/security/rate-limiter';

/**
 * Both handlers take the same three things off the event; SvelteKit's generated types
 * brand them with their own route id, so they are cast to the shape actually used here
 * rather than to each other.
 */
type PortalHandler = (event: {
	request: { json: () => Promise<unknown> };
	fetch: typeof globalThis.fetch;
	getClientAddress: () => string;
}) => Promise<Response>;

const read = READ as unknown as PortalHandler;
const update = UPDATE as unknown as PortalHandler;

vi.mock('$lib/server/security/rate-limiter', () => ({
	volunteerTicketFindLimiter: { check: vi.fn(() => true) },
	volunteerProfileUpdateLimiter: { check: vi.fn(() => true) }
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		FASTAPI_INTERNAL_URL: 'http://localhost:9000',
		EXTERNAL_API_SECRET: 'test-external-secret'
	}
}));

const upstream = (body: unknown, ok = true, status = 200) =>
	vi.fn().mockResolvedValue({ ok, status, json: async () => body });

function call(handler: PortalHandler, body: unknown, fetch = upstream({ success: true })) {
	return {
		response: handler({
			request: { json: () => Promise.resolve(body) },
			fetch: fetch as unknown as typeof globalThis.fetch,
			getClientAddress: () => '127.0.0.1'
		}),
		fetch
	};
}

describe('POST /api/public/v1/volunteer/profile', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(volunteerTicketFindLimiter.check).mockReturnValue(true);
	});

	it('forwards either credential with the service token and never caches', async () => {
		const { response, fetch } = call(read, { token: 'TKT-VOL-AB12' }, upstream({ profile: null }));
		const result = await response;

		expect(result.status).toBe(200);
		expect(result.headers.get('Cache-Control')).toBe('no-store');
		const [url, init] = vi.mocked(fetch).mock.calls[0]!;
		expect(url).toBe('http://localhost:9000/public/v1/volunteer/profile');
		expect(JSON.parse(String((init as RequestInit).body))).toEqual({ token: 'TKT-VOL-AB12' });
	});

	it('refuses a body carrying neither credential', async () => {
		const { response, fetch } = call(read, {});
		expect((await response).status).toBe(422);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('shares the lookup budget with the other phone-keyed reads', async () => {
		vi.mocked(volunteerTicketFindLimiter.check).mockReturnValue(false);
		const { response, fetch } = call(read, { phone: '0812345678' });
		expect((await response).status).toBe(429);
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('POST /api/public/v1/volunteer/profile/update', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(volunteerProfileUpdateLimiter.check).mockReturnValue(true);
	});

	it('sends only the credential and the skills — nothing staff owns can ride along', async () => {
		const { response, fetch } = call(update, {
			phone: '081-234-5678',
			skills: ['ครัว'],
			identity_verified: true,
			volunteer_code: 'V-999',
			status: 'inactive'
		});
		await response;

		const [, init] = vi.mocked(fetch).mock.calls[0]!;
		const sent = JSON.parse(String((init as RequestInit).body));
		expect(sent).toEqual({ phone: '0812345678', skills: ['ครัว'] });
	});

	it('refuses a skill list longer than the API accepts, before the round trip', async () => {
		const { response, fetch } = call(update, {
			phone: '0812345678',
			skills: Array.from({ length: 31 }, (_, i) => `skill-${i}`)
		});
		expect((await response).status).toBe(422);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("passes upstream's refusal through, so an unknown profile says so", async () => {
		const { response } = call(
			update,
			{ phone: '0812345678', skills: [] },
			upstream({ errors: [{ error: 'PROFILE_NOT_FOUND' }] }, false, 404)
		);
		const result = await response;
		expect(result.status).toBe(404);
		expect(await result.json()).toEqual({ success: false, error: 'PROFILE_NOT_FOUND' });
	});

	it('has its own, tighter budget than the reads', async () => {
		vi.mocked(volunteerProfileUpdateLimiter.check).mockReturnValue(false);
		const { response, fetch } = call(update, { phone: '0812345678', skills: [] });
		expect((await response).status).toBe(429);
		expect(fetch).not.toHaveBeenCalled();
	});
});
