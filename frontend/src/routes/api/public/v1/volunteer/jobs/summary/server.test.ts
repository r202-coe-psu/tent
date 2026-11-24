import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';

type GetEvent = Parameters<typeof GET>[0];

const { adminRaw, readMasterDoc } = vi.hoisted(() => ({
	adminRaw: vi.fn(),
	readMasterDoc: vi.fn()
}));

vi.mock('$app/environment', () => ({ dev: false, browser: false }));
vi.mock('$env/dynamic/private', () => ({
	env: {
		FASTAPI_INTERNAL_URL: 'http://localhost:9000',
		EXTERNAL_API_SECRET: 'test-external-secret'
	}
}));
vi.mock('$lib/server/couch-admin', () => ({ adminRaw }));
vi.mock('$lib/server/master-data-server', () => ({ readMasterDoc }));

const call = (fetch: typeof globalThis.fetch) => GET({ fetch } as unknown as GetEvent);

describe('GET /api/public/v1/volunteer/jobs/summary (CR-264 FR-9)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		readMasterDoc.mockResolvedValue({ items: [] });
	});

	it('returns FastAPI’s counts with the service credential and never caches them', async () => {
		const body = { success: true, total: 4, open: 3, near_full: 1, controlled: 1, as_of: 'x' };
		const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });

		const response = await call(fetch);

		expect(await response.json()).toEqual(body);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(fetch).toHaveBeenCalledWith(
			'http://localhost:9000/public/v1/jobs/summary',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer test-external-secret' })
			})
		);
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('hands a FastAPI 4xx back without scanning CouchDB', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue({ ok: false, status: 403, json: async () => ({ success: false }) });

		const response = await call(fetch);

		expect(response.status).toBe(403);
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('counts from CouchDB while FastAPI is down', async () => {
		adminRaw.mockImplementation(async (path: string) => {
			if (path === '/registry/_all_docs?include_docs=true') {
				return {
					status: 200,
					data: {
						rows: [{ doc: { type: 'shelter', code: 'SH001', name: 'A', db: 'shelter_sh001' } }]
					}
				};
			}
			if (path.startsWith('/registry/')) return { status: 404, data: {} };
			return {
				status: 200,
				data: {
					rows: [
						{ doc: { _id: 'job:a', type: 'job', status: 'open', slots_remaining: 5 } },
						{ doc: { _id: 'job:b', type: 'job', status: 'open', slots_remaining: 2 } },
						{ doc: { _id: 'job:c', type: 'job', status: 'open', tier: 'staff-capable', quota: 0 } }
					]
				}
			};
		});

		const response = await call(vi.fn().mockRejectedValue(new Error('fastapi down')));
		const body = await response.json();

		expect(body).toMatchObject({ success: true, total: 3, open: 2, near_full: 1, controlled: 1 });
		expect(typeof body.as_of).toBe('string');
	});
});
