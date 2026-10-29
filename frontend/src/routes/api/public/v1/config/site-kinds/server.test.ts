import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/server/master-data-server', () => ({
	readMasterDoc: vi.fn()
}));

import { readMasterDoc } from '$lib/server/master-data-server';
import { GET } from './+server';
import type { RequestEvent } from './$types';

const readMasterDocMock = vi.mocked(readMasterDoc);

describe('GET /api/public/v1/config/site-kinds', () => {
	beforeEach(() => {
		readMasterDocMock.mockReset();
	});

	it('returns every item including inactive ones, with status', async () => {
		readMasterDocMock.mockResolvedValue({
			_id: 'master_data:site_kind',
			type: 'master_data',
			schema_v: 4,
			master_type: 'site_kind',
			items: [
				{
					code: 'evacuation_center',
					label_th: 'ศูนย์อพยพ',
					label_en: 'Evacuation Center',
					is_default: true,
					status: 'active'
				},
				{
					code: 'field_hospital',
					label_th: 'โรงพยาบาลสนาม',
					label_en: 'Field Hospital',
					is_default: false,
					status: 'inactive'
				}
			],
			created_at: '2026-01-01T00:00:00Z',
			updated_at: '2026-01-01T00:00:00Z',
			created_by: 'seed'
		});

		const res = await GET({} as unknown as RequestEvent);
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
		expect(await res.json()).toEqual({
			types: [
				{
					code: 'evacuation_center',
					label_th: 'ศูนย์อพยพ',
					label_en: 'Evacuation Center',
					status: 'active'
				},
				{
					code: 'field_hospital',
					label_th: 'โรงพยาบาลสนาม',
					label_en: 'Field Hospital',
					status: 'inactive'
				}
			]
		});
	});

	it('returns an empty list, uncached, when the registry is unreachable', async () => {
		readMasterDocMock.mockRejectedValue(new Error('CouchDB error'));

		const res = await GET({} as unknown as RequestEvent);
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(await res.json()).toEqual({ types: [] });
	});

	it('returns an empty list when the master doc is missing', async () => {
		readMasterDocMock.mockResolvedValue(null);

		const res = await GET({} as unknown as RequestEvent);
		expect(await res.json()).toEqual({ types: [] });
	});
});
