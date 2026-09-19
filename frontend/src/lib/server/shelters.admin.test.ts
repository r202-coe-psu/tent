import { describe, expect, it } from 'vitest';
import { buildSecurityMutationLock } from './shelters.admin';

describe('buildSecurityMutationLock', () => {
	it('writes a regular CouchDB type field instead of the reserved _type member', () => {
		const lock = buildSecurityMutationLock({
			id: 'shelter_security_lock%3ASH001',
			ownerId: 'security:test',
			resource: 'SH001',
			leaseUntil: '2026-09-20T00:00:30.000Z',
			rev: '3-old'
		});

		expect(lock).toMatchObject({
			_id: 'shelter_security_lock%3ASH001',
			type: 'shelter_security_mutation_lock',
			_rev: '3-old'
		});
		expect(lock).not.toHaveProperty('_type');
	});
});
