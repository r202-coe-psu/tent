import { describe, expect, it } from 'vitest';
import { assessLinkEligibility, type CouchUserDoc } from './user-service';

const fresh: CouchUserDoc = {
	_id: 'org.couchdb.user:staff01',
	name: 'staff01',
	roles: ['shelter:SH001', 'registration_staff'],
	type: 'user',
	must_change_password: true,
	salt: 'abc'
};

describe('assessLinkEligibility (CR-141 FR-16)', () => {
	it('accepts a fresh provisioned account', () => {
		expect(assessLinkEligibility(fresh, 'admin')).toBe('ok');
	});

	it('rejects an account that finished force-setup', () => {
		expect(assessLinkEligibility({ ...fresh, must_change_password: false }, 'admin')).toBe(
			'not_new'
		);
		expect(assessLinkEligibility({ ...fresh, must_change_password: undefined }, 'admin')).toBe(
			'not_new'
		);
	});

	it('rejects an account that already has a provider', () => {
		const doc: CouchUserDoc = {
			...fresh,
			mfa: {
				providers: [{ type: 'google', subject: 'g-1', linked_at: '2026-09-01T00:00:00Z' }]
			}
		} as CouchUserDoc;
		expect(assessLinkEligibility(doc, 'admin')).toBe('has_provider');
	});

	it('rejects the bootstrap admin by name or _admin role', () => {
		expect(assessLinkEligibility({ ...fresh, name: 'admin' }, 'admin')).toBe('bootstrap');
		expect(assessLinkEligibility({ ...fresh, roles: ['_admin'] }, 'admin')).toBe('bootstrap');
	});

	it('rejects a doc without salt (cannot mint a session)', () => {
		expect(assessLinkEligibility({ ...fresh, salt: undefined }, 'admin')).toBe('missing_salt');
	});
});
