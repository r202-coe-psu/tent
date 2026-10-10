import { describe, expect, it } from 'vitest';
import {
	AuthError,
	CannotConnectError,
	ConflictError,
	CouchAuthError,
	CouchDocumentPolicyError,
	NetworkError,
	NotFoundError
} from '$lib/utils/errors';
import {
	classifyAuthFailure,
	createExpiryLatch,
	discardReturnPath,
	isUserSwitch,
	safeReturnPath,
	shouldRetryQuery,
	stashReturnPath,
	takeReturnPath
} from './session-expiry';

function fakeStorage() {
	const map = new Map<string, string>();
	return {
		map,
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		removeItem: (k: string) => void map.delete(k)
	};
}

describe('classifyAuthFailure', () => {
	it('treats a Couch 401 as session expired', () => {
		expect(classifyAuthFailure(new CouchAuthError(401))).toBe('session-expired');
		expect(classifyAuthFailure(new AuthError(401))).toBe('session-expired');
	});

	it('needs verification for a Couch 403', () => {
		expect(classifyAuthFailure(new CouchAuthError(403))).toBe('unverified-auth');
		expect(classifyAuthFailure(new AuthError(403))).toBe('unverified-auth');
	});

	it('needs verification for a plain BFF error carrying status 401 or 403', () => {
		const bff401 = Object.assign(new Error('Incorrect password'), { status: 401 });
		const bff403 = Object.assign(new Error('Forbidden'), { status: 403 });
		expect(classifyAuthFailure(bff401)).toBe('unverified-auth');
		expect(classifyAuthFailure(bff403)).toBe('unverified-auth');
		expect(classifyAuthFailure(401)).toBe('unverified-auth');
	});

	it('classifies network failures as offline, never expiry', () => {
		expect(classifyAuthFailure(new CannotConnectError())).toBe('offline');
		expect(classifyAuthFailure(new NetworkError())).toBe('offline');
		expect(classifyAuthFailure(new TypeError('Failed to fetch'))).toBe('offline');
		expect(classifyAuthFailure(new DOMException('aborted', 'AbortError'))).toBe('offline');
		expect(classifyAuthFailure(new DOMException('slow', 'TimeoutError'))).toBe('offline');
	});

	it('ignores document-policy 403 and non-auth errors', () => {
		expect(classifyAuthFailure(new CouchDocumentPolicyError('nope', 403))).toBe('other');
		expect(classifyAuthFailure(new ConflictError())).toBe('other');
		expect(classifyAuthFailure(new NotFoundError())).toBe('other');
		expect(classifyAuthFailure(Object.assign(new Error('x'), { status: 500 }))).toBe('other');
		expect(classifyAuthFailure(new Error('boom'))).toBe('other');
		expect(classifyAuthFailure(null)).toBe('other');
	});
});

describe('shouldRetryQuery', () => {
	it('never retries auth failures', () => {
		expect(shouldRetryQuery(0, new CouchAuthError(401))).toBe(false);
		expect(shouldRetryQuery(0, new CouchAuthError(403))).toBe(false);
		expect(shouldRetryQuery(0, Object.assign(new Error('x'), { status: 401 }))).toBe(false);
	});

	it('retries other errors once', () => {
		expect(shouldRetryQuery(0, new Error('boom'))).toBe(true);
		expect(shouldRetryQuery(0, new NetworkError())).toBe(true);
		expect(shouldRetryQuery(1, new Error('boom'))).toBe(false);
	});
});

describe('createExpiryLatch', () => {
	it('trips once until reset', () => {
		const latch = createExpiryLatch();
		expect(latch.trip()).toBe(true);
		expect(latch.trip()).toBe(false);
		expect(latch.tripped).toBe(true);
		latch.reset();
		expect(latch.tripped).toBe(false);
		expect(latch.trip()).toBe(true);
	});
});

describe('isUserSwitch', () => {
	it('is true only when both users exist and differ', () => {
		expect(isUserSwitch({ name: 'a' }, { name: 'b' })).toBe(true);
		expect(isUserSwitch({ name: 'a' }, { name: 'a' })).toBe(false);
		expect(isUserSwitch(null, { name: 'a' })).toBe(false);
		expect(isUserSwitch({ name: 'a' }, null)).toBe(false);
	});
});

describe('safeReturnPath', () => {
	it('keeps same-origin paths with query and hash', () => {
		expect(safeReturnPath('/back-office/stock?tab=2#row', '/portal')).toBe(
			'/back-office/stock?tab=2#row'
		);
	});

	it.each([
		'https://evil.example/x',
		'//evil.example/x',
		'/\\evil.example',
		'javascript:alert(1)',
		'portal',
		'',
		'/login',
		'/force-setup',
		'/mfa-challenge',
		'/portal',
		'/a\nb'
	])('rejects %j', (raw) => {
		expect(safeReturnPath(raw, 'FALLBACK')).toBe('FALLBACK');
	});

	it('rejects non-strings', () => {
		expect(safeReturnPath(undefined, null)).toBeNull();
		expect(safeReturnPath(42, null)).toBeNull();
	});
});

describe('return-path stash', () => {
	it('round-trips once for the same user', () => {
		const storage = fakeStorage();
		stashReturnPath('/back-office/stock', 'alice', storage, 1_000);
		expect(takeReturnPath('alice', storage, 2_000)).toBe('/back-office/stock');
		expect(takeReturnPath('alice', storage, 2_000)).toBeNull();
	});

	it('is bound to the expired user', () => {
		const storage = fakeStorage();
		stashReturnPath('/back-office/stock', 'alice', storage, 1_000);
		expect(takeReturnPath('bob', storage, 2_000)).toBeNull();
		expect(storage.map.size).toBe(0);
	});

	it('expires after the 10 minute TTL', () => {
		const storage = fakeStorage();
		stashReturnPath('/back-office/stock', 'alice', storage, 0);
		expect(takeReturnPath('alice', storage, 10 * 60 * 1000 + 1)).toBeNull();
	});

	it('does not stash unsafe paths and never stores credentials', () => {
		const storage = fakeStorage();
		stashReturnPath('https://evil.example', 'alice', storage);
		stashReturnPath('/login', 'alice', storage);
		expect(storage.map.size).toBe(0);
		stashReturnPath('/x', 'alice', storage, 5);
		expect(Object.keys(JSON.parse([...storage.map.values()][0])).sort()).toEqual([
			'at',
			'path',
			'user'
		]);
	});

	it('ignores a tampered payload and supports discard', () => {
		const storage = fakeStorage();
		storage.map.set('auth:return-path', '{not json');
		expect(takeReturnPath('alice', storage)).toBeNull();
		storage.map.set(
			'auth:return-path',
			JSON.stringify({ path: 'https://evil.example', user: 'alice', at: Date.now() })
		);
		expect(takeReturnPath('alice', storage)).toBeNull();
		stashReturnPath('/x', 'alice', storage);
		discardReturnPath(storage);
		expect(storage.map.size).toBe(0);
	});

	it('is a no-op without storage', () => {
		expect(() => stashReturnPath('/x', 'alice', null)).not.toThrow();
		expect(takeReturnPath('alice', null)).toBeNull();
		expect(() => discardReturnPath(null)).not.toThrow();
	});
});
