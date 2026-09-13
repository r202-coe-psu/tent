import { describe, expect, it, vi } from 'vitest';
import type { Evacuee } from '../domain/people';
import {
	lookupFederatedByScanCodeWithDeps,
	type FederatedScanLookupDeps
} from './federated-scan-lookup';

function ev(id: string): Evacuee {
	return {
		_id: id,
		_rev: '1',
		type: 'evacuee',
		schema_v: 1,
		first_name: 'สมชาย',
		last_name: 'ใจดี',
		gender: 'male',
		current_stay: { status: 'arriving', zone: null },
		created_at: '',
		updated_at: '',
		created_by: 'test',
		shelter_code: 'sh001'
	} as Evacuee;
}

describe('lookupFederatedByScanCodeWithDeps', () => {
	it('returns couch hit on getEvacuee', async () => {
		const found = ev('evacuee:01A');
		const deps: FederatedScanLookupDeps = {
			getEvacuee: vi.fn().mockResolvedValue(found),
			searchEvacuees: vi.fn(),
			searchUnassigned: vi.fn()
		};
		const hit = await lookupFederatedByScanCodeWithDeps('evacuee:01A', deps);
		expect(hit).toEqual({ source: 'couch', evacuee: found });
		expect(deps.searchEvacuees).not.toHaveBeenCalled();
		expect(deps.searchUnassigned).not.toHaveBeenCalled();
	});

	it('falls back to couch search then mongo unassigned', async () => {
		const poolHit = {
			id: 'reg-1',
			reserved_household_id: 'household:1',
			registered_via: 'web' as const,
			status: 'open',
			created_at: '',
			open_members: []
		};
		const deps: FederatedScanLookupDeps = {
			getEvacuee: vi.fn().mockResolvedValue(null),
			searchEvacuees: vi.fn().mockResolvedValue([]),
			searchUnassigned: vi.fn().mockResolvedValue({ results: [poolHit] })
		};
		const hit = await lookupFederatedByScanCodeWithDeps('reg-1', deps);
		expect(hit).toEqual({ source: 'unassigned', hit: poolHit });
		expect(deps.searchUnassigned).toHaveBeenCalledWith('reg-1');
	});

	it('returns null when couch and mongo miss', async () => {
		const deps: FederatedScanLookupDeps = {
			getEvacuee: vi.fn().mockRejectedValue(new Error('missing')),
			searchEvacuees: vi.fn().mockResolvedValue([]),
			searchUnassigned: vi.fn().mockResolvedValue({ results: [] })
		};
		expect(await lookupFederatedByScanCodeWithDeps('unknown', deps)).toBeNull();
	});

	it('parses zoning path before couch get', async () => {
		const found = ev('evacuee:PATH');
		const deps: FederatedScanLookupDeps = {
			getEvacuee: vi.fn().mockResolvedValue(found),
			searchEvacuees: vi.fn(),
			searchUnassigned: vi.fn()
		};
		await lookupFederatedByScanCodeWithDeps('/onsite/zoning/evacuee:PATH', deps);
		expect(deps.getEvacuee).toHaveBeenCalledWith('evacuee:PATH');
	});
});
