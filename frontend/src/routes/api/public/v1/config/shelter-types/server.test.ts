import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/server/master-data-server', () => ({
	readMasterDoc: vi.fn()
}));

import { readMasterDoc } from '$lib/server/master-data-server';
import { GET } from './+server';
import type { RequestEvent } from './$types';

const readMasterDocMock = vi.mocked(readMasterDoc);

describe('GET /api/public/v1/config/shelter-types', () => {
	beforeEach(() => {
		readMasterDocMock.mockReset();
	});

	it('returns shelter types filtering out inactive items', async () => {
		readMasterDocMock.mockResolvedValue({
			_id: 'master_data:shelter_type',
			type: 'master_data',
			schema_v: 3,
			master_type: 'shelter_type',
			items: [
				{ code: '01K_SCHOOL', label: 'โรงเรียน', is_default: true, status: 'active' },
				{ code: '01K_TEMPLE', label: 'วัด', is_default: false, status: 'active' },
				{ code: '01K_OLD', label: 'สถานที่เก่า', is_default: false, status: 'inactive' }
			],
			created_at: '2026-01-01T00:00:00Z',
			updated_at: '2026-01-01T00:00:00Z',
			created_by: 'seed'
		});

		const res = await GET({} as unknown as RequestEvent);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data).toEqual({
			types: [
				{ code: '01K_SCHOOL', label: 'โรงเรียน' },
				{ code: '01K_TEMPLE', label: 'วัด' }
			],
			shelterTypes: [
				{ code: '01K_SCHOOL', label: 'โรงเรียน' },
				{ code: '01K_TEMPLE', label: 'วัด' }
			]
		});
	});

	it('returns empty list gracefully on error or not found', async () => {
		readMasterDocMock.mockRejectedValue(new Error('CouchDB error'));

		const res = await GET({} as unknown as RequestEvent);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data).toEqual({ types: [], shelterTypes: [] });
	});
});
