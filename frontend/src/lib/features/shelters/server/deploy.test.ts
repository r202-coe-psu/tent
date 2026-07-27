import { describe, expect, it, vi } from 'vitest';
import { deployShelterViewsFn } from './deploy';

describe('deployShelterViewsFn', () => {
	it('uses the shared lifecycle to initialize _design/dashboard', async () => {
		let stored: Record<string, unknown> | null = null;
		const request = vi.fn(async (path: string, method: string, body?: unknown) => {
			if (method === 'GET' && path.includes('/_view/')) {
				return { status: 200, data: { rows: [] } };
			}
			if (method === 'GET' && path.endsWith('/_design/dashboard')) {
				return stored ? { status: 200, data: stored } : { status: 404, data: null };
			}
			if (method === 'PUT') {
				stored = { ...(body as Record<string, unknown>), _rev: '1-initial' };
				return { status: 201, data: stored };
			}
			return { status: 405, data: null };
		});

		await expect(deployShelterViewsFn('shelter_sh001', request)).resolves.toBe(200);

		expect(request.mock.calls[0]).toEqual(['/shelter_sh001/_design/dashboard', 'GET']);
		const putCall = request.mock.calls.find((call) => call[1] === 'PUT');
		expect(putCall?.[0]).toBe('/shelter_sh001/_design/dashboard');
		expect(putCall?.[2]).toMatchObject({
			_id: '_design/dashboard',
			views: expect.objectContaining({ occupancy: expect.any(Object) }),
			tent_view: expect.objectContaining({ module: 'dashboard', deployment: 'initial' })
		});
	});
});
