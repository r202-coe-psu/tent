import { describe, expect, it } from 'vitest';

import { SHELTER_CAPABILITIES } from '$lib/auth/roles';
import {
	CENTRAL_WRITE_POLICY_DESIGN,
	LEGACY_CENTRAL_MEMBER_ROLES,
	centralMemberRoles,
	hasWritePolicy,
	syncCentralDbAccess
} from './central-db-security';
import { buildRegistryDesignDoc } from './registry-design';

describe('centralMemberRoles', () => {
	it('keeps the legacy flat roles with no shelters', () => {
		expect(centralMemberRoles([])).toEqual([...LEGACY_CENTRAL_MEMBER_ROLES]);
	});

	it('adds one shelter scope per code, deduplicated and sorted', () => {
		expect(centralMemberRoles(['SH002', 'SH001', 'SH002'])).toEqual([
			...LEGACY_CENTRAL_MEMBER_ROLES,
			'shelter:SH001',
			'shelter:SH002'
		]);
	});

	it('drops malformed shelter codes instead of minting them into _security', () => {
		expect(centralMemberRoles(['SH001', 'sh002', '', 'SH1000', 'shelter:SH003'])).toEqual([
			...LEGACY_CENTRAL_MEMBER_ROLES,
			'shelter:SH001',
			'shelter:SH1000'
		]);
	});

	it('never grants by capability — compound or flat — beyond the legacy set', () => {
		const roles = centralMemberRoles(['SH001']);
		for (const cap of SHELTER_CAPABILITIES) {
			expect(roles).not.toContain(`SH001:${cap}`);
		}
		expect(roles.filter((r) => !r.startsWith('shelter:'))).toEqual([
			...LEGACY_CENTRAL_MEMBER_ROLES
		]);
	});
});

describe('hasWritePolicy', () => {
	it('accepts the deployed registry design', () => {
		expect(hasWritePolicy(buildRegistryDesignDoc())).toBe(true);
	});

	it.each([
		['missing doc', null],
		['non-object', 'function () {}'],
		['views only', { _id: '_design/app', views: {} }],
		['blank VDU', { validate_doc_update: '   ' }],
		['non-string VDU', { validate_doc_update: 42 }]
	])('rejects %s', (_label, doc) => {
		expect(hasWritePolicy(doc)).toBe(false);
	});

	it('maps each central DB to its write-policy design doc', () => {
		expect(CENTRAL_WRITE_POLICY_DESIGN).toEqual({
			registry: '_design/app',
			catalog: '_design/access'
		});
	});
});

describe('syncCentralDbAccess', () => {
	function recordingSteps(fail?: 'registry' | 'catalog') {
		const calls: string[] = [];
		const steps = {
			deployRegistryPolicy: async () => {
				calls.push('policy:registry');
				if (fail === 'registry') throw new Error('registry deploy failed');
				return 'deployed';
			},
			deployCatalogPolicy: async () => {
				calls.push('policy:catalog');
				if (fail === 'catalog') throw new Error('catalog deploy failed');
				return 'updated';
			},
			listShelterCodes: async () => {
				calls.push('list');
				return ['SH002', 'SH001'];
			},
			mergeMembers: async (db: string, roles: string[]) => {
				calls.push(`security:${db}:${roles.join(',')}`);
				return 'updated';
			}
		};
		return { calls, steps };
	}

	it('deploys both write policies before widening _security', async () => {
		const { calls, steps } = recordingSteps();
		const roles = centralMemberRoles(['SH001', 'SH002']).join(',');

		await expect(syncCentralDbAccess(steps)).resolves.toEqual({
			registryPolicy: 'deployed',
			catalogPolicy: 'updated',
			shelterCodes: ['SH002', 'SH001'],
			security: { registry: 'updated', catalog: 'updated' }
		});
		expect(calls).toEqual([
			'policy:registry',
			'policy:catalog',
			'list',
			`security:registry:${roles}`,
			`security:catalog:${roles}`
		]);
	});

	it.each(['registry', 'catalog'] as const)(
		'leaves _security untouched when the %s policy deploy fails',
		async (fail) => {
			const { calls, steps } = recordingSteps(fail);

			await expect(syncCentralDbAccess(steps)).rejects.toThrow(`${fail} deploy failed`);
			expect(calls.some((call) => call.startsWith('security:'))).toBe(false);
		}
	);
});
