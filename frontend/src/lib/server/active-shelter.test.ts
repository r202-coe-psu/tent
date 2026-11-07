import { describe, expect, it } from 'vitest';
import { resolveActiveShelter } from './active-shelter';

const MSG = 'forbidden here';
const CAPS = ['shelter_manager', 'warehouse_staff'] as const;

/** Run and return the HttpError status thrown, or the resolved shelter. */
function run(roles: string[], requested: string | null, isSA = false) {
	try {
		return { shelter: resolveActiveShelter(roles, isSA, requested, CAPS, MSG) };
	} catch (e) {
		return { status: (e as { status: number }).status };
	}
}

describe('resolveActiveShelter (#477)', () => {
	// warehouse_staff in SH002 only; SH001 is the first `shelter:` role.
	const twoShelters = [
		'shelter:SH001',
		'shelter:SH002',
		'SH001:registration_staff',
		'SH002:warehouse_staff'
	];

	it('403 when the capability is held in another shelter but not the requested one', () => {
		expect(run(twoShelters, 'SH001')).toEqual({ status: 403 });
	});

	it('returns the requested shelter when the capability is held there', () => {
		expect(run(twoShelters, 'SH002')).toEqual({ shelter: 'SH002' });
	});

	it('403 for a shelter the caller does not belong to at all', () => {
		expect(run(twoShelters, 'SH009')).toEqual({ status: 403 });
	});

	it('400 when several shelters and none requested — the first is not assumed', () => {
		expect(run(twoShelters, null)).toEqual({ status: 400 });
	});

	it('defaults to the only shelter when the caller belongs to exactly one', () => {
		expect(run(['shelter:SH001', 'SH001:warehouse_staff'], null)).toEqual({ shelter: 'SH001' });
		expect(run(['shelter:SH001', 'warehouse_staff'], null)).toEqual({ shelter: 'SH001' });
	});

	it('403 when the only shelter lacks the capability', () => {
		expect(run(['shelter:SH001', 'SH001:registration_staff'], null)).toEqual({ status: 403 });
	});

	it('400 when the caller has no shelter scope', () => {
		expect(run(['warehouse_staff'], null)).toEqual({ status: 400 });
	});

	it('system admin: the requested shelter as given, null when absent', () => {
		expect(run(['system_admin'], 'SH003', true)).toEqual({ shelter: 'SH003' });
		expect(run(['system_admin'], null, true)).toEqual({ shelter: null });
	});

	it('treats a blank request as absent', () => {
		expect(run(twoShelters, '  ')).toEqual({ status: 400 });
	});
});
