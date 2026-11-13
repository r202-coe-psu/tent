import { describe, it, expect, beforeEach, vi } from 'vitest';
import { error } from '@sveltejs/kit';

// PATCH (edit one shelter) must authorize with requireShelterManagerOrSA so a
// shelter_manager can edit their OWN shelter (scope-enforced), not requireAdmin.
const caller = {
	name: 'mgr',
	roles: ['shelter:SH001', 'shelter_manager'],
	isSA: false,
	shelterCode: 'SH001'
};

vi.mock('$lib/server/couch-admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/couch-admin')>();
	const c = {
		name: 'mgr',
		roles: ['shelter:SH001', 'shelter_manager'],
		isSA: false,
		shelterCode: 'SH001'
	};
	return {
		...actual,
		requireShelterManagerOrSA: vi.fn().mockResolvedValue(c),
		requireShelterScopeOrSA: vi.fn().mockResolvedValue(c)
	};
});
vi.mock('$lib/server/master-data-server', () => ({
	readMasterDoc: vi.fn()
}));
vi.mock('$lib/server/shelters.admin', () => ({
	updateMaster: vi.fn().mockResolvedValue({ id: 'shelter:SH001', rev: '2-new' }),
	findMasterByCode: vi.fn(),
	migrate: vi.fn(),
	nowIso: () => '2026-01-01T00:00:00.000Z'
}));

import { GET, PATCH } from './+server';
import { requireShelterManagerOrSA } from '$lib/server/couch-admin';
import { updateMaster, findMasterByCode, migrate } from '$lib/server/shelters.admin';
import { readMasterDoc } from '$lib/server/master-data-server';
import type { MasterData } from '$lib/features/master-data/domain';
import type { ShelterMaster } from '$lib/features/shelters/server';

const mgrMock = vi.mocked(requireShelterManagerOrSA);
const updateMock = vi.mocked(updateMaster);
const readMasterDocMock = vi.mocked(readMasterDoc);

const siteKindDoc = {
	items: [
		{ code: 'evacuation_center', status: 'active' },
		{ code: 'host_house', status: 'active' },
		{ code: 'field_hospital', status: 'inactive' }
	]
} as unknown as MasterData;

/** Run the mutator updateMaster is given against a stored shelter of `storedKind`. */
function useStoredKind(storedKind: string) {
	updateMock.mockImplementation(async (_code, mutator) => {
		await mutator({ site_kind: storedKind } as ShelterMaster);
		return { id: 'shelter:SH001', rev: '2-new' };
	});
}

function callPATCH(code: string, body: unknown = {}) {
	const request = new Request(`http://localhost/api/back-office/shelter/${code}`, {
		method: 'PATCH',
		headers: { cookie: 'AuthSession=abc', 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	return PATCH({ request, params: { code } } as unknown as Parameters<typeof PATCH>[0]);
}

beforeEach(() => {
	mgrMock.mockReset().mockResolvedValue(caller);
	updateMock.mockReset().mockResolvedValue({ id: 'shelter:SH001', rev: '2-new' });
	readMasterDocMock.mockReset().mockResolvedValue(siteKindDoc);
});

describe('PATCH /api/back-office/shelter/[code]', () => {
	it('authorizes via requireShelterManagerOrSA (SM edits own shelter) then updates', async () => {
		const res = await callPATCH('SH001', {});
		expect(mgrMock).toHaveBeenCalledWith('AuthSession=abc', 'SH001');
		expect(updateMock).toHaveBeenCalledTimes(1);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, code: 'SH001', rev: '2-new' });
	});

	it('does not update when the scope guard rejects a cross-shelter edit', async () => {
		mgrMock.mockImplementationOnce(() => {
			throw error(403, 'not authorised for shelter');
		});
		expect((await callPATCH('SH999', {})).status).toBe(403);
		expect(updateMock).not.toHaveBeenCalled();
	});

	it('patches only the fields the client sent, not schema defaults', async () => {
		await callPATCH('SH001', { name: 'ศูนย์ใหม่' });
		const mutator = updateMock.mock.calls[0][1] as (c: unknown) => {
			patch: Record<string, unknown>;
		};
		const { patch } = mutator({ operation_status: 'closed' });
		expect(patch).toEqual({ name: 'ศูนย์ใหม่', updated_at: '2026-01-01T00:00:00.000Z' });
	});

	it('leaves closed_at to updateMaster, even when the client sends one', async () => {
		await callPATCH('SH001', { operation_status: 'closed' });
		const mutator = updateMock.mock.calls[0][1] as (c: unknown) => {
			patch: Record<string, unknown>;
		};
		const { patch } = mutator({ operation_status: 'closed' });
		expect(patch.operation_status).toBe('closed');
		expect(patch).not.toHaveProperty('closed_at');
	});
});

describe('PATCH /api/back-office/shelter/[code] — closing goes through the close route (CR-219 FR-22)', () => {
	/** Run the PATCH against a stored shelter in `stored` status; returns the response status. */
	async function patchAgainst(stored: string, body: unknown): Promise<number> {
		updateMock.mockImplementation(async (_code, mutator) => {
			await mutator({ operation_status: stored } as ShelterMaster);
			return { id: 'shelter:SH001', rev: '2-new' };
		});
		return (await callPATCH('SH001', body)).status;
	}

	it.each(['active', 'standby', 'full_capacity', 'cancelled'])(
		'400 when the PATCH would close a %s shelter directly',
		async (stored) => {
			expect(await patchAgainst(stored, { operation_status: 'closed' })).toBe(400);
		}
	);

	it('allows saving other fields of an already-closed shelter', async () => {
		expect(await patchAgainst('closed', { operation_status: 'closed', name: 'x' })).toBe(200);
	});

	it('allows reopening a closed shelter (FR-25)', async () => {
		expect(await patchAgainst('closed', { operation_status: 'active' })).toBe(200);
	});

	it('answers 403 (not 500) for a manager of another shelter', async () => {
		mgrMock.mockImplementationOnce(() => {
			throw error(403, 'not authorised for shelter');
		});
		const res = await callPATCH('SH999', {});
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({
			error: { code: 'FORBIDDEN', message: 'not authorised for shelter' }
		});
	});

	it('answers the close block in the contract envelope so the UI can toast it', async () => {
		updateMock.mockImplementation(async (_code, mutator) => {
			await mutator({ operation_status: 'active' } as ShelterMaster);
			return { id: 'shelter:SH001', rev: '2-new' };
		});
		const res = await callPATCH('SH001', { operation_status: 'closed' });
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			error: {
				code: 'VALIDATION',
				message: 'ปิดศูนย์ต้องทำผ่าน POST /api/back-office/shelter/[code]/close'
			}
		});
	});
});

