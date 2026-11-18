import { describe, expect, it } from 'vitest';
import {
	currentActor,
	runAsActor,
	runWithActorScope,
	setRequestActor,
	stampAdminWrite,
	withActor
} from './request-actor';

describe('request actor (CR-260 FR-C6)', () => {
	it('keeps the actor per request scope', async () => {
		await runWithActorScope(async () => {
			expect(currentActor()).toBeNull();
			setRequestActor('sm.user');
			await Promise.resolve();
			expect(currentActor()).toBe('sm.user');
		});
		expect(currentActor()).toBeNull();
	});

	it('stamps admin writes to shelter and catalog documents only', () => {
		runAsActor('sm.user', () => {
			expect(stampAdminWrite('/shelter_sh001/evacuee%3A01', 'PUT', { a: 1 })).toEqual({
				a: 1,
				updated_by: 'sm.user'
			});
			expect(stampAdminWrite('/catalog', 'POST', { a: 1 })).toEqual({
				a: 1,
				updated_by: 'sm.user'
			});
			expect(
				stampAdminWrite('/shelter_sh001/_bulk_docs', 'POST', { docs: [{ _id: 'a' }, { _id: 'b' }] })
			).toEqual({
				docs: [
					{ _id: 'a', updated_by: 'sm.user' },
					{ _id: 'b', updated_by: 'sm.user' }
				]
			});
		});
	});

	it('leaves reads, design docs, security, other DBs and actor-less calls alone', () => {
		runAsActor('sm.user', () => {
			const body = { selector: {} };
			expect(stampAdminWrite('/shelter_sh001/_find', 'POST', body)).toBe(body);
			expect(stampAdminWrite('/shelter_sh001/_design/access', 'PUT', body)).toBe(body);
			expect(stampAdminWrite('/shelter_sh001/_security', 'PUT', body)).toBe(body);
			expect(stampAdminWrite('/registry/shelter%3A01', 'PUT', body)).toBe(body);
			expect(stampAdminWrite('/audit_log/audit_event%3A01', 'PUT', body)).toBe(body);
		});
		const body = { a: 1 };
		expect(stampAdminWrite('/shelter_sh001/evacuee%3A01', 'PUT', body)).toBe(body);
	});

	it('withActor sets created_by only on a new doc', () => {
		expect(withActor({ _id: 'x' }, 'worker')).toEqual({
			_id: 'x',
			updated_by: 'worker',
			created_by: 'worker'
		});
		expect(withActor({ _id: 'x', _rev: '1-a', created_by: 'reg' }, 'sm')).toEqual({
			_id: 'x',
			_rev: '1-a',
			created_by: 'reg',
			updated_by: 'sm'
		});
	});
});
