import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	currentActor,
	prepareAdminWrite,
	runAsActor,
	runWithActorScope,
	setRequestActor,
	withActor
} from './request-actor';

const stamp = (path: string, method: string, body: unknown) =>
	prepareAdminWrite(path, method, body).body;

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
			expect(stamp('/shelter_sh001/evacuee%3A01', 'PUT', { a: 1 })).toEqual({
				a: 1,
				updated_by: 'sm.user'
			});
			expect(stamp('/catalog', 'POST', { a: 1 })).toEqual({ a: 1, updated_by: 'sm.user' });
			expect(
				stamp('/shelter_sh001/_bulk_docs', 'POST', { docs: [{ _id: 'a' }, { _id: 'b' }] })
			).toEqual({
				docs: [
					{ _id: 'a', updated_by: 'sm.user' },
					{ _id: 'b', updated_by: 'sm.user' }
				]
			});
		});
	});

	it('leaves reads, design docs, security and other DBs alone', () => {
		runAsActor('sm.user', () => {
			const body = { selector: {} };
			for (const [path, method] of [
				['/shelter_sh001/_find', 'POST'],
				['/shelter_sh001/_design/access', 'PUT'],
				['/shelter_sh001/_security', 'PUT'],
				['/registry/shelter%3A01', 'PUT'],
				['/audit_log/audit_event%3A01', 'PUT'],
				['/registry/lock%3A01?rev=1-a', 'DELETE']
			]) {
				expect(prepareAdminWrite(path, method, body)).toEqual({ path, method, body });
			}
		});
	});

	it('clears a carried-over updated_by when no actor is known (W3: unknown, not the last writer)', () => {
		const stale = { _id: 'evacuee:01', _rev: '3-a', name: 'x', updated_by: 'previous.user' };
		expect(stamp('/shelter_sh001/evacuee%3A01', 'PUT', stale)).toEqual({
			_id: 'evacuee:01',
			_rev: '3-a',
			name: 'x'
		});
		expect(
			stamp('/shelter_sh001/_bulk_docs', 'POST', { docs: [stale, { _id: 'evacuee:02' }] })
		).toEqual({ docs: [{ _id: 'evacuee:01', _rev: '3-a', name: 'x' }, { _id: 'evacuee:02' }] });
		const fresh = { _id: 'evacuee:02' };
		expect(stamp('/shelter_sh001/evacuee%3A02', 'PUT', fresh)).toBe(fresh);
	});

	describe('DELETE of an audited doc (W4)', () => {
		beforeEach(() => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date('2026-11-25T03:00:00.000Z'));
		});
		afterEach(() => vi.useRealTimers());

		it('becomes a PUT tombstone that names the deleter', () => {
			runAsActor('kiosk:kiosk-sh001-01', () => {
				expect(prepareAdminWrite('/shelter_sh001/image%3A01?rev=2-b', 'DELETE', undefined)).toEqual(
					{
						path: '/shelter_sh001/image%3A01',
						method: 'PUT',
						body: {
							_id: 'image:01',
							_rev: '2-b',
							_deleted: true,
							updated_at: '2026-11-25T03:00:00.000Z',
							updated_by: 'kiosk:kiosk-sh001-01'
						}
					}
				);
			});
		});

		it('names no one when no actor is known, and leaves a rev-less DELETE alone', () => {
			expect(
				prepareAdminWrite('/catalog/item_master%3A01?rev=1-a', 'DELETE', undefined).body
			).toEqual({
				_id: 'item_master:01',
				_rev: '1-a',
				_deleted: true,
				updated_at: '2026-11-25T03:00:00.000Z'
			});
			expect(prepareAdminWrite('/shelter_sh001/image%3A01', 'DELETE', undefined)).toEqual({
				path: '/shelter_sh001/image%3A01',
				method: 'DELETE',
				body: undefined
			});
		});
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
