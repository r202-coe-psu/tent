import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

vi.mock('$env/dynamic/private', () => ({ env: { EXTERNAL_API_SECRET: 'test-secret' } }));

import {
	clearPendingLinkCookie,
	maskSubject,
	PENDING_LINK_COOKIE,
	pendingLinkDisplay,
	readPendingLink,
	setPendingLinkCookie
} from './pending-link';

function cookieJar() {
	const store = new Map<string, string>();
	return {
		store,
		cookies: {
			get: vi.fn((k: string) => store.get(k)),
			set: vi.fn((k: string, v: string) => void store.set(k, v)),
			delete: vi.fn((k: string) => void store.delete(k))
		} as unknown as Cookies
	};
}

describe('pending-link cookie (CR-141)', () => {
	it('sets an httpOnly cookie that reads back with a nonce', () => {
		const { cookies } = cookieJar();
		const set = setPendingLinkCookie(cookies, { provider: 'google', sub: 'g-123', email: 'a@x' });
		expect(cookies.set).toHaveBeenCalledWith(
			PENDING_LINK_COOKIE,
			expect.any(String),
			expect.objectContaining({ httpOnly: true, path: '/', maxAge: 600 })
		);
		expect(readPendingLink(cookies)).toEqual({
			provider: 'google',
			sub: 'g-123',
			email: 'a@x',
			name: null,
			pid_masked: null,
			nonce: set.nonce
		});
	});

	it('issues a fresh nonce per OAuth round', () => {
		const { cookies } = cookieJar();
		const a = setPendingLinkCookie(cookies, { provider: 'thaid', sub: 's' });
		const b = setPendingLinkCookie(cookies, { provider: 'thaid', sub: 's' });
		expect(a.nonce).not.toBe(b.nonce);
	});

	it('returns null for missing or forged cookies and after clear', () => {
		const { cookies, store } = cookieJar();
		expect(readPendingLink(cookies)).toBeNull();
		store.set(PENDING_LINK_COOKIE, 'forged.value');
		expect(readPendingLink(cookies)).toBeNull();
		setPendingLinkCookie(cookies, { provider: 'google', sub: 'g' });
		clearPendingLinkCookie(cookies);
		expect(readPendingLink(cookies)).toBeNull();
	});

	it('display never exposes the raw subject', () => {
		const base = { sub: 'secret-sub', nonce: 'n' };
		expect(pendingLinkDisplay({ ...base, provider: 'google', email: 'a@x' })).toBe('a@x');
		expect(pendingLinkDisplay({ ...base, provider: 'google' })).toBe('Google');
		expect(pendingLinkDisplay({ ...base, provider: 'thaid', name: 'สมชาย' })).toBe('สมชาย');
		expect(pendingLinkDisplay({ ...base, provider: 'thaid', pid_masked: '1-xx' })).toBe('1-xx');
		expect(maskSubject('abcdefghijkl')).toBe('abcd…ijkl');
		expect(maskSubject('short')).toBe('****');
	});
});