describe('PATCH /api/back-office/shelter/[code] — site_kind (CR-198 FR-7/FR-8)', () => {
	it('does not read the master when the body carries no site_kind', async () => {
		useStoredKind('field_hospital');
		const res = await callPATCH('SH001', { name: 'ชื่อใหม่' });
		expect(res.status).toBe(200);
		expect(readMasterDocMock).not.toHaveBeenCalled();
	});

	it('accepts a change to an active kind', async () => {
		useStoredKind('evacuation_center');
		const res = await callPATCH('SH001', { site_kind: 'host_house' });
		expect(res.status).toBe(200);
		expect(readMasterDocMock).toHaveBeenCalledWith('site_kind');
	});

	it('accepts an unchanged kind whose item was deactivated (FR-8)', async () => {
		useStoredKind('field_hospital');
		const res = await callPATCH('SH001', { site_kind: 'field_hospital' });
		expect(res.status).toBe(200);
	});

	it.each(['field_hospital', 'not_in_master'])(
		'rejects a change to %s with the field named',
		async (kind) => {
			useStoredKind('evacuation_center');
			const res = await callPATCH('SH001', { site_kind: kind });
			expect(res.status).toBe(422);
			expect((await res.json()).error.message).toContain('ประเภทศูนย์');
		}
	);
});

describe('PATCH /api/back-office/shelter/[code] — optimistic concurrency + storage points (CR-230)', () => {
	const point = { id: 'p1', name: 'คลัง', types: ['general'] };

	/** Run the mutator against a stored doc at `_rev`; returns the status and what it patched. */
	async function patchAgainst(stored: Record<string, unknown>, body: unknown) {
		let patch: Record<string, unknown> | undefined;
		updateMock.mockImplementation(async (_code, mutator) => {
			patch = (await mutator(stored as unknown as ShelterMaster)).patch as Record<string, unknown>;
			return { id: 'shelter:SH001', rev: '3-new' };
		});
		const res = await callPATCH('SH001', body);
		return { res, patch };
	}

	it('409 with the reload message and no patch when _rev is stale', async () => {
		const { res, patch } = await patchAgainst({ _rev: '2-b' }, { name: 'x', _rev: '1-a' });
		expect(res.status).toBe(409);
		expect((await res.json()).error.message).toContain('กรุณาโหลดใหม่');
		expect(patch).toBeUndefined();
	});

	it('200 when _rev matches, and never writes _rev into the patch', async () => {
		const { res, patch } = await patchAgainst({ _rev: '2-b' }, { name: 'x', _rev: '2-b' });
		expect(res.status).toBe(200);
		expect(patch).toEqual({ name: 'x', updated_at: '2026-01-01T00:00:00.000Z' });
	});

	it('stays optional: a body without _rev is accepted (e2e/direct callers)', async () => {
		const { res } = await patchAgainst({ _rev: '2-b' }, { name: 'x' });
		expect(res.status).toBe(200);
	});

	it('keeps the stored sub_storage when common_areas is sent without it', async () => {
		const { res, patch } = await patchAgainst(
			{ _rev: '2-b', common_areas: { helipad: false, sub_storage: [point] } },
			{ common_areas: { helipad: true } }
		);
		expect(res.status).toBe(200);
		expect(patch?.common_areas).toEqual({ helipad: true, sub_storage: [point] });
	});

	it('replaces sub_storage when the form sends it', async () => {
		const sent = { id: 'p2', name: 'ใหม่', types: ['general'] };
		const { patch } = await patchAgainst(
			{ _rev: '2-b', common_areas: { sub_storage: [point] } },
			{ common_areas: { sub_storage: [sent] } }
		);
		expect((patch?.common_areas as { sub_storage: unknown[] }).sub_storage).toHaveLength(1);
		expect((patch?.common_areas as { sub_storage: { id: string }[] }).sub_storage[0].id).toBe('p2');
	});

	it('falls back to [] when nothing is stored and sub_storage was not sent', async () => {
		const { patch } = await patchAgainst({ _rev: '2-b' }, { common_areas: { helipad: true } });
		expect(patch?.common_areas).toEqual({ helipad: true, sub_storage: [] });
	});
});

