import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/shelters.admin', () => ({
	findMasterByCode: vi.fn(),
	migrate: (m: unknown) => m
}));
vi.mock('$lib/server/couch-admin', () => ({
	serviceError: (e: unknown) => {
		throw e;
	}
}));

import { findMasterByCode } from '$lib/server/shelters.admin';
import { GET } from './+server';

type GetEvent = Parameters<typeof GET>[0];
const ev = { params: { code: 'SH001' } } as unknown as GetEvent;
const master = (feature_flags?: Record<string, boolean>) =>
	({ code: 'SH001', name: 'One', operation_status: 'active', feature_flags }) as never;

describe('GET /api/v1/shelters/[code]/risk (CR-251 hidden shelters)', () => {
	it('answers 404 for a public_visible:false shelter', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue(master({ public_visible: false }));

		await expect(GET(ev)).rejects.toMatchObject({ status: 404 });
	});

	it('still answers 200 for a visible shelter', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue(master());

		const res = await GET(ev);

		expect(res.status).toBe(200);
		expect((await res.json()).code).toBe('SH001');
	});
});
