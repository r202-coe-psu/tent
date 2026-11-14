import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/shelters.admin', () => ({
	listShelterMasters: vi.fn(),
	migrate: (m: unknown) => m
}));
vi.mock('$lib/server/couch-admin', () => ({ adminRaw: vi.fn() }));

import { listShelterMasters } from '$lib/server/shelters.admin';
import { GET } from './+server';
import type { RequestEvent } from './$types';

const master = (code: string, feature_flags?: Record<string, boolean>) => ({
	_id: `shelter:${code}`,
	code,
	name: code,
	// standby → no per-shelter CouchDB view reads, so only the registry is mocked
	operation_status: 'standby',
	capacity: 10,
	feature_flags
});

describe('GET /api/public/v1/transparency/shelters (CR-251 hidden shelters)', () => {
	it('leaves a public_visible:false shelter out of the list and the summary', async () => {
		vi.mocked(listShelterMasters).mockResolvedValue([
			master('SH001'),
			master('SH002', { public_visible: false })
		] as never);

		const res = await GET({
			url: new URL('http://localhost/api/public/v1/transparency/shelters'),
			setHeaders: vi.fn()
		} as unknown as RequestEvent);

		const data = await res.json();
		expect(data.shelters.map((s: { id: string }) => s.id)).toEqual(['shelter:SH001']);
		expect(data.summary.shelters_total).toBe(1);
	});
});