describe('GET /api/back-office/shelter/[code]', () => {
	it('returns the master _rev', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue({ code: 'SH001' } as ShelterMaster);
		vi.mocked(migrate).mockReturnValue({
			code: 'SH001',
			name: 'ศูนย์',
			_rev: '4-abc'
		} as ShelterMaster);
		const request = new Request('http://localhost/api/back-office/shelter/SH001', {
			headers: { cookie: 'AuthSession=abc' }
		});
		const res = await GET({ request, params: { code: 'SH001' } } as unknown as Parameters<
			typeof GET
		>[0]);
		expect(res.status).toBe(200);
		expect((await res.json())._rev).toBe('4-abc');
	});
});

describe('PATCH /api/back-office/shelter/[code] — external shelter (CR-252 FR-4/5/9/10)', () => {
	const saCaller = { name: 'sa', roles: ['system_admin'], isSA: true, shelterCode: null };

	async function patchAgainst(stored: Record<string, unknown>, body: unknown, sa = false) {
		if (sa) mgrMock.mockResolvedValue(saCaller);
		let patch: Record<string, unknown> | undefined;
		updateMock.mockImplementation(async (_code, mutator) => {
			patch = (await mutator(stored as unknown as ShelterMaster)).patch as Record<string, unknown>;
			return { id: 'shelter:SH001', rev: '3-new' };
		});
		const res = await callPATCH('SH001', body);
		return { res, patch };
	}

	const external = { is_external: true, operation_status: 'unknown' };
	const regular = { operation_status: 'active' };

	it.each([
		['regular to external', regular, true],
		['external to regular', external, false]
	])('403 when the PATCH switches %s (FR-9)', async (_n, stored, next) => {
		const { res } = await patchAgainst(stored, { is_external: next }, true);
		expect(res.status).toBe(403);
	});

	it('accepts resending the unchanged is_external and status (the edit form does)', async () => {
		const { res, patch } = await patchAgainst(
			external,
			{ is_external: true, operation_status: 'unknown', name: 'x' },
			false
		);
		expect(res.status).toBe(200);
		expect(patch).toMatchObject({ is_external: true, operation_status: 'unknown', name: 'x' });
	});

	it('403 when a shelter_manager changes the status of an external shelter (FR-10)', async () => {
		const { res } = await patchAgainst(external, { operation_status: 'cancelled' });
		expect(res.status).toBe(403);
	});

	it('lets a system_admin cancel an external shelter (FR-4)', async () => {
		const { res } = await patchAgainst(external, { operation_status: 'cancelled' }, true);
		expect(res.status).toBe(200);
	});

	it.each(['active', 'closed', 'standby'])(
		'422 when a system_admin sets an external shelter to %s',
		async (status) => {
			const { res } = await patchAgainst(external, { operation_status: status }, true);
			expect(res.status).toBe(422);
		}
	);

	it('422 when a regular shelter is set to unknown (FR-5)', async () => {
		const { res } = await patchAgainst(regular, { operation_status: 'unknown' });
		expect(res.status).toBe(422);
	});

	it('rejects a non-https external_url', async () => {
		const { res } = await patchAgainst(external, { external_url: 'http://x.example' }, true);
		expect(res.status).toBe(422);
	});

	it('stores a blank external_url as null', async () => {
		const { patch } = await patchAgainst(external, { external_url: '  ' }, true);
		expect(patch).toMatchObject({ external_url: null });
	});
});
