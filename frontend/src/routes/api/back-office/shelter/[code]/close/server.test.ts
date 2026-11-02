import { describe, it, expect, beforeEach, vi } from 'vitest';
import { error } from '@sveltejs/kit';

vi.mock('$lib/server/couch-admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/couch-admin')>();
	return {
		...actual,
		adminRaw: vi.fn(),
		requireShelterManagerOrSA: vi.fn()
	};
});
vi.mock('$lib/server/shelters.admin', () => ({
	findMasterByCode: vi.fn(),
	migrate: (m: unknown) => m,
	nowIso: () => '2026-11-01T08:00:00.000Z',
	updateMaster: vi.fn()
}));
vi.mock('$lib/server/shelter-close', () => ({
	closeShelterPeople: vi.fn(),
	previewShelterClose: vi.fn()
}));

import { GET, POST } from './+server';
import { requireShelterManagerOrSA } from '$lib/server/couch-admin';
import { findMasterByCode, updateMaster } from '$lib/server/shelters.admin';
import { closeShelterPeople, previewShelterClose } from '$lib/server/shelter-close';
import type { ShelterMaster } from '$lib/features/shelters/server';

const guard = vi.mocked(requireShelterManagerOrSA);
const findMaster = vi.mocked(findMasterByCode);
const update = vi.mocked(updateMaster);
const close = vi.mocked(closeShelterPeople);
const preview = vi.mocked(previewShelterClose);

const manager = {
	name: 'mgr1',
	roles: ['shelter:SH001', 'shelter_manager'],
	isSA: false,
	shelterCode: 'SH001'
};
const master = {
	_id: 'shelter:01',
	code: 'SH001',
	name: 'ศูนย์  วัดกลาง',
	operation_status: 'active'
};
const CONFIRM = 'SH001 ศูนย์ วัดกลาง';

function call(
	handler: typeof GET | typeof POST,
	method: string,
	body?: unknown,
	code = 'SH001'
): Promise<Response> {
	const request = new Request(`http://localhost/api/back-office/shelter/${code}/close`, {
		method,
		headers: { cookie: 'AuthSession=abc', 'content-type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	return Promise.resolve(
		handler({ request, params: { code } } as unknown as Parameters<typeof GET>[0])
	);
}

beforeEach(() => {
	guard.mockReset().mockResolvedValue(manager);
	findMaster.mockReset().mockResolvedValue(master as unknown as ShelterMaster);
	update.mockReset().mockResolvedValue({ id: 'shelter:01', rev: '2-x' });
	preview.mockReset().mockResolvedValue({ by_status: { active: 3, pre_registered: 1 }, total: 4 });
	close.mockReset().mockResolvedValue({
		checked_out: 3,
		cancelled: 1,
		failed: [],
		remaining: { by_status: {}, total: 0 }
	});
});

describe('GET /api/back-office/shelter/[code]/close (FR-7)', () => {
	it('returns counts by status for SA / the shelter manager', async () => {
		const res = await call(GET, 'GET');
		expect(guard).toHaveBeenCalledWith('AuthSession=abc', 'SH001');
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(await res.json()).toEqual({ by_status: { active: 3, pre_registered: 1 }, total: 4 });
	});

	it('403 for a manager of another shelter or another role (FR-22)', async () => {
		guard.mockImplementationOnce(() => {
			throw error(403, 'not authorised');
		});
		const res = await call(GET, 'GET', undefined, 'SH999');
		expect(res.status).toBe(403);
		expect(preview).not.toHaveBeenCalled();
	});

	it('404 for an unknown shelter', async () => {
		findMaster.mockResolvedValueOnce(null);
		expect((await call(GET, 'GET')).status).toBe(404);
	});
});

describe('POST /api/back-office/shelter/[code]/close (FR-8..FR-14)', () => {
	it('checks people out, then closes the registry', async () => {
		const res = await call(POST, 'POST', { confirm_text: CONFIRM });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ closed: true, checked_out: 3, cancelled: 1, failed: [] });
		expect(close).toHaveBeenCalledWith(expect.any(Function), 'SH001', { createdBy: 'mgr1' });
		expect(update).toHaveBeenCalledTimes(1);
		const mutator = update.mock.calls[0][1] as (c: unknown) => { patch: Record<string, unknown> };
		expect(mutator({}).patch).toEqual({
			operation_status: 'closed',
			updated_at: '2026-11-01T08:00:00.000Z'
		});
		expect(close.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
	});

	it('accepts extra whitespace in the confirm text but stays case-sensitive (FR-17)', async () => {
		expect((await call(POST, 'POST', { confirm_text: '  SH001   ศูนย์ วัดกลาง ' })).status).toBe(
			200
		);
		const lower = await call(POST, 'POST', { confirm_text: 'sh001 ศูนย์ วัดกลาง' });
		expect(lower.status).toBe(400);
		// Contract envelope, so serviceFetch toasts the Thai reason (not "Request failed (400)").
		expect(await lower.json()).toEqual({
			error: { code: 'VALIDATION', message: 'ข้อความยืนยันไม่ตรงกับรหัสและชื่อศูนย์' }
		});
	});

	it.each([{ confirm_text: 'SH001' }, { confirm_text: 'SH001 ศูนย์อื่น' }, {}, null])(
		'400 and writes nothing when confirm_text is %j',
		async (body) => {
			const res = await call(POST, 'POST', body);
			expect(res.status).toBe(400);
			expect(close).not.toHaveBeenCalled();
			expect(update).not.toHaveBeenCalled();
		}
	);

	it('does not close the shelter when anyone failed (FR-13)', async () => {
		close.mockResolvedValueOnce({
			checked_out: 2,
			cancelled: 1,
			failed: [{ evacuee_id: 'evacuee:X', error: 'conflict' }],
			remaining: { by_status: { active: 1 }, total: 1 }
		});
		const res = await call(POST, 'POST', { confirm_text: CONFIRM });
		expect(await res.json()).toEqual({
			closed: false,
			checked_out: 2,
			cancelled: 1,
			failed: [{ evacuee_id: 'evacuee:X', error: 'conflict' }]
		});
		expect(update).not.toHaveBeenCalled();
	});

	it('does not close the shelter when the re-count is above zero (FR-13)', async () => {
		close.mockResolvedValueOnce({
			checked_out: 3,
			cancelled: 0,
			failed: [],
			remaining: { by_status: { pre_registered: 1 }, total: 1 }
		});
		const res = await call(POST, 'POST', { confirm_text: CONFIRM });
		expect((await res.json()).closed).toBe(false);
		expect(update).not.toHaveBeenCalled();
	});

	it('403 for a manager of another shelter (FR-22)', async () => {
		guard.mockImplementationOnce(() => {
			throw error(403, 'not authorised');
		});
		const res = await call(POST, 'POST', { confirm_text: 'SH999 x' }, 'SH999');
		expect(res.status).toBe(403);
		expect(close).not.toHaveBeenCalled();
	});
});
