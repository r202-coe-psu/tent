import { describe, expect, it } from 'vitest';
import {
	E2E_ANSWER_HASH,
	isE2eShelter,
	isE2eUser,
	type CouchUser
} from '../../../../../scripts/cleanup-e2e-residue';

const user = (over: Partial<CouchUser>): CouchUser => ({
	_id: `org.couchdb.user:${over.name ?? 'u'}`,
	_rev: '1-a',
	name: 'u',
	roles: [],
	...over
});

describe('isE2eShelter', () => {
	it('selects only shelters named with the E2E prefix', () => {
		expect(isE2eShelter({ name: 'E2E Donation admin abc' })).toBe(true);
		expect(isE2eShelter({ name: 'ศูนย์พักพิง E2E' })).toBe(false);
		expect(isE2eShelter({ name: undefined })).toBe(false);
	});
});

describe('isE2eUser', () => {
	const codes = new Set(['SH900']);
	const keep = new Set(['e2e_staff']);

	it('selects users carrying the E2E security-question fingerprint', () => {
		const u = user({ name: 'ui_sa_x', security_question: { answer_hash: E2E_ANSWER_HASH } });
		expect(isE2eUser(u, codes, keep)).toBe(true);
	});

	it('selects users scoped only to a removed E2E shelter', () => {
		expect(isE2eUser(user({ roles: ['shelter:SH900', 'warehouse_staff'] }), codes, keep)).toBe(
			true
		);
		expect(isE2eUser(user({ shelter_id: 'SH900' }), codes, keep)).toBe(true);
	});

	it('leaves users that also reach a real shelter, or no shelter at all', () => {
		expect(isE2eUser(user({ roles: ['shelter:SH900', 'shelter:SH001'] }), codes, keep)).toBe(false);
		expect(isE2eUser(user({ roles: ['system_admin'] }), codes, keep)).toBe(false);
		expect(
			isE2eUser(user({ security_question: { answer_hash: 'f'.repeat(64) } }), codes, keep)
		).toBe(false);
	});

	it('never selects the provisioned E2E accounts', () => {
		const u = user({ name: 'e2e_staff', security_question: { answer_hash: E2E_ANSWER_HASH } });
		expect(isE2eUser(u, codes, keep)).toBe(false);
	});
});
