import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/shelters.admin', () => ({
	listShelterMasters: vi.fn(),
	migrate: (m: unknown) => m
}));

import { listShelterMasters } from '$lib/server/shelters.admin';
import { GET } from './+server';

const master = (code: string, feature_flags?: Record<string, boolean>) => ({
	code,
	name: code,
	operation_status: 'active',
	site_kind: 'school',
	capacity: 10,
	feature_flags
});

describe('GET /api/v1/shelters (CR-251 hidden shelters)', () => {
	it('leaves out a shelter with public_visible:false and keeps the rest', async () => {
		vi.mocked(listShelterMasters).mockResolvedValue([
			master('SH001'),
			master('SH002', { public_visible: false }),
			master('SH003', { public_visible: true })
		] as never);

		const res = await GET();

		expect(res.status).toBe(200);
		expect((await res.json()).map((s: { code: string }) => s.code)).toEqual(['SH001', 'SH003']);
	});
});
